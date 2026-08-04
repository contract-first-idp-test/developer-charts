const assert = require('node:assert/strict');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('component environment lints and creates only the environment ImageStream', () => {
  const values = chartValues('charts/component/environment');
  values.systemName = 'orders';
  values.componentName = 'checkout';
  values.environment = 'stage';
  lint('charts/component/environment', values);
  const resources = render('charts/component/environment', values);
  resource(resources, 'ImageStream', 'checkout');
  assert.deepEqual(resources.map(item => item.kind), ['ImageStream']);
});
