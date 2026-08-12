# Platform requirements

[Back to the repository overview](../README.md)

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
oc get task -n tekton-tasks maven nodejs microcks-cli assert-image-tag-compatible
```

The charts use `tekton.dev/v1` Pipelines and PipelineRuns plus Tekton Triggers
`triggers.tekton.dev/v1beta1` resources with CEL interceptors. `git-clone`, `buildah`, and
`skopeo-copy` are expected in `openshift-pipelines`. The platform-curated generic Tasks in
`tekton-tasks` provide Maven (including a selectable approved Java/Mandrel image and Maven-wrapper
fallback), Node 24 scripts, Microcks CLI scripts, and the release digest guard. The installed
`skopeo-copy` Task must expose the uppercase
`SOURCE_IMAGE_URL`, `DESTINATION_IMAGE_URL`, `SRC_TLS_VERIFY`, `DEST_TLS_VERIFY`, and `VERBOSE`
parameters, the optional `images_url` workspace, and the `SOURCE_DIGEST` and
`DESTINATION_DIGEST` results. CF-IDP's single-image copies supply the source and destination URLs
plus both TLS verification parameters.

Launcher Jobs use the Red Hat `tkn` CLI image. The charts create each build or promotion
`pipeline` ServiceAccount with its required namespace-local registry Secret references. The
OpenShift Pipelines credential initializer must be enabled so `kubernetes.io/dockerconfigjson`
Secrets associated with that ServiceAccount are merged into `$HOME/.docker/config.json` for the
guard and curated copy Task.

CF-IDP declares those Tekton credentials under `ServiceAccount.secrets` and does not manage
`ServiceAccount.imagePullSecrets`, which OpenShift mutates with generated registry references. The
platform Argo CD instance ignores `/imagePullSecrets` globally for ServiceAccounts. Runtime
Deployment pull credentials remain separately declared through the component chart's pod-level
`imagePullSecrets` support.

The configured build ServiceAccount must be allowed to run Pipelines under the platform's selected
pipelines SCC. The current `build.sccClusterRoleName` value is reserved and does not create that
authorization; grant it outside these charts.

The rendered resources also pin operational tool images:

| Purpose | Image |
| --- | --- |
| Follow or launch PipelineRuns | `registry.redhat.io/openshift-pipelines/pipelines-cli-tkn-rhel8:v1.15.4` |
| Validate API documents | `stoplight/spectral:6.15.0` through `spectral-quality-gate` |
| Query OpenShift and restart Deployments | `registry.redhat.io/openshift4/ose-cli` |
| Inspect image digests for the release-version guard | `quay.io/skopeo/stable:v1.17.0` |

Mirror or approve these images according to platform supply-chain policy and test upgrades before
changing their pins.

## Schema Registry

The Domain declares one enterprise Registry API URL, and the environment Application supplies the
same platform value to the charts. It must be reachable from:

- the API publication Pipeline;
- generated Component Maven builds;
- any developer environment that runs publication locally.

API publication uses the generated repository's official Apicurio Registry Maven plugin with a
per-Domain OIDC client. Anonymous reads remain supported, while writes require authentication and
Apicurio's hard owner/group authorization. A Domain-specific ESO store may project the client only
into the namespace labeled for both that admitted Domain and its trusted build environment. The
same namespace receives a separate per-Domain Microcks client for the trusted shared repository.

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

The `charts/component/container` chart creates an ImageStream as soon as a Component environment is
active. Quay Bridge responds by provisioning the environment-local repository and robot
credentials; workload resources remain absent until `image.tag` selects an image.

Promotion credential distribution also requires External Secrets Operator with the Kubernetes
provider. Each activated target environment creates a dedicated reader identity, grants it `get`
on only the configured pull Secret in the immediately preceding namespace, and materializes a
Docker-config Secret in its own namespace. Its auth entry is narrowed to the source Quay
organization path so Tekton can merge it with the target robot credential on the same registry
host. The target `pipeline` ServiceAccount does not read Secrets across namespaces.

Confirm that:

- the observed Secret names match the configured values;
- the build ServiceAccount can push to the build repository;
- runtime pods can pull from the current environment repository;
- the External Secrets reader can read only the named source credential in the immediately
  preceding namespace;
- the generated target-local source pull Secret and target push Secret are both referenced by the
  target `pipeline` ServiceAccount;
- the `pipeline` ServiceAccount can run the promotion PipelineRun and the curated Task can resolve;
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
- Build and target `pipeline` ServiceAccounts exist, contain the expected `secrets` registry
  references, and can use the required SCC.
- Schema Registry is reachable at the target-owned URL and accepts the configured unauthenticated Maven
  requests.
- Required operational images are approved or mirrored.
- Quay Bridge creates the configured credential Secrets.
- External Secrets reports the promotion `SecretStore` and generated source credential Ready.
- Quay robot ACLs match the intended source, destination, and runtime access.
- Required Resource operators and CRDs are healthy.
