# Domain chart

Discovers the Systems active across every ordered Domain environment in one Helm render.

The chart reads tenant identity and lifecycle policy from the Domain catalog entity, and trusted
Argo CD, router-domain, chart, Schema Registry, Quay, and build configuration from `spec.platform`.
It creates one Domain AppProject and one System-discovery ApplicationSet per ordered environment.
Each ApplicationSet watches `systems/*/environments/<environment>.yaml`; a missing activation file
means that System is inactive in that environment.

Required values are `metadata`, `spec.platformTarget`, `spec.groupId`, `spec.environments`, and
`spec.platform`. Domain definitions own only `namespaceSuffix`. The chart synthesizes the current
System-chart environment contract by combining those suffixes with
`spec.platform.cluster.routerDomain`.

The build environment must exist, be ordered, and be first. All ordered environments must have
valid definitions. Removing an environment removes only its ApplicationSet through normal Argo CD
pruning.

Tenant annotations locate the Domain repository. `spec.platform.charts.repositoryUrl` and `revision`
locate the trusted chart repository directly. `spec.platform.schemaRegistry`,
`spec.platform.registry`, and `spec.platform.build` pass target-owned runtime policy downstream.

```bash
helm lint domain
helm template tenant-domain domain -f /path/to/merged-domain-and-target-values.yaml
```
