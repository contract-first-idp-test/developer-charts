#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFileSync, spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requireFromTests = createRequire(path.join(root, 'test/package.json'));
const semver = requireFromTests('semver');
const YAML = requireFromTests('yaml');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function validateRelease({release, tag, previousRelease, previousTag}) {
  invariant(release && typeof release === 'object', 'release.yaml must contain a mapping');
  invariant(semver.valid(release.version) === release.version,
    `release.yaml version is not valid SemVer: ${release.version}`);
  const expectedTag = `v${release.version}`;
  invariant(tag === expectedTag,
    `release tag ${tag} does not match release.yaml version ${release.version} (expected ${expectedTag})`);

  const requirements = release.requires || {};
  invariant(requirements && typeof requirements === 'object' && !Array.isArray(requirements),
    'release.yaml requires must be a mapping');
  for (const [name, range] of Object.entries(requirements)) {
    invariant(typeof range === 'string' && semver.validRange(range) !== null,
      `release.yaml requires.${name} is not a valid SemVer range: ${range}`);
  }

  if (!previousRelease) return;
  invariant(previousTag, 'previousTag is required with previousRelease');
  const previousVersion = previousTag.slice(1);
  invariant(semver.valid(previousVersion) === previousVersion,
    `previous release tag is not valid SemVer: ${previousTag}`);
  invariant(previousRelease.version === previousVersion,
    `${previousTag} release.yaml declares version ${previousRelease.version}`);
  invariant(semver.gt(release.version, previousVersion),
    `proposed version ${release.version} must be greater than previous release ${previousVersion}`);

  const current = semver.parse(release.version);
  const previous = semver.parse(previousVersion);
  const isPatch = current.major === previous.major && current.minor === previous.minor;
  if (isPatch) {
    const before = JSON.stringify(canonical(previousRelease.requires || {}));
    const after = JSON.stringify(canonical(requirements));
    invariant(after === before,
      `patch release ${release.version} must not change dependency compatibility requirements from ${previousVersion}`);
  }
}

function readYaml(relative) {
  return YAML.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function walk(directory, name, matches = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, name, matches);
    else if (entry.name === name) matches.push(absolute);
  }
  return matches;
}

function validateChartMetadata(release, charts) {
  invariant(charts.length > 0, 'no owned Chart.yaml files were found');
  for (const {relative, metadata} of charts) {
    invariant(metadata.version === release.version,
      `${relative} version ${metadata.version} does not match release.yaml ${release.version}`);
    if (metadata.appVersion !== undefined) {
      invariant(metadata.appVersion === release.version,
        `${relative} appVersion ${metadata.appVersion} does not match release.yaml ${release.version}`);
    }
  }
}

function validateDerivedMetadata(release) {
  const repository = path.basename(root);
  if (repository === 'developer-charts') {
    const charts = walk(path.join(root, 'charts'), 'Chart.yaml').map(chart => ({
      relative: path.relative(root, chart),
      metadata: YAML.parse(fs.readFileSync(chart, 'utf8')),
    }));
    validateChartMetadata(release, charts);
  } else if (repository === 'software-templates') {
    const generated = spawnSync('node', ['scripts/generate-compatibility.js', '--check'], {
      cwd: root, encoding: 'utf8',
    });
    invariant(generated.status === 0,
      generated.stderr.trim() || 'generated compatibility metadata is stale');
  } else if (repository === 'platform-components') {
    const target = readYaml('configuration/catalog-info.yaml').spec.platform;
    invariant(target.distribution.version === release.version,
      'configured platform distribution version does not match release.yaml');
    invariant(target.distribution.revision === `v${release.version}`,
      'configured platform distribution revision must be the exact matching tag');
    invariant(target.configuration.revision === target.tenantAdmission.branch,
      'tenant admission must target the mutable platform configuration branch');
    invariant(!/^v\d+\.\d+\.\d+$/.test(target.configuration.revision),
      'platform configuration must use a writable branch, not a release tag');
    const distribution = readYaml('configuration/platform-distribution.yaml');
    invariant(distribution.spec.source.targetRevision === `v${release.version}`,
      'platform distribution Application revision is stale');
    const patch = distribution.spec.source.kustomize.patches[0].patch;
    invariant(patch.includes(
      `PLATFORM_CONFIGURATION_REVISION: "${target.configuration.revision}"`),
    'platform distribution Application has a stale configuration revision');
    const bootstrap = readYaml('bootstrap/kustomization.yaml');
    const literal = bootstrap.configMapGenerator[0].literals.find(value =>
      value.startsWith('PLATFORM_CONFIGURATION_REVISION='));
    invariant(literal ===
      `PLATFORM_CONFIGURATION_REVISION=${target.configuration.revision}`,
    'bootstrap Application has a stale configuration revision');
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const release = readYaml('release.yaml');
  const tag = option('--tag') ||
    (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined) ||
    `v${release.version}`;
  const tags = execFileSync('git', ['tag', '--list', 'v*', '--merged', 'HEAD'], {
    cwd: root, encoding: 'utf8',
  }).trim().split('\n').filter(Boolean)
    .filter(candidate => semver.valid(candidate.slice(1)) !== null && candidate !== tag)
    .sort((left, right) => semver.rcompare(left.slice(1), right.slice(1)));
  const previousTag = tags[0];
  const previousRelease = previousTag
    ? YAML.parse(execFileSync('git', ['show', `${previousTag}:release.yaml`], {
      cwd: root, encoding: 'utf8',
    }))
    : undefined;

  validateRelease({release, tag, previousRelease, previousTag});
  validateDerivedMetadata(release);
  console.log(`${path.basename(root)} release ${tag} is valid${previousTag
    ? ` after ${previousTag}` : ' as the first release'}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`release validation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {validateChartMetadata, validateRelease};
