# Release and compatibility

`developer-charts` versions the tenant runtime/chart contract: accepted values, discovery file
structures, and rendered OpenShift resources. Its root `release.yaml` declares the compatible
PlatformTarget contract range. It has no dependency on software-templates; templates consume it.

Patch releases repair chart implementation and keep the same platform requirement. Minor releases
may add chart capability and raise the minimum platform-components version. Major releases denote
incompatible chart values or generated-tenant contract changes that may require migration.

The Domain entrypoint validates the selected PlatformTarget version with Helm's standard SemVer
support before rendering any child ApplicationSets. The checked-in test ties that runtime range to
`release.yaml`, avoiding an independent undocumented constraint.

A compatibility range such as `platformComponents: ">=1.0.0 <2.0.0"` does not select code. The
PlatformTarget still pins an exact tag such as `v1.0.1`, and generated Argo CD Applications retain
that exact revision until the platform operator deliberately upgrades it.
