# Release and compatibility model

The repositories remain independently versioned:

```text
software-templates -> developer-charts -> platform-components
software-templates ----------------------> platform-components
```

`developer-charts` consumes the PlatformTarget contract and owns tenant runtime, Helm values,
schemas, and rendered-resource contracts. Root `release.yaml` is authoritative:

```yaml
version: 1.0.0
requires:
  platformComponents: ">=1.0.0 <2.0.0"
```

The compatibility range states which platform contracts the charts accept; an installation still
selects one exact immutable chart tag. All distributed first-party `Chart.yaml` versions, and
their repository-owned `appVersion` fields where present, match the repository release.

A patch fixes implementation behavior, must preserve dependency requirements exactly, and does not
require another repository release. A minor adds capability and may raise the platform minimum. A
major is an incompatible chart/runtime contract change. For example, a hypothetical `1.0.1`
chart patch keeps the range above, while a hypothetical `1.1.0` may require
`platformComponents: ">=1.1.0 <2.0.0"`.

## Release procedure

1. Decide this repository's SemVer from changes to its chart/runtime contract.
2. Update `release.yaml` and every repository-owned chart version.
3. Run `make release-check`.
4. Run any required cross-repository compatibility checks.
5. Commit and push the verified release candidate.
6. Create the exact `vX.Y.Z` tag at that commit.
7. Push the tag and verify the tag-triggered GitHub Actions gate.
8. Update platform configuration to the desired exact compatible chart tag.

The release validator uses `node-semver`, checks tag/version consistency and monotonicity,
compares dependency requirements with the previous tag for patches, and rejects stale chart
versions. A patch release in one repository does not require a release in another repository when
the existing compatibility ranges already include it.
