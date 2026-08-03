const assert = require('node:assert/strict');
const test = require('node:test');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('component environment lints and creates only the environment ImageStream', () => {
  const values = chartValues('component/environment');
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.environment = 'stage';
  lint('component/environment', values);
  const resources = render('component/environment', values);
  resource(resources, 'ImageStream', 'checkout');
  assert.deepEqual(resources.map(item => item.kind), ['ImageStream']);
});
