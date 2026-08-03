# Platform requirements

Validate these dependencies before attaching a tenant Domain to the cluster.

## Argo CD and OpenShift GitOps

Required capabilities:

- `Application` and `ApplicationSet` CRDs;
- multi-source Applications with `$values` Helm value-file references;
- ApplicationSet Go templates and merge generators;
- a platform-generated per-Domain admission AppProject and parent Application;
- permission for Domain and System Applications to create their derived AppProjects;
- access from Argo CD to the platform chart and tenant repositories, including credentials for any
  private source;
- the destination server configured by the selected platform target.

The generated AppProjects are currently organizational and permissive. Review their source,
destination, namespace, cluster, and resource-kind policy before production adoption.

## OpenShift Pipelines

Enable the Tekton cluster resolver:

```yaml
enable-cluster-resolver: true
```

Verify the required Tasks:

```bash
oc get task -n openshift-pipelines git-clone buildah skopeo-copy
oc get task -n tekton-tasks maven
```

The charts use `tekton.dev/v1` Pipelines and PipelineRuns plus Tekton Triggers
`triggers.tekton.dev/v1beta1` resources with CEL interceptors. `git-clone`, `buildah`, and
`skopeo-copy` are expected in `openshift-pipelines`. The platform-curated `maven` Task in
`tekton-tasks` must support Java 21, the `GOALS` and `JAVA_VERSION` parameters, and the `source` and
`maven_settings` workspaces.

Launcher Jobs use the Red Hat `tkn` CLI image. The charts create the build-environment `pipeline`
ServiceAccount, but non-build promotion also assumes a `pipeline` ServiceAccount exists in every
target namespace. Confirm the OpenShift Pipelines installation provisions it or manage it through
platform bootstrap.

The configured build ServiceAccount must be allowed to run Pipelines under the platform's selected
pipelines SCC. The current `build.sccClusterRoleName` value is reserved and does not create that
authorization; grant it outside these charts.

The rendered resources also pin operational tool images:

| Purpose | Image |
| --- | --- |
| Follow or launch PipelineRuns | `registry.redhat.io/openshift-pipelines/pipelines-cli-tkn-rhel8:v1.15.4` |
| Validate API documents | `stoplight/spectral:6.15.0` through `spectral-quality-gate` |
| Query OpenShift and restart Deployments | `quay.io/openshift/origin-cli:4.16` |
| Inspect and copy image manifests | `quay.io/skopeo/stable:v1.17.0` |

Mirror or approve these images according to platform supply-chain policy and test upgrades before
changing their pins.

## Schema Registry

The Domain declares one enterprise Registry API URL, and the environment Application supplies the
same platform value to the charts. It must be reachable from:

- the API publication Pipeline;
- generated Component Maven builds;
- any developer environment that runs publication locally.

API publication uses the generated repository's official Apicurio Registry Maven plugin
configuration. The charts do not expose a Registry credential or credential workspace, so the
endpoint must accept these Maven requests without authentication. An authenticated Registry
requires a platform-customized Maven Task or an extension to the values and workspace contract.

## Quay Bridge

Domain platform values must match the installed `QuayIntegration`:

```yaml
spec:
  platform:
    registry:
      quay:
        host: quay.example.com
        clusterId: openshift
        credentials:
          sourcePullSecretName: default-quay-openshift
          destinationPushSecretName: builder-quay-openshift
          runtimePullSecretName: default-quay-openshift
```

The `component/environment` chart creates an ImageStream for each active Component environment.
Quay Bridge responds by provisioning the environment-local repository and robot credentials.

Confirm that:

- the observed Secret names match the configured values;
- the build ServiceAccount can push to the build repository;
- runtime pods can pull from the current environment repository;
- the target promoter can read only the named source credential in the immediately preceding
  namespace;
- a `pipeline` ServiceAccount exists in every target namespace and can run the promotion
  PipelineRun;
- robot tokens have the expected Quay ACLs.

Kubernetes RBAC can restrict access to a Secret object but cannot narrow permissions embedded in
the robot token itself.

## Resource operators

The PostgreSQL profile requires:

- the Crunchy Postgres Operator;
- the `PostgresCluster` CRD;
- any requested storage classes.

Do not enable a Resource profile until its CRDs and controllers are healthy on the target cluster.

## Source repository access

Tenant source repositories are currently public. Tekton clones anonymously and receives no Git
credential workspace. Private source repositories require an additional credential-distribution
design and are not supported by these charts.

## Webhook exposure

Webhook signature verification is reserved in the values contracts but is not implemented.
EventListener Routes should be treated as lab or development endpoints until a complete
shared-secret design is added.

## Readiness checklist

- Argo CD can read platform and tenant repositories.
- Argo CD supports multi-source Applications, `$values`, Go templates, and merge generators.
- the Domain's admission AppProject and parent Application exist after its platform pull request merges.
- Tekton's cluster resolver is enabled.
- All four required Tasks resolve in their expected namespaces.
- Tekton v1 Pipelines and v1beta1 Triggers with CEL interceptors are available.
- Build and target `pipeline` ServiceAccounts exist and can use the required SCC.
- Schema Registry is reachable at the target-owned URL and accepts the configured unauthenticated Maven
  requests.
- Required operational images are approved or mirrored.
- Quay Bridge creates the configured credential Secrets.
- Quay robot ACLs match the intended source, destination, and runtime access.
- Required Resource operators and CRDs are healthy.
