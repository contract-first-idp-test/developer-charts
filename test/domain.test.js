const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {fixture, lint, render, renderFailure, resource} = require('./helpers/helm');
const {repositoryRoot: root} = require('./helpers/paths');

test('keeps the private Node and Jest project entirely under test', () => {
  for (const obsolete of ['package.json', 'package-lock.json', 'jest.config.js', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(root, obsolete)), false, obsolete);
  }
  const testPackage = JSON.parse(fs.readFileSync(path.join(root, 'test/package.json'), 'utf8'));
  assert.deepEqual(
    {name: testPackage.name, private: testPackage.private},
    {name: 'developer-charts-tests', private: true},
  );
  for (const required of [
    'test/package-lock.json', 'test/jest.config.js', 'test/helpers/paths.js',
  ]) assert.equal(fs.existsSync(path.join(root, required)), true, required);
});

test('one Domain render creates discovery for every ordered environment', () => {
  const values = fixture('split-scm.yaml');
  lint('charts/domain/environment', values);
  const resources = render('charts/domain/environment', values);
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
  assert.deepEqual(applicationSets.map(item => item.spec.template.spec.sources[0].path), [
    'charts/system/environment',
    'charts/system/environment',
    'charts/system/environment',
  ]);
});

test('Domain chart reads target configuration from spec.platform', () => {
  const templates = [
    'charts/domain/environment/templates/_helpers.tpl',
    'charts/domain/environment/templates/applicationset.yaml',
    'charts/domain/environment/templates/appproject.yaml',
  ].map(relative => fs.readFileSync(path.join(root, relative), 'utf8')).join('\n');
  assert.match(templates, /\.Values\.spec\.platform/);
  assert.doesNotMatch(templates, /\.Values\.platform/);
  const schema = YAML.parse(fs.readFileSync(
    path.join(root, 'charts/domain/environment/values.schema.json'), 'utf8'));
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
  const applicationSet = resource(render('charts/domain/environment', values), 'ApplicationSet',
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
  assert.equal(valuesObject.owner, 'group:default/domain-maintainers');
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
  assert.match(renderFailure('charts/domain/environment', missing), /ordered environment "stage" has no definition/);

  const invalidOrder = fixture('split-scm.yaml');
  invalidOrder.spec.environments.build = 'stage';
  assert.match(renderFailure('charts/domain/environment', invalidOrder),
    /build environment must be first in the ordered promotion lifecycle/);
});

test('Domain root environment is not required and tenant definitions cannot carry endpoints', () => {
  const values = fixture('split-scm.yaml');
  assert.equal(Object.hasOwn(values, 'environment'), false);
  values.spec.environments.definitions.stage.clusterDomain = 'attacker.example';
  assert.match(
    renderFailure('charts/domain/environment', values),
    /additional propert(?:y|ies).*clusterDomain.*not allowed/i,
  );

  const registryOverride = fixture('split-scm.yaml');
  registryOverride.spec.schemaRegistry = {apiUrl: 'https://attacker.example'};
  assert.match(
    renderFailure('charts/domain/environment', registryOverride),
    /additional propert(?:y|ies).*schemaRegistry.*not allowed/i,
  );
});

test('all distributed chart versions are 1.0.0', () => {
  const charts = [
    'charts/domain/environment', 'charts/system/environment',
    'charts/api/openapi', 'charts/component/openjdk', 'charts/resource/postgresql',
  ];
  for (const chart of charts) {
    const metadata = YAML.parse(fs.readFileSync(path.join(root, chart, 'Chart.yaml'), 'utf8'));
    assert.equal(metadata.version, '1.0.0', chart);
    if (metadata.appVersion !== undefined) assert.equal(metadata.appVersion, '1.0.0', chart);
  }
});

test('charts use the canonical entity and responsibility paths', () => {
  const discovered = fs.readdirSync(path.join(root, 'charts'), {recursive: true})
    .filter(relative => relative.endsWith('Chart.yaml'))
    .map(relative => path.join('charts', relative).replaceAll(path.sep, '/'))
    .sort();
  expect(discovered).toEqual([
    'charts/api/openapi/Chart.yaml',
    'charts/component/openjdk/Chart.yaml',
    'charts/domain/environment/Chart.yaml',
    'charts/resource/postgresql/Chart.yaml',
    'charts/system/environment/Chart.yaml',
  ]);
});
