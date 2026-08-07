# Operations and troubleshooting

This guide focuses on expected convergence behavior and safe retry procedures.

## Start with ownership

Before retrying anything, identify the controller that owns the failed object:

| Object or state | Owner |
| --- | --- |
| Parent Domain Application | Platform tenant admission |
| Domain and System AppProjects | Parent Domain or build-environment System Application |
| ApplicationSets and leaf Applications | Domain or System chart |
| Initial API publication Job | OpenAPI chart |
| Initial Component build Job | OpenJDK Component chart |
| Promotion launcher Job | OpenJDK Component chart |
| Promotion Pipeline and RBAC | System chart |
| ImageStream, Deployment, Service, and Route | OpenJDK Component chart |

Prefer changing Git or retrying a documented Job/Pipeline over editing a rendered object in place.

## Initial API publication

The initial-publish Job is an Argo CD Sync hook. It waits for the API PipelineRun and makes sync
failure visible when validation or publication fails.

Check:

1. the API repository revision and public clone access;
2. `specification.yaml` syntax and required OpenAPI fields;
3. the `git-clone` and Java 21 `maven` Task resolution;
4. the Schema Registry URL and network reachability;
5. the PipelineRun and Maven logs.

A successful named hook Job is retained to prevent ordinary syncs from republishing the same
revision. A failed hook is removed through `HookFailed`, so a later Argo CD sync can retry it after
the underlying problem is fixed.

## Initial Component build

The initial-build Job follows the PipelineRun with
`tkn --showlog --exit-with-pipelinerun-error`. If the Pipeline fails, the Argo CD sync fails.

Check:

1. anonymous clone access to the Component repository;
2. Maven dependency and Schema Registry access;
3. build ServiceAccount and SCC permissions;
4. Quay push credentials and repository provisioning;
5. Dockerfile path and implementation profile.

As with API publication, a successful Job is retained and a failed hook is retryable on a later
sync.

## Component release materialization

A human Git tag such as `v1.7.3` does not rebuild source. The Pipeline resolves the peeled commit,
then attempts to copy the existing `git-<sha>` image to `v1.7.3`.

If it fails:

- confirm the tag matches the accepted release grammar;
- verify the corresponding main commit image exists;
- inspect access to the build repository's push credential;
- check whether the human tag already exists and which digest it references.

The current materialization task does not wait for a missing commit image and does not protect an
existing human tag from replacement. Retry only after confirming the commit image exists and the
release tag has not been moved. Enforce human-tag immutability in Quay or through release policy.

## Promotion launcher failures

Each non-build release has a deterministic launcher Job name based on Component, target
environment, and release. If launcher creation itself fails, delete only that release-specific Job
and let Argo CD recreate it:

```bash
oc delete job <launcher-job> -n <target-namespace>
```

Use this only after fixing the root cause, such as missing Pipeline readiness or local RBAC.

## Promotion Pipeline failures

The launcher exits after successfully creating a PipelineRun; it does not follow promotion logs.
If Tekton later fails, rerun the target-local `promote-image` Pipeline with the same Component and
human release tag.

This retry is idempotent:

- an existing matching destination digest succeeds;
- a different destination digest fails;
- the source Secret remains in the preceding namespace;
- authentication is removed from ephemeral storage after the Task.

## Temporary ImagePullBackOff

The target Deployment and promotion PipelineRun reconcile independently. The Deployment can appear
before the image copy finishes, producing a temporary `ImagePullBackOff`. This is expected when:

- the launcher submitted the PipelineRun successfully;
- the PipelineRun is still active or about to start;
- Kubernetes continues retrying pulls.

Investigate when the PipelineRun has failed, no PipelineRun was created, or the error remains after
the destination tag and digest are available.

## AppProject conflicts

Only build-environment Applications should create derived projects:

| Project | Expected creator |
| --- | --- |
| `tenant-<domain>` | Domain build-environment Application |
| `tenant-<domain>-<system>` | System build-environment Application |

If several Applications claim the same AppProject, confirm the Domain lifecycle's build
designation and verify non-build renders do not include the project template.

## Escalation information

Capture the following before escalating:

- Domain, System, Component or API, and environment names;
- Argo CD Application health and sync status;
- failed Job and PipelineRun names;
- relevant controller or Task logs;
- selected Git revision or human release tag;
- source and target image digests, when promotion is involved;
- whether the expected Quay credential Secrets exist, without copying their contents.
