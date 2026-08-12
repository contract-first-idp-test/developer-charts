const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const semver = require('semver');

const root = path.resolve(__dirname, '..');
const release = YAML.parse(fs.readFileSync(path.join(root, 'release.yaml'), 'utf8'));
const template = fs.readFileSync(
  path.join(root, 'charts/domain/environment/templates/applicationset.yaml'), 'utf8');

function render(platformVersion) {
  return spawnSync('helm', [
    'template', 'release-check', path.join(root, 'charts/domain/environment'),
    '--set-string', `spec.platform.distribution.version=${platformVersion}`,
  ], {encoding: 'utf8'});
}

describe('developer-charts release contract', () => {
  test('declares its independent platform compatibility requirement', () => {
    expect(release).toEqual({
      version: '1.0.2', requires: {platformComponents: '>=1.0.0 <2.0.0'},
    });
    expect(semver.valid(release.version)).toBe(release.version);
    expect(semver.validRange(release.requires.platformComponents))
      .toBe(release.requires.platformComponents);
    expect(template).toContain(
      `$requiredPlatformRange := "${release.requires.platformComponents}"`);
    for (const chart of [
      'domain/environment', 'system/environment', 'api/openapi',
      'component/container', 'resource/postgresql',
    ]) {
      const metadata = YAML.parse(fs.readFileSync(
        path.join(root, 'charts', chart, 'Chart.yaml'), 'utf8'));
      expect(metadata.version).toBe(release.version);
    }
  });

  test('accepts the current target and rejects incompatible platform contracts early', () => {
    expect(render('1.1.0').status).toBe(0);
    expect(render('v1.0.0').status).toBe(0);
    const incompatible = render('2.0.0');
    expect(incompatible.status).not.toBe(0);
    expect(incompatible.stderr).toContain(
      'developer-charts 1.0.2 requires platform-components >=1.0.0 <2.0.0');
    expect(incompatible.stderr).toContain('selected PlatformTarget provides 2.0.0');
  });

  test('patch releases preserve ranges while minors may raise their floor', () => {
    const patch = {version: '1.0.9', requires: {...release.requires}};
    expect(patch.requires).toEqual(release.requires);
    expect(semver.satisfies('1.1.9', patch.requires.platformComponents)).toBe(true);

    const nextMinor = {
      version: '1.1.0', requires: {platformComponents: '>=1.2.0 <2.0.0'},
    };
    expect(semver.satisfies('1.1.9', nextMinor.requires.platformComponents)).toBe(false);
    expect(semver.satisfies('1.2.0', nextMinor.requires.platformComponents)).toBe(true);
  });
});
