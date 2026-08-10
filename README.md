# Contract-First IDP Developer Charts

Reusable Helm charts that translate reviewed tenant Git state into OpenShift resources.

This repository is primarily for platform engineers who maintain runtime policy and contributors
who change the template-to-chart contract. Application developers normally use Developer Hub
golden paths and edit generated repositories rather than working with these charts directly.

## Overview

Argo CD combines tenant-owned desired state with these platform-owned implementations. The charts
discover active Systems, APIs, Components, releases, and Resources, then reconcile namespaces,
Pipelines, registry infrastructure, workloads, and managed Resources. No chart writes back to a
tenant repository.

If you are installing the workshop platform, start in `platform-components`. The tenant Git
contracts consumed by these charts are produced by `software-templates`.

## Chart Hierarchy

```text
Domain environment
  -> System environment
      -> OpenAPI publication
      -> OpenJDK Component
      -> PostgreSQL Resource
```

| Chart | Responsibility | Chart guide |
| --- | --- | --- |
| `domain/environment` | Discover active Systems for each Domain environment | [README](charts/domain/environment/README.md) |
| `system/environment` | Create the System scope and discover leaf desired state | [README](charts/system/environment/README.md) |
| `api/openapi` | Validate and publish OpenAPI contracts | [README](charts/api/openapi/README.md) |
| `component/openjdk` | Build, release, promote, and run OpenJDK Components | [README](charts/component/openjdk/README.md) |
| `resource/postgresql` | Reconcile a Crunchy PostgreSQL Resource | [README](charts/resource/postgresql/README.md) |

All charts in this coordinated release use chart version `1.0.0` and are consumed from repository
revision `v1.0.0`.

## Architecture at a Glance

The Domain chart reads environment policy and System activation files. Each active System chart
then discovers its API, Component, release-selection, and Resource files. Leaf charts interpret
that desired state using platform-owned registry, Pipeline, operator, and security configuration.

Tenant Git decides what should run; these charts decide how supported intent is implemented. See
[Architecture](docs/architecture.md) for the discovery patterns, values flow, project ownership,
release materialization, and promotion contracts.

## Quick Validation

Node.js, npm, and Helm are required. GitHub Actions uses Helm `v3.17.3`.

```bash
helm version --short
make test
```

The direct equivalent is `npm ci --prefix test` followed by `npm test --prefix test`. The local
suite lints every chart and renders representative lifecycle scenarios without a live cluster or
sibling checkout. See [Development and testing](docs/development.md) for focused and coordinated
checks.

## Documentation

- [Architecture](docs/architecture.md) — reconciliation hierarchy, discovery, values ownership,
  release, and promotion
- [Development and testing](docs/development.md) — local validation and cross-repository checks
- [Operations and troubleshooting](docs/operations.md) — build, publication, promotion, and Argo CD
  recovery
- [Platform requirements](docs/platform-requirements.md) — required controllers, Tasks,
  credentials, access, and readiness checks
- [Individual chart guides](charts/) — chart-specific behavior and values

## Repository Structure

| Path | Purpose |
| --- | --- |
| `charts/domain/environment/` | Domain environment discovery |
| `charts/system/environment/` | System scope and leaf ApplicationSets |
| `charts/api/openapi/` | OpenAPI validation and Registry publication |
| `charts/component/openjdk/` | Component ImageStream, build, runtime, release, and promotion |
| `charts/resource/postgresql/` | PostgreSQL Resource implementation |
| `docs/` | Architecture, development, operations, and platform requirements |
| `test/` | Rendered contract tests and fixtures |

Each chart includes a `values.schema.json` and a local README for its public values and behavior.
