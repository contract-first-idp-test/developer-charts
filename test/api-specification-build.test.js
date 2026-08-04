const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('API specification build lints and configures distinct main and release publication', () => {
  const values = chartValues('charts/api/specification-build');
  assert.equal(values.serviceAccountName, 'pipeline');
  values.serviceAccountName = 'orders-build';
  values.apiName = 'orders';
  lint('charts/api/specification-build', values);
  const resources = render('charts/api/specification-build', values);

  const pipeline = resource(resources, 'Pipeline', 'orders-api');
  const listener = resource(resources, 'EventListener', 'orders-api');
  assert.deepEqual(listener.spec.triggers.map(trigger => trigger.name),
    ['main', 'release-tag']);
  assert.deepEqual(pipeline.spec.tasks
    .filter(task => task.name.startsWith('publish-'))
    .map(task => task.name), ['publish-git-version', 'publish-release-version']);

  assert.deepEqual(pipeline.spec.tasks.map(task => task.name), [
    'clone', 'clone-spectral-rules', 'spectral',
    'publish-git-version', 'publish-release-version',
  ]);
  const rulesClone = pipeline.spec.tasks.find(task => task.name === 'clone-spectral-rules');
  assert.deepEqual(rulesClone.runAfter, ['clone']);
  assert.equal(rulesClone.params.find(param => param.name === 'URL').value,
    values.spectralRules.repositoryUrl);
  assert.equal(rulesClone.params.find(param => param.name === 'REVISION').value,
    values.spectralRules.revision);

  const spectral = pipeline.spec.tasks.find(task => task.name === 'spectral');
  assert.deepEqual(spectral.runAfter, ['clone-spectral-rules']);
  assert.equal(spectral.taskRef.params.find(param => param.name === 'name').value,
    'spectral-quality-gate');
  assert.equal(spectral.taskRef.params.find(param => param.name === 'namespace').value,
    'tekton-tasks');
  assert.equal(spectral.params.find(param => param.name === 'API_PATH').value,
    'source/specification.yaml');
  assert.equal(spectral.params.find(param => param.name === 'RULES_PATH').value,
    `spectral-rules/${values.spectralRules.path}`);
  assert.deepEqual(pipeline.spec.tasks.find(
    task => task.name === 'publish-git-version').runAfter, ['spectral']);

  const pipelineSource = fs.readFileSync(path.resolve(
    __dirname, '../charts/api/specification-build/templates/pipeline.yaml'), 'utf8');
  assert.doesNotMatch(pipelineSource, /mikefarah\/yq|\byq\s+-[er]|validate-yaml/);
  assert.doesNotMatch(pipelineSource, /taskSpec:/);
  assert.equal(pipeline.spec.tasks.filter(task =>
    task.name === 'spectral' || task.name === 'validate').length, 1);

  for (const task of pipeline.spec.tasks.filter(task => task.name.startsWith('publish-'))) {
    const goals = task.params.find(param => param.name === 'GOALS').value;
    assert.ok(goals.some(goal =>
      goal === 'io.apicurio:apicurio-registry-maven-plugin:3.2.5:register'));
    assert.equal(task.taskRef.params.find(param => param.name === 'namespace').value,
      'tekton-tasks');
  }
  assert.equal(listener.spec.serviceAccountName, 'orders-build');
  const hook = resource(resources, 'Job', 'orders-api-initial-publish');
  assert.equal(hook.metadata.annotations['argocd.argoproj.io/hook'], 'Sync');
  assert.equal(resources.some(item => item.kind === 'Secret'), false);
  assert.doesNotMatch(YAML.stringify(resources), /password|dockerconfigjson/i);
});
