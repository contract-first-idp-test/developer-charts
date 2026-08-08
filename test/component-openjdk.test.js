const assert = require('node:assert/strict');
const YAML = require('yaml');
const {
  chartValues, lint, render, renderFailure, resource,
} = require('./helpers/helm');

function buildValues() {
  const values = chartValues('charts/component/openjdk');
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
  values.image.tag = 'latest';
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

function resolvedTask(task) {
  return Object.fromEntries(task.taskRef.params.map(param => [param.name, param.value]));
}

test('environment-only OpenJDK state creates an ImageStream without a workload', () => {
  const values = chartValues('charts/component/openjdk');
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.namespace = 'orders-preprod';
  values.environment = 'stage';
  values.build.enabled = false;
  values.build.environment = 'sandbox';

  lint('charts/component/openjdk', values);
  const resources = render('charts/component/openjdk', values);
  resource(resources, 'ImageStream', 'checkout');
  assert.deepEqual(resources.map(item => item.kind), ['ImageStream']);
});

test('OpenJDK chart renders build and latest runtime contracts', () => {
  const values = buildValues();
  lint('charts/component/openjdk', values);
  const resources = render('charts/component/openjdk', values);
  resource(resources, 'ImageStream', 'checkout');
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
  assert.equal(materialize.taskRef.resolver, 'cluster');
  assert.deepEqual(resolvedTask(materialize), {
    kind: 'task',
    name: 'skopeo-copy',
    namespace: 'openshift-pipelines',
  });
  assert.doesNotMatch(YAML.stringify(materialize), /taskSpec|skopeo copy|quay\.io\/skopeo/i);
  const guard = pipeline.spec.tasks.find(task => task.name === 'assert-release-version');
  assert.equal(guard.taskRef.name, 'assert-image-tag-compatible');
  assert.deepEqual(materialize.runAfter, ['assert-release-version']);
  assert.match(Object.fromEntries(materialize.params.map(param => [param.name, param.value]))
    .SOURCE_IMAGE_URL, /@\$\(tasks\.assert-release-version\.results\.sourceDigest\)$/);
  for (const copyTaskName of ['publish-latest', 'materialize-release']) {
    const copyTask = pipeline.spec.tasks.find(task => task.name === copyTaskName);
    assert.deepEqual(copyTask.params.map(param => param.name), [
      'SOURCE_IMAGE_URL',
      'DESTINATION_IMAGE_URL',
      'SRC_TLS_VERIFY',
      'DEST_TLS_VERIFY',
    ]);
  }
  const restart = pipeline.spec.tasks.find(task => task.name === 'restart-runtime');
  assert.equal(restart.taskSpec.steps.find(step => step.name === 'rollout').image,
    'registry.redhat.io/openshift4/ose-cli');
  assert.equal(resources.some(item => item.kind === 'Secret'), false);
});

test('promoted OpenJDK runtime omits build resources and produces stable release launchers', () => {
  const first = render('charts/component/openjdk', promotionValues('v1.2.3'));
  const second = render('charts/component/openjdk', promotionValues('v1.2.3'));
  const changed = render('charts/component/openjdk', promotionValues('v1.2.4'));
  resource(first, 'ImageStream', 'checkout');
  resource(first, 'Deployment', 'checkout');
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

  const wait = firstJob.spec.template.spec.initContainers.find(container =>
    container.name === 'wait-for-promotion-pipeline');
  assert.equal(wait.image, 'registry.redhat.io/openshift4/ose-cli');
  const waitScript = wait.args.join('\n');
  assert.match(waitScript, /oc get pipeline\.tekton\.dev "\$PIPELINE_NAME"/);
  assert.match(waitScript, /max_attempts=31/);
  assert.match(waitScript, /retry_seconds=10/);
  assert.match(waitScript, /300 seconds/);
  assert.doesNotMatch(YAML.stringify(firstJob), /tkn pipeline describe/);
  assert.match(firstJob.spec.template.spec.containers[0].args.join('\n'), /tkn pipeline start/);
  assert.doesNotMatch(YAML.stringify(firstJob), /quay\.io\/openshift\/origin-cli:4\.16/);
});

test('component promotion rejects mutable latest outside the build environment', () => {
  assert.match(renderFailure('charts/component/openjdk', promotionValues('latest')),
    /promotion requires an immutable human release/);
});
