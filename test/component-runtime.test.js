const assert = require('node:assert/strict');
const YAML = require('yaml');
const {
  chartValues, lint, render, renderFailure, resource,
} = require('./helpers/helm');

function buildValues() {
  const values = chartValues('charts/component/runtime');
  assert.equal(values.implementationProfile, 'quarkus-camel-openapi');
  assert.deepEqual(values.runtime.health, {
    readinessPath: '/q/health/ready',
    livenessPath: '/q/health/live',
    port: 8080,
    initialDelaySeconds: 10,
    periodSeconds: 10,
  });
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.namespace = 'orders-build';
  values.environment = 'sandbox';
  values.build.enabled = true;
  values.build.environment = 'sandbox';
  values.runtime.imagePullSecretNames = ['runtime-pull-auth'];
  values.runtime.envFromSecretNames = ['checkout-runtime'];
  return values;
}

function promotionValues(tag = 'v1.2.3') {
  const values = buildValues();
  values.build.enabled = false;
  values.environment = 'stage';
  values.namespace = 'orders-preprod';
  values.image.tag = tag;
  values.promotion.sourceEnvironment = 'sandbox';
  return values;
}

test('component runtime lints and renders build and runtime contracts', () => {
  const values = buildValues();
  lint('charts/component/runtime', values);
  const resources = render('charts/component/runtime', values);
  const pipeline = resource(resources, 'Pipeline', 'checkout');
  const taskNames = pipeline.spec.tasks.map(task => task.name);
  assert.ok(taskNames.includes('package'));
  assert.ok(taskNames.includes('build-and-push'));
  assert.ok(taskNames.includes('materialize-release'));
  resource(resources, 'Job', 'checkout-initial-build');
  resource(resources, 'Deployment', 'checkout');

  const pod = resource(resources, 'Deployment', 'checkout').spec.template.spec;
  assert.deepEqual(pod.imagePullSecrets, [{name: 'runtime-pull-auth'}]);
  assert.deepEqual(pod.containers[0].envFrom,
    [{secretRef: {name: 'checkout-runtime'}}]);

  const materialize = pipeline.spec.tasks.find(task => task.name === 'materialize-release');
  assert.doesNotMatch(YAML.stringify(materialize), /maven|buildah/i);
  assert.equal(resources.some(item => item.kind === 'Secret'), false);
});

test('non-build runtime omits build resources and produces stable release launchers', () => {
  const first = render('charts/component/runtime', promotionValues('v1.2.3'));
  const second = render('charts/component/runtime', promotionValues('v1.2.3'));
  const changed = render('charts/component/runtime', promotionValues('v1.2.4'));
  const firstJob = resource(first, 'Job');
  const secondJob = resource(second, 'Job');
  const changedJob = resource(changed, 'Job');

  assert.equal(first.some(item =>
    ['Pipeline', 'EventListener', 'TriggerTemplate', 'TriggerBinding'].includes(item.kind)), false);
  assert.equal(firstJob.metadata.name, secondJob.metadata.name);
  assert.notEqual(firstJob.metadata.name, changedJob.metadata.name);
  assert.equal(firstJob.metadata.annotations['contract-first-idp.github.io/release-tag'], 'v1.2.3');
  assert.doesNotMatch(YAML.stringify(firstJob), /maven|buildah/i);
  assert.equal(first.some(item => item.kind === 'Secret'), false);
});

test('component promotion rejects mutable latest outside the build environment', () => {
  assert.match(renderFailure('charts/component/runtime', promotionValues('latest')),
    /promotion requires an immutable human release/);
});
