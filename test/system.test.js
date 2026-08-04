const assert = require('node:assert/strict');
const YAML = require('yaml');
const {fixture, lint, render, resource} = require('./helpers/helm');

function appSet(resources, suffix) {
  const match = resources.find(item =>
    item.kind === 'ApplicationSet' && item.metadata.name.endsWith(suffix));
  assert.ok(match, `Missing ApplicationSet ending in ${suffix}`);
  return match;
}

test('system lints and renders the namespace and chart discovery contracts', () => {
  const values = fixture('nonstandard-lifecycle.yaml');
  lint('charts/system/environment', values);
  const resources = render('charts/system/environment', values);
  resource(resources, 'Namespace', 'orders-build');
  resource(resources, 'AppProject', 'tenant-retail-orders');

  const expected = [
    ['-api-builds', 'apis/*/values.yaml', 'charts/api/specification-build'],
    ['-components', 'components/*/releases/sandbox.yaml', 'charts/component/runtime'],
    ['-component-environments', 'components/*/environments/sandbox.yaml', 'charts/component/environment'],
    ['-resources', 'resources/*/*/environments/sandbox.yaml', '{{ .implementation.path }}'],
  ];
  for (const [suffix, discoveryPath, chartPath] of expected) {
    const item = appSet(resources, suffix);
    assert.ok(YAML.stringify(item.spec.generators).includes(discoveryPath));
    const source = item.spec.template.spec.sources?.[0] || item.spec.template.spec.source;
    assert.equal(source.path, chartPath);
    assert.equal(source.repoURL,
      'https://platform-gitea.example/platform-private/developer-charts.git');
  }

  const component = appSet(resources, '-components');
  assert.deepEqual(component.spec.template.spec.sources[0].helm.valueFiles, [
    '$values/components/{{ index .path.segments 1 }}/values.yaml',
    '$values/components/{{ index .path.segments 1 }}/environments/sandbox.yaml',
    '$values/components/{{ index .path.segments 1 }}/releases/sandbox.yaml',
  ]);
  const api = appSet(resources, '-api-builds');
  assert.deepEqual(api.spec.template.spec.sources[0].helm.valueFiles,
    ['$values/apis/{{ index .path.segments 1 }}/values.yaml']);
  const apiValues = api.spec.template.spec.sources[0].helm.valuesObject;
  assert.deepEqual({
    apiName: apiValues.apiName,
    systemName: apiValues.systemName,
    revision: apiValues.revision,
    schemaRegistry: apiValues.schemaRegistry,
    spectralRules: apiValues.spectralRules,
  }, {
    apiName: '{{ index .path.segments 1 }}',
    systemName: 'orders',
    revision: 'trunk',
    schemaRegistry: {apiUrl: 'https://registry.example/apis/registry/v3'},
    spectralRules: {
      repositoryUrl: 'https://example.invalid/spectral-rules.git',
      revision: 'v1.0.0',
      path: 'ruleset.yaml',
    },
  });
  assert.deepEqual(api.spec.template.spec.sources[1], {
    repoURL: 'https://tenant-gitea.example/retail-team/orders-system.git',
    targetRevision: 'trunk',
    ref: 'values',
  });

  const componentEnvironment = appSet(resources, '-component-environments');
  assert.deepEqual(componentEnvironment.spec.template.spec.source.helm.valuesObject, {
    systemName: 'orders',
    componentName: '{{ index .path.segments 1 }}',
    environment: 'sandbox',
  });
  assert.equal(componentEnvironment.spec.template.spec.destination.namespace, 'orders-build');

  const componentValues = component.spec.template.spec.sources[0].helm.valuesObject;
  assert.deepEqual({
    componentName: componentValues.componentName,
    environment: componentValues.environment,
    namespace: componentValues.namespace,
    buildEnvironment: componentValues.build.environment,
  }, {
    componentName: '{{ index .path.segments 1 }}',
    environment: 'sandbox',
    namespace: 'orders-build',
    buildEnvironment: 'sandbox',
  });
});

test('system limits build and promotion access to the environments that need it', () => {
  const buildValues = fixture('nonstandard-lifecycle.yaml');
  const buildResources = render('charts/system/environment', buildValues);
  resource(buildResources, 'ServiceAccount', 'orders-build');
  assert.equal(buildResources.some(item => item.kind === 'Secret'), false);

  const stageValues = fixture('nonstandard-lifecycle.yaml');
  stageValues.environment = {
    name: 'stage',
    namespaceSuffix: '-preprod',
    clusterDomain: 'apps.stage.example',
  };
  const stageResources = render('charts/system/environment', stageValues);
  assert.equal(stageResources.some(item =>
    item.kind === 'ServiceAccount' && item.metadata.name === 'orders-build'), false);
  assert.equal(stageResources.some(item => item.kind === 'AppProject'), false);

  const sourceRole = resource(stageResources, 'Role', 'image-promoter-source-credential');
  assert.deepEqual(sourceRole.rules, [{
    apiGroups: [''],
    resources: ['secrets'],
    resourceNames: ['source-registry-auth'],
    verbs: ['get'],
  }]);
  const sourceBinding = resource(stageResources, 'RoleBinding',
    'image-promoter-from-stage-to-production');
  assert.equal(sourceBinding.metadata.namespace, 'orders-preprod');
  assert.equal(sourceBinding.subjects[0].namespace, 'orders');

  const task = resource(stageResources, 'Task', 'skopeo-copy-image');
  assert.equal(task.spec.volumes.find(volume => volume.name === 'destination-auth')
    .secret.secretName, 'destination-registry-auth');
  const pipeline = resource(stageResources, 'Pipeline', 'promote-image');
  const params = Object.fromEntries(pipeline.spec.tasks[0].params
    .map(param => [param.name, param.value]));
  assert.equal(params['source-namespace'], 'orders-build');
  assert.equal(params['source-secret-name'], 'source-registry-auth');
  assert.equal(stageResources.some(item => item.kind === 'Secret'), false);
});
