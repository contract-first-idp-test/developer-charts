const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./paths');

function run(args, values) {
  const temporary = values
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'developer-charts-'))
    : null;
  try {
    if (values) {
      const valuesFile = path.join(temporary, 'values.yaml');
      fs.writeFileSync(valuesFile, YAML.stringify(values));
      args.push('-f', valuesFile);
    }
    const result = spawnSync('helm', args, {cwd: root, encoding: 'utf8'});
    if (result.error) {
      throw new Error(`Unable to execute helm: ${result.error.message}`);
    }
    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  } finally {
    if (temporary) fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function chartValues(chart) {
  return YAML.parse(fs.readFileSync(path.join(root, chart, 'values.yaml'), 'utf8'));
}

function fixture(name) {
  return YAML.parse(fs.readFileSync(path.join(root, 'test/fixtures', name), 'utf8'));
}

function lint(chart, values) {
  const result = run(['lint', chart], values);
  if (!result.ok) throw new Error(result.output);
}

function render(chart, values) {
  const result = run(['template', 'test', chart], values);
  if (!result.ok) throw new Error(result.output);
  return YAML.parseAllDocuments(result.output).map(document => {
    if (document.errors.length) {
      throw new Error(document.errors.map(error => error.message).join('\n'));
    }
    return document.toJSON();
  }).filter(Boolean);
}

function renderFailure(chart, values) {
  const result = run(['template', 'test', chart], values);
  if (result.ok) throw new Error(`${chart} unexpectedly rendered successfully`);
  return result.output;
}

function resource(resources, kind, name) {
  const match = resources.find(item =>
    item.kind === kind && (name === undefined || item.metadata?.name === name));
  if (!match) throw new Error(`Missing ${kind}${name ? ` ${name}` : ''}`);
  return match;
}

module.exports = {chartValues, fixture, lint, render, renderFailure, resource};
