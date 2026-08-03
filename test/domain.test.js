const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const YAML = require('yaml');
const {fixture, lint, render, renderFailure, resource} = require('./helpers/helm');

test('one Domain render creates discovery for every ordered environment', () => {
  const values = fixture('split-scm.yaml');
  lint('domain', values);
  const resources = render('domain', values);
  resource(resources, 'AppProject', 'tenant-retail');
  const applicationSets = resources.filter(item => item.kind === 'ApplicationSet');
  assert.deepEqual(applicationSets.map(item => item.metadata.name), [
    'retail-sandbox-systems',
    'retail-stage-systems',
    'retail-production-systems',
  ]);
  assert.deepEqual(applicationSets.map(item => item.spec.generators[0].git.files[0].path), [
    'systems/*/environments/sandbox.yaml',
    'systems/*/environments/stage.yaml',
    'systems/*/environments/production.yaml',
  ]);
});

test('Domain chart reads target configuration from spec.platform', () => {
  const root = path.resolve(__dirname, '..');
  const templates = [
    'domain/templates/_helpers.tpl',
    'domain/templates/applicationset.yaml',
    'domain/templates/appproject.yaml',
  ].map(relative => fs.readFileSync(path.join(root, relative), 'utf8')).join('\n');
  assert.match(templates, /\.Values\.spec\.platform/);
  assert.doesNotMatch(templates, /\.Values\.platform/);
  const schema = YAML.parse(fs.readFileSync(
    path.join(root, 'domain/values.schema.json'), 'utf8'));
  assert.ok(schema.properties.spec.required.includes('platform'));
  assert.deepEqual(schema.properties.spec.properties.type, {
    type: 'string',
    const: 'contract-first-idp-target',
  });
  assert.equal(schema.properties.spec.additionalProperties, false);
  assert.equal(Object.hasOwn(schema.properties, 'platform'), false);
});

test('Domain uses tenant identity and trusted platform inputs', () => {
  const values = fixture('split-scm.yaml');
  const applicationSet = resource(render('domain', values), 'ApplicationSet',
    'retail-stage-systems');
  const generator = applicationSet.spec.generators[0].git;
  const application = applicationSet.spec.template.spec;
  const valuesObject = application.sources[0].helm.valuesObject;

  assert.equal(generator.repoURL,
    'https://tenant-gitea.example/retail-team/retail-domain.git');
  assert.equal(application.sources[0].repoURL,
    'https://platform-gitea.example/platform-private/developer-charts.git');
  assert.equal(application.sources[0].targetRevision, 'v1.0.0');
  assert.equal(valuesObject.environment.name, 'stage');
  assert.equal(valuesObject.environment.namespaceSuffix, '-preprod');
  assert.equal(valuesObject.environment.clusterDomain, 'apps.west.example');
  assert.equal(valuesObject.schemaRegistry.apiUrl,
    'https://registry.example/apis/registry/v3');
  assert.deepEqual(valuesObject.spectralRules, {
    repositoryUrl: 'https://platform-gitea.example/platform-private/spectral-rules.git',
    revision: 'v1.0.0',
    path: 'ruleset.yaml',
  });
  assert.equal(valuesObject.build.environment, 'sandbox');
  assert.equal(valuesObject.build.namespaceSuffix, '-build');
  for (const definition of Object.values(valuesObject.environments.definitions)) {
    assert.equal(definition.clusterDomain, 'apps.west.example');
  }
});

test('Domain rejects incomplete or invalid lifecycle policy', () => {
  const missing = fixture('split-scm.yaml');
  delete missing.spec.environments.definitions.stage;
  assert.match(renderFailure('domain', missing), /ordered environment "stage" has no definition/);

  const invalidOrder = fixture('split-scm.yaml');
  invalidOrder.spec.environments.build = 'stage';
  assert.match(renderFailure('domain', invalidOrder),
    /build environment must be first in the ordered promotion lifecycle/);
});

test('Domain root environment is not required and tenant definitions cannot carry endpoints', () => {
  const values = fixture('split-scm.yaml');
  assert.equal(Object.hasOwn(values, 'environment'), false);
  values.spec.environments.definitions.stage.clusterDomain = 'attacker.example';
  assert.match(renderFailure('domain', values), /additional properties 'clusterDomain' not allowed/i);

  const registryOverride = fixture('split-scm.yaml');
  registryOverride.spec.schemaRegistry = {apiUrl: 'https://attacker.example'};
  assert.match(renderFailure('domain', registryOverride),
    /additional properties 'schemaRegistry' not allowed/i);
});

test('all distributed chart versions are 1.0.0', () => {
  const root = path.resolve(__dirname, '..');
  const charts = [
    'domain', 'system', 'api/specification-build', 'component/environment',
    'component/runtime', 'resource/postgresql',
  ];
  for (const chart of charts) {
    const metadata = YAML.parse(fs.readFileSync(path.join(root, chart, 'Chart.yaml'), 'utf8'));
    assert.equal(metadata.version, '1.0.0', chart);
    if (metadata.appVersion !== undefined) assert.equal(metadata.appVersion, '1.0.0', chart);
  }
});
