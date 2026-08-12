const assert = require('node:assert/strict');
const YAML = require('yaml');
const {fixture, lint, render, resource} = require('./helpers/helm');

function appSet(resources, suffix) {
  const match = resources.find(item =>
    item.kind === 'ApplicationSet' && item.metadata.name.endsWith(suffix));
  assert.ok(match, `Missing ApplicationSet ending in ${suffix}`);
  return match;
}

function taskRefParams(task) {
  return Object.fromEntries(task.taskRef.params.map(param => [param.name, param.value]));
}

function environmentValues(name) {
  const values = fixture('nonstandard-lifecycle.yaml');
  values.environment = {name, ...values.environments.definitions[name]};
  return values;
}

test('system lints and renders the namespace and chart discovery contracts', () => {
  const values = fixture('nonstandard-lifecycle.yaml');
  lint('charts/system/environment', values);
  const resources = render('charts/system/environment', values);
  resource(resources, 'Namespace', 'orders-build');
  const project = resource(resources, 'AppProject', 'tenant-retail-orders');
  assert.deepEqual(project.spec.sourceRepos, [
    'https://platform-gitea.example/platform-private/developer-charts.git',
    'https://tenant-gitea.example/retail-team/orders-system.git',
  ]);
  assert.deepEqual(project.spec.destinations, [{
    server: 'https://kubernetes.default.svc', namespace: 'orders*',
  }]);
  assert.deepEqual(project.spec.clusterResourceWhitelist, []);
  assert.equal(project.spec.namespaceResourceWhitelist.some(
    entry => entry.group === '*' || entry.kind === '*'), false);

  const expected = [
    ['-api-builds', 'apis/*/values.yaml', 'charts/api/openapi'],
    ['-components', 'components/*/environments/sandbox.yaml', 'charts/component/container'],
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
  assert.equal(component.spec.template.spec.sources[0].helm.ignoreMissingValueFiles, true);
  const api = appSet(resources, '-api-builds');
  assert.deepEqual(api.spec.template.spec.sources[0].helm.valueFiles,
    ['$values/apis/{{ index .path.segments 1 }}/values.yaml']);
  const apiValues = api.spec.template.spec.sources[0].helm.valuesObject;
  assert.deepEqual({
    apiName: apiValues.apiName,
    systemName: apiValues.systemName,
    revision: apiValues.revision,
    schemaRegistry: apiValues.schemaRegistry,
    microcks: apiValues.microcks,
    spectralRules: apiValues.spectralRules,
  }, {
    apiName: '{{ index .path.segments 1 }}',
    systemName: 'orders',
    revision: 'trunk',
    schemaRegistry: {
      apiUrl: 'https://registry.example/apis/registry/v3',
      authServerUrl: 'https://keycloak.example/realms/platform',
    },
    microcks: {url: 'https://microcks.example'},
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

test('first active environment does not provision resources into a future namespace', () => {
  const devResources = render('charts/system/environment', environmentValues('sandbox'));
  resource(devResources, 'Namespace', 'orders-build');
  const buildServiceAccount = resource(devResources, 'ServiceAccount', 'orders-build');
  const pipelineServiceAccount = resource(devResources, 'ServiceAccount', 'pipeline');
  for (const serviceAccount of [buildServiceAccount, pipelineServiceAccount]) {
    assert.deepEqual(serviceAccount.secrets, [{name: 'destination-registry-auth'}]);
    assert.equal(serviceAccount.imagePullSecrets, undefined);
  }
  assert.equal(devResources.some(item => item.kind === 'SecretStore'), false);
  assert.deepEqual(devResources.filter(item => item.kind === 'ExternalSecret')
    .map(item => item.metadata.name).sort(), ['apicurio-client', 'microcks-client']);
  for (const secret of devResources.filter(item => item.kind === 'ExternalSecret')) {
    assert.equal(secret.metadata.namespace, 'orders-build');
    assert.equal(secret.spec.secretStoreRef.name, 'retail-publishers');
  }
  assert.equal(devResources.some(item =>
    item.kind === 'ServiceAccount' && item.metadata.name === 'image-promoter-source-reader'), false);
  assert.equal(devResources.some(item =>
    item.kind === 'Role' && item.metadata.name === 'image-promoter-source-credential'), false);
  assert.equal(devResources.some(item =>
    item.kind === 'Pipeline' && item.metadata.name === 'promote-image'), false);
  assert.equal(devResources.some(item =>
    item.metadata?.namespace === 'orders-preprod' ||
    (item.kind === 'Namespace' && item.metadata.name === 'orders-preprod')), false);
});

test('activated target owns its incoming promotion credential bridge and local pipeline auth', () => {
  const stageResources = render('charts/system/environment', environmentValues('stage'));
  resource(stageResources, 'Namespace', 'orders-preprod');
  assert.equal(stageResources.some(item =>
    item.kind === 'ServiceAccount' && item.metadata.name === 'orders-build'), false);
  assert.equal(stageResources.some(item => item.kind === 'AppProject'), false);
  assert.equal(stageResources.some(item =>
    item.metadata?.namespace === 'orders' ||
    (item.kind === 'Namespace' && item.metadata.name === 'orders')), false);

  const reader = resource(stageResources, 'ServiceAccount', 'image-promoter-source-reader');
  assert.equal(reader.metadata.namespace, 'orders-preprod');
  const sourceRole = resource(stageResources, 'Role', 'image-promoter-source-credential');
  assert.equal(sourceRole.metadata.namespace, 'orders-build');
  assert.deepEqual(sourceRole.rules, [
    {
      apiGroups: [''],
      resources: ['secrets'],
      resourceNames: ['source-registry-auth'],
      verbs: ['get'],
    },
    {
      apiGroups: ['authorization.k8s.io'],
      resources: ['selfsubjectrulesreviews'],
      verbs: ['create'],
    },
  ]);
  const sourceBinding = resource(stageResources, 'RoleBinding',
    'image-promoter-from-sandbox-to-stage');
  assert.equal(sourceBinding.metadata.namespace, 'orders-build');
  assert.deepEqual(sourceBinding.subjects, [{
    kind: 'ServiceAccount',
    name: 'image-promoter-source-reader',
    namespace: 'orders-preprod',
  }]);
  const store = resource(stageResources, 'SecretStore', 'image-promoter-source');
  assert.equal(store.metadata.namespace, 'orders-preprod');
  assert.equal(store.spec.provider.kubernetes.remoteNamespace, 'orders-build');
  const distributedSource = resource(stageResources, 'ExternalSecret',
    'image-promoter-source-sandbox');
  assert.equal(distributedSource.metadata.namespace, 'orders-preprod');
  assert.deepEqual(distributedSource.spec.dataFrom,
    [{extract: {key: 'source-registry-auth'}}]);
  assert.equal(distributedSource.spec.target.template.type, 'kubernetes.io/dockerconfigjson');
  assert.match(distributedSource.spec.target.template.data['.dockerconfigjson'],
    /quay\.example\/west_orders-build/);
  assert.match(distributedSource.spec.target.template.data['.dockerconfigjson'],
    /fromJson/);

  assert.equal(stageResources.some(item =>
    item.kind === 'Task' && item.metadata.name === 'skopeo-copy-image'), false);
  const pipelineServiceAccount = resource(stageResources, 'ServiceAccount', 'pipeline');
  assert.deepEqual(pipelineServiceAccount.secrets, [
    {name: 'image-promoter-source-sandbox'},
    {name: 'destination-registry-auth'},
  ]);
  assert.equal(pipelineServiceAccount.imagePullSecrets, undefined);
  const pipeline = resource(stageResources, 'Pipeline', 'promote-image');
  assert.equal(pipeline.metadata.namespace, 'orders-preprod');
  const guard = pipeline.spec.tasks.find(task => task.name === 'assert-release-version');
  assert.deepEqual(taskRefParams(guard), {
    kind: 'task', name: 'assert-image-tag-compatible', namespace: 'tekton-tasks',
  });
  const copy = pipeline.spec.tasks.find(task => task.name === 'copy');
  assert.equal(copy.taskRef.resolver, 'cluster');
  assert.deepEqual(taskRefParams(copy), {
    kind: 'task',
    name: 'skopeo-copy',
    namespace: 'openshift-pipelines',
  });
  assert.deepEqual(copy.runAfter, ['assert-release-version']);
  const copyParams = Object.fromEntries(copy.params.map(param => [param.name, param.value]));
  assert.match(copyParams.SOURCE_IMAGE_URL,
    /@\$\(tasks\.assert-release-version\.results\.sourceDigest\)$/);
  assert.deepEqual(copy.params.map(param => param.name), [
    'SOURCE_IMAGE_URL',
    'DESTINATION_IMAGE_URL',
    'SRC_TLS_VERIFY',
    'DEST_TLS_VERIFY',
  ]);
  assert.doesNotMatch(YAML.stringify(stageResources), /skopeo copy|skopeo-copy-image/);
  for (const binding of stageResources.filter(item => item.kind === 'RoleBinding')) {
    assert.equal(binding.subjects.some(subject =>
      subject.name === 'pipeline' && subject.namespace &&
      subject.namespace !== binding.metadata.namespace), false);
  }
  assert.equal(stageResources.some(item => item.kind === 'Secret'), false);
  const launcherRole = resource(stageResources, 'Role', 'image-promoter-launcher');
  assert.deepEqual(launcherRole.rules, [
    {apiGroups: ['tekton.dev'], resources: ['pipelines'], verbs: ['get']},
    {apiGroups: ['tekton.dev'], resources: ['pipelineruns'], verbs: ['create']},
  ]);
});

test('each activated target reads only from its immediately preceding environment', () => {
  const devResources = render('charts/system/environment', environmentValues('sandbox'));
  const testResources = render('charts/system/environment', environmentValues('stage'));
  const prodResources = render('charts/system/environment', environmentValues('production'));

  assert.equal(devResources.some(item => item.kind === 'SecretStore'), false);
  const testStore = resource(testResources, 'SecretStore', 'image-promoter-source');
  assert.equal(testStore.spec.provider.kubernetes.remoteNamespace, 'orders-build');
  const prodStore = resource(prodResources, 'SecretStore', 'image-promoter-source');
  assert.equal(prodStore.metadata.namespace, 'orders');
  assert.equal(prodStore.spec.provider.kubernetes.remoteNamespace, 'orders-preprod');

  const prodRole = resource(prodResources, 'Role', 'image-promoter-source-credential');
  assert.equal(prodRole.metadata.namespace, 'orders-preprod');
  const prodBinding = resource(prodResources, 'RoleBinding',
    'image-promoter-from-stage-to-production');
  assert.equal(prodBinding.metadata.namespace, 'orders-preprod');
  assert.equal(prodBinding.subjects[0].namespace, 'orders');
  const prodCredential = resource(prodResources, 'ExternalSecret',
    'image-promoter-source-stage');
  assert.equal(prodCredential.metadata.namespace, 'orders');
  const prodPipeline = resource(prodResources, 'Pipeline', 'promote-image');
  assert.equal(prodPipeline.metadata.namespace, 'orders');
  const prodPipelineServiceAccount = resource(prodResources, 'ServiceAccount', 'pipeline');
  assert.deepEqual(prodPipelineServiceAccount.secrets, [
    {name: 'image-promoter-source-stage'},
    {name: 'destination-registry-auth'},
  ]);
});

test('system renders no Task resources and resolves the shared tag guard', () => {
  const resources = render('charts/system/environment', environmentValues('stage'));
  assert.equal(resources.some(item => item.kind === 'Task'), false);
  const pipeline = resource(resources, 'Pipeline', 'promote-image');
  assert.deepEqual(taskRefParams(
    pipeline.spec.tasks.find(task => task.name === 'assert-release-version')),
  {kind: 'task', name: 'assert-image-tag-compatible', namespace: 'tekton-tasks'});
});
