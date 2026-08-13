const assert = require('node:assert/strict');
const YAML = require('yaml');
const {
  chartValues, lint, render, renderFailure, resource,
} = require('./helpers/helm');

function buildValues(profile = 'quarkus-jvm') {
  const values = chartValues('charts/component/container');
  assert.equal(values.implementationProfile, 'quarkus-camel-openapi');
  assert.deepEqual(values.runtime.health, {
    initialDelaySeconds: 10,
    periodSeconds: 10,
  });
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.namespace = 'orders-build';
  values.environment = 'sandbox';
  values.build.enabled = true;
  values.build.profile = profile;
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

test('environment-only container state creates an ImageStream without a workload', () => {
  const values = chartValues('charts/component/container');
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.namespace = 'orders-preprod';
  values.environment = 'stage';
  values.build.enabled = false;
  values.build.environment = 'sandbox';

  lint('charts/component/container', values);
  const resources = render('charts/component/container', values);
  resource(resources, 'ImageStream', 'checkout');
  assert.deepEqual(resources.map(item => item.kind), ['ImageStream']);
});

test.each([
  ['quarkus-jvm', 'maven', 'registry.access.redhat.com/ubi9/openjdk-21:1.24',
    './src/main/docker/Dockerfile.jvm', '/q/health/ready', '/q/health/live', 9000],
  ['quarkus-native', 'maven', 'quay.io/quarkus/ubi9-quarkus-mandrel-builder-image:jdk-21',
    './src/main/docker/Dockerfile.native', '/q/health/ready', '/q/health/live', 9000],
  ['spring-boot', 'maven', 'registry.access.redhat.com/ubi9/openjdk-21:1.24',
    './src/main/docker/Dockerfile', '/actuator/health/readiness',
    '/actuator/health/liveness', 8081],
  ['nodejs', 'nodejs', null, './Dockerfile', '/health/ready', '/health/live', 8080],
])('container chart resolves the %s approved recipe', (
  profile, packageTaskName, builderImage, dockerfile, readinessPath, livenessPath, healthPort,
) => {
  const values = buildValues(profile);
  values.implementationProfile = profile === 'spring-boot'
    ? 'spring-boot-openapi'
    : profile === 'nodejs' ? 'nodejs-openapi' : 'quarkus-camel-openapi';
  lint('charts/component/container', values);
  const resources = render('charts/component/container', values);
  const pipeline = resource(resources, 'Pipeline', 'checkout');
  const packageTask = pipeline.spec.tasks.find(task => task.name === 'package');
  assert.deepEqual(resolvedTask(packageTask), {
    kind: 'task',
    name: packageTaskName,
    namespace: 'tekton-tasks',
  });
  const params = Object.fromEntries(packageTask.params.map(param => [param.name, param.value]));
  if (builderImage) assert.equal(params.MAVEN_IMAGE, builderImage);
  else assert.equal(params.SCRIPT, 'npm ci\nnpm test\n');
  const buildah = pipeline.spec.tasks.find(task => task.name === 'build-and-push');
  assert.equal(buildah.params.find(param => param.name === 'DOCKERFILE').value, dockerfile);

  const container = resource(resources, 'Deployment', 'checkout').spec.template.spec.containers[0];
  assert.equal(container.readinessProbe.httpGet.path, readinessPath);
  assert.equal(container.livenessProbe.httpGet.path, livenessPath);
  assert.equal(container.readinessProbe.httpGet.port, healthPort);
});

test('container chart renders shared delivery capabilities and runtime contracts', () => {
  const values = buildValues();
  lint('charts/component/container', values);
  const resources = render('charts/component/container', values);
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
  assert.deepEqual(resolvedTask(guard), {
    kind: 'task', name: 'assert-image-tag-compatible', namespace: 'tekton-tasks',
  });
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
  assert.deepEqual(resolvedTask(restart), {
    kind: 'task', name: 'openshift-client', namespace: 'openshift-pipelines',
  });
  assert.match(restart.params.find(param => param.name === 'SCRIPT').value,
    /oc rollout restart[\s\S]*oc rollout status/);
  assert.equal(pipeline.spec.tasks.some(task => task.taskSpec), false);
  assert.equal(resources.some(item => item.kind === 'Secret'), false);
});

test('promoted container runtime omits build resources and produces stable release launchers', () => {
  const first = render('charts/component/container', promotionValues('v1.2.3'));
  const second = render('charts/component/container', promotionValues('v1.2.3'));
  const changed = render('charts/component/container', promotionValues('v1.2.4'));
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
  assert.match(renderFailure('charts/component/container', promotionValues('latest')),
    /promotion requires an immutable human release/);
});
