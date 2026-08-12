const assert = require('node:assert/strict');
const YAML = require('yaml');
const {chartValues, fixture, render} = require('./helpers/helm');

function hasInlineTaskSpec(value) {
  if (Array.isArray(value)) return value.some(hasInlineTaskSpec);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'taskSpec' || hasInlineTaskSpec(child));
}

test('all developer charts render no Tasks and no inline taskSpec', () => {
  const component = chartValues('charts/component/container');
  component.build.enabled = true;
  component.environment = component.build.environment;
  component.image.tag = 'latest';
  const rendered = [
    ...render('charts/component/container', component),
    ...render('charts/api/openapi', chartValues('charts/api/openapi')),
    ...render('charts/domain/environment', fixture('split-scm.yaml')),
    ...render('charts/system/environment', fixture('nonstandard-lifecycle.yaml')),
    ...render('charts/resource/postgresql', chartValues('charts/resource/postgresql')),
  ];
  assert.equal(rendered.some(resource => resource.kind === 'Task'), false,
    YAML.stringify(rendered.filter(resource => resource.kind === 'Task')));
  assert.equal(hasInlineTaskSpec(rendered), false);
});
