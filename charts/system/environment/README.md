# System chart

Creates one active System environment. Every environment discovers its Components, releases, and
Resources; the build environment also discovers APIs.

## Discovery paths

| Pattern | Scope | Result |
| --- | --- | --- |
| `apis/*/values.yaml` | Build environment only | API specification-build Applications |
| `components/*/environments/<environment>.yaml` | Selected environment | Component environment Applications |
| `components/*/releases/<environment>.yaml` | Selected environment | Component runtime Applications |
| `resources/*/*/environments/<environment>.yaml` | Selected environment | Resource implementation Applications |

Component infrastructure and runtime are deliberately independent. A target Quay repository can
exist before a release is selected, and a Component source repository can exist before either.

## Responsibilities

The chart creates:

- the environment-specific System namespace;
- the System AppProject from the build environment only;
- Component environment, Component runtime, and Resource ApplicationSets in every environment;
- the API ApplicationSet in the build environment;
- build RBAC in the Domain's build environment;
- adjacent image-promotion RBAC and Pipeline resources in later environments.

Resource declarations select a supported implementation path. The trusted repository and revision
come from `delivery.charts`, so tenant state cannot redirect Argo CD to another implementation.

## Required inputs

| Values | Purpose |
| --- | --- |
| `domainName`, `systemName`, `groupId`, `owner` | Catalog identity and ownership |
| `systemRepository` | Tenant desired-state source |
| `environment` and `environments` | Selected environment and full lifecycle |
| `delivery` | Argo CD namespace, AppProject, destination, and trusted charts |
| `registry` | Quay host, cluster ID, and credential names |
| `schemaRegistry.apiUrl` | API publication endpoint |
| `build` | Build environment, revision, and rollout policy; `sccClusterRoleName` is currently reserved |

## AppProject ownership

The build-environment System Application creates `tenant-<domain>-<system>` at sync wave 0. Every
System-owned ApplicationSet renders at wave 1 and assigns its leaf Applications to that project.
Non-build environments use the project without recreating it.

## Promotion security model

```mermaid
flowchart TD
    accTitle: Promotion credential flow
    accDescr: The target image-promoter service account creates a PipelineRun. The target pipeline service account receives narrowly scoped access to the preceding namespace credential and runs the copy into the target repository.
    promoter["Target image-promoter<br/>ServiceAccount"] -->|Create PipelineRun| run[Target promote-image PipelineRun]
    source["Preceding namespace<br/>named source credential"]
    pipelineSa["Target pipeline<br/>ServiceAccount"]
    source -->|Secret get through RBAC| pipelineSa
    pipelineSa -->|Run copy Task| run
    run -->|Copy and verify digest| target[Target-local Quay repository]
```

The first ordered environment has build RBAC and no incoming promotion Pipeline. Each later
environment receives a promoter, Pipeline, and Skopeo Task fixed to the immediately preceding
environment. The `image-promoter` ServiceAccount can submit the target-local PipelineRun but cannot
read the source Secret. The target namespace's `pipeline` ServiceAccount receives that narrowly
scoped read. RBAC grants no reverse, non-adjacent, or cross-namespace PipelineRun access.

## Validate

```bash
helm lint charts/system/environment
helm template tenant-system charts/system/environment -f /path/to/system-values.yaml
```

See [Architecture](../../../docs/architecture.md#image-promotion) and
[Operations](../../../docs/operations.md#promotion-pipeline-failures) for the full promotion model.
