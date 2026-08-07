# OpenJDK Component chart

Reconciles one OpenJDK Component environment in a single Argo CD Application.

The chart always creates the environment-local ImageStream. An optional release value file supplies
`image.tag`; until a tag is selected, Deployment, Service, Route, and promotion resources remain
absent. There is no separate Component infrastructure Application.

## Rendered capabilities

| Condition | Resources |
| --- | --- |
| Every active Component environment | ImageStream |
| `image.tag` is set | Deployment, Service, optional Route, and runtime configuration |
| `build.enabled: true` and `environment == build.environment` | Pipeline, Triggers, webhook Route, and initial-build hook |
| Non-build environment with a human `image.tag` | Deterministic release-specific promotion launcher Job |

The build-environment release may select `latest`. Promoted environments require an immutable
human tag such as `v1.2.3`.

## Build and human release paths

Main pushes and release tags invoke one Component Pipeline:

| Path | Behavior |
| --- | --- |
| Main push | Package source with tests skipped, publish `git-<full-commit-sha>`, update `latest`, and optionally restart the runtime |
| Human tag | Resolve the tagged commit, find its existing commit image, and create the human tag on the same digest |

The release path accepts `v<major>[.<minor>[.<patch>]][-<prerelease>]`. It never packages source,
rebuilds an image, updates `latest`, or restarts the runtime. The task makes one copy attempt and
does not check whether the human tag already exists, so Quay or release policy must prevent tag
movement.

The Pipeline resolves Operator-managed `git-clone` and `buildah` Tasks from `openshift-pipelines`
and the curated Java 21 `maven` Task from `tekton-tasks`. Source repositories are public and cloned
without a Git credential.

## Initial build

The initial-build Job is an Argo CD Sync hook:

| Sync wave | Resources |
| ---: | --- |
| 1 | Pipeline and Trigger resources |
| 2 | Initial-build hook Job |
| 3 | Runtime Deployment |

The Job follows the PipelineRun with `tkn` and fails the sync when the build fails. Successful Jobs
are retained so ordinary syncs do not rebuild unchanged source. Failed Jobs are removed to allow a
later sync retry.

## Promotion launcher

A non-build release renders a regular GitOps-managed launcher Job. Its deterministic name includes
the Component, target environment, and human release version. The launcher:

1. waits for the target-local `promote-image` Pipeline with a bounded retry;
2. starts a PipelineRun with the Component and human release tag;
3. confirms submission succeeded;
4. exits without following the promotion logs.

Deployment and promotion converge independently, so temporary `ImagePullBackOff` is expected while
the image is copied.

See [Operations](../../../docs/operations.md#promotion-launcher-failures) for safe retry procedures.

## Runtime configuration

| Values | Effect |
| --- | --- |
| `runtime.resources` | Container requests and limits |
| `runtime.env` | Explicit environment variables |
| `runtime.envFromSecretNames` | Secret-backed `envFrom`; omitted when empty |
| `runtime.imagePullSecretNames` | Pod-level pull Secrets; omitted when empty |
| `runtime.health` | Readiness and liveness paths, port, delays, and periods |
| `route.enabled` | OpenShift Route creation |

Runtime Secrets, including Quay pull credentials, must be created and synchronized outside this
chart.

## Security notes

- Release materialization mounts the configured registry push Secret read-only for the duration of
  its Task.
- The chart creates neither Quay credentials nor the `QuayIntegration`.
- Webhook signature verification is reserved but not implemented; exposed EventListeners are
  lab/development-only.

## Validate

```bash
helm lint charts/component/openjdk
helm template example-component charts/component/openjdk -f /path/to/component-values.yaml
```
