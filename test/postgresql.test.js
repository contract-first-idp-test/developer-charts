const assert = require('node:assert/strict');
const {chartValues, lint, render, resource} = require('./helpers/helm');

test('PostgreSQL lints and applies storage, database, and ownership values', () => {
  const values = chartValues('charts/resource/postgresql');
  values.clusterName = 'orders-db-stage';
  values.storage = {size: '25Gi', storageClass: 'fast-block'};
  values.user = {name: 'orders_owner', database: 'orders'};
  lint('charts/resource/postgresql', values);
  const cluster = resource(render('charts/resource/postgresql', values),
    'PostgresCluster', 'orders-db-stage');
  assert.equal(cluster.spec.instances[0].dataVolumeClaimSpec.resources.requests.storage,
    '25Gi');
  assert.equal(cluster.spec.instances[0].dataVolumeClaimSpec.storageClassName, 'fast-block');
  assert.deepEqual(cluster.spec.users, [{
    name: 'orders_owner',
    databases: ['orders'],
    password: {type: 'AlphaNumeric'},
  }]);
});
