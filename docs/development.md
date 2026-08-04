# Development and testing

Use this guide when changing chart templates, schemas, platform contracts, or test fixtures.

## Prerequisites

- Node.js and npm
- Helm on `PATH`
- A sibling `software-templates` checkout only for the optional producer/consumer compatibility
  test

No live cluster is required for the default suite.

## Run the chart suite

```bash
npm ci
npm test
```

The Jest test runner:

- lints all charts;
- renders representative build and non-build environments;
- parses multi-document YAML;
- validates discovery, lifecycle, project ownership, RBAC, build, publication, and promotion
  contracts;
- exercises split platform/tenant SCM;
- uses nonstandard environment names to catch hard-coded lifecycle assumptions.

## Focused Helm feedback

Lint an individual chart:

```bash
helm lint charts/domain/system-discovery
helm lint charts/system/environment
helm lint charts/component/environment
helm lint charts/component/runtime
helm lint charts/api/specification-build
helm lint charts/resource/postgresql
```

Render with explicit values:

```bash
helm template tenant-domain charts/domain/system-discovery \
  -f /path/to/merged-target-and-domain-entities.yaml
```

Keep example values valid against each chart's `values.schema.json`.

## Cross-repository compatibility

The software templates produce the values and discovery files consumed by these charts. From the
sibling repository, run:

```bash
cd ../software-templates
npm ci
DEVELOPER_CHARTS_DIR=../developer-charts npm run test:chart-compat
```

Run this whenever changing a values key, discovery path, Domain entrypoint, or leaf chart input.

## Change checklist

- Update `values.schema.json` when the public values contract changes.
- Add or update a rendered contract assertion.
- Preserve split tenant/platform SCM behavior.
- Test both build and non-build environments when lifecycle logic changes.
- Test an adjacent promotion and reject mutable or non-adjacent release inputs.
- Verify only build-environment renders create derived AppProjects.
- Run `npm test`.
- Run the template compatibility suite when producer inputs change.
- Update the chart README and architecture guide for operating or ownership changes.
