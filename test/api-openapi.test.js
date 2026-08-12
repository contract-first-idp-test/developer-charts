const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('API specification build lints and configures distinct main and release publication', () => {
  const values = chartValues('charts/api/openapi');
  assert.equal(values.serviceAccountName, 'pipeline');
  values.serviceAccountName = 'orders-build';
  values.apiName = 'orders';
  lint('charts/api/openapi', values);
  const resources = render('charts/api/openapi', values);

  const pipeline = resource(resources, 'Pipeline', 'orders-api');
  const listener = resource(resources, 'EventListener', 'orders-api');
  assert.deepEqual(listener.spec.triggers.map(trigger => trigger.name),
    ['main', 'release-tag']);
  assert.deepEqual(pipeline.spec.tasks
    .filter(task => task.name.startsWith('publish-'))
    .map(task => task.name), ['publish-git-version', 'publish-release-version']);

  assert.deepEqual(pipeline.spec.tasks.map(task => task.name), [
    'clone', 'clone-spectral-rules', 'spectral',
    'publish-git-version', 'microcks-import', 'publish-release-version',
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
  const microcks = pipeline.spec.tasks.find(task => task.name === 'microcks-import');
  assert.deepEqual(microcks.runAfter, ['spectral']);
  assert.equal(microcks.taskRef.params.find(param => param.name === 'name').value,
    'microcks-cli');
  assert.match(microcks.params.find(param => param.name === 'SCRIPT').value,
    /microcks import[\s\S]*MICROCKS_URL[\s\S]*MICROCKS_CLIENT_ID/);
  assert.match(microcks.params.find(param => param.name === 'SCRIPT').value,
    /--insecure-tls/);
  assert.deepEqual(pipeline.spec.tasks.find(
    task => task.name === 'publish-release-version').runAfter, ['publish-git-version']);
  assert.equal(microcks.runAfter.includes('publish-git-version'), false);

  const pipelineSource = fs.readFileSync(path.resolve(
    __dirname, '../charts/api/openapi/templates/pipeline.yaml'), 'utf8');
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
  const hookScript = hook.spec.template.spec.containers[0].args[0];
  assert.doesNotMatch(hookScript, /oc wait --for=condition=Succeeded/);
  assert.match(hookScript, /case "\$status" in[\s\S]*True\)[\s\S]*exit 0/);
  assert.match(hookScript,
    /False\)[\s\S]*PipelineRun \$run_name failed: \$\{reason:-UnknownReason\}: \$\{message:-No message reported\}[\s\S]*exit 1/);
  assert.match(hookScript, /Timed out after 30m waiting for PipelineRun \$run_name/);
  const triggerTemplate = resource(resources, 'TriggerTemplate', 'orders-api');
  const triggered = triggerTemplate.spec.resourcetemplates[0].spec.taskRunSpecs;
  assert.deepEqual(triggered.map(item => item.pipelineTaskName), [
    'publish-git-version', 'publish-release-version', 'microcks-import',
  ]);
  const initial = YAML.parse(resource(resources, 'ConfigMap',
    'orders-api-initial-publish').data['pipelinerun.yaml']);
  assert.deepEqual(initial.spec.taskRunSpecs.map(item => item.pipelineTaskName), [
    'publish-git-version', 'publish-release-version', 'microcks-import',
  ]);
  for (const specs of [triggered, initial.spec.taskRunSpecs]) {
    const gitPublish = specs.find(item => item.pipelineTaskName === 'publish-git-version');
    assert.deepEqual(gitPublish.podTemplate.env.map(item => item.name), [
      'APICURIO_AUTH_SERVER_URL', 'APICURIO_CLIENT_ID', 'APICURIO_CLIENT_SECRET',
    ]);
    assert.equal(gitPublish.podTemplate.env[1].valueFrom.secretKeyRef.name,
      'apicurio-client');
    const importSpec = specs.find(item => item.pipelineTaskName === 'microcks-import');
    assert.equal(importSpec.podTemplate.env[1].valueFrom.secretKeyRef.name,
      'microcks-client');
  }
  assert.equal(resources.some(item => item.kind === 'Secret'), false);
  assert.doesNotMatch(YAML.stringify(resources), /dockerconfigjson/i);
});
