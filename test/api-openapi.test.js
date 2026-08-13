const assert = require('node:assert/strict');
const YAML = require('yaml');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('API chart wires validation and distinct immutable publication paths', () => {
  const values = chartValues('charts/api/openapi');
  values.apiName = 'orders';
  lint('charts/api/openapi', values);
  const resources = render('charts/api/openapi', values);

  const pipeline = resource(resources, 'Pipeline', 'orders-api');
  const listener = resource(resources, 'EventListener', 'orders-api');
  assert.deepEqual(new Set(listener.spec.triggers.map(trigger => trigger.name)),
    new Set(['main', 'release-tag']));

  const tasks = new Map(pipeline.spec.tasks.map(task => [task.name, task]));
  for (const name of [
    'clone', 'spectral', 'publish-git-version',
    'publish-release-version', 'microcks-import',
  ]) assert.ok(tasks.has(name), name);
  assert.ok(tasks.get('publish-git-version').runAfter.includes('spectral'));
  assert.ok(tasks.get('publish-release-version').runAfter.includes('publish-git-version'));
  assert.ok(tasks.get('microcks-import').runAfter.includes('spectral'));

  for (const task of [tasks.get('publish-git-version'), tasks.get('publish-release-version')]) {
    const goals = task.params.find(param => param.name === 'GOALS').value;
    assert.ok(goals.some(goal => goal.includes('apicurio-registry-maven-plugin')));
  }
  assert.equal(pipeline.spec.tasks.some(task => task.taskSpec), false);
  assert.equal(resources.some(item => item.kind === 'Secret'), false);

  const triggerTemplate = resource(resources, 'TriggerTemplate', 'orders-api');
  const taskRunSpecs = triggerTemplate.spec.resourcetemplates[0].spec.taskRunSpecs;
  assert.equal(taskRunSpecs.find(item => item.pipelineTaskName === 'publish-git-version')
    .podTemplate.env.some(item => item.valueFrom?.secretKeyRef?.name === 'apicurio-client'), true);
  assert.equal(taskRunSpecs.find(item => item.pipelineTaskName === 'microcks-import')
    .podTemplate.env.some(item => item.valueFrom?.secretKeyRef?.name === 'microcks-client'), true);
  assert.doesNotMatch(YAML.stringify(resources), /dockerconfigjson/i);
});
