# Release policy

`developer-charts` is independently versioned and owns tenant chart values, schemas, and rendered
resource contracts. It consumes the platform contract through root `release.yaml`:

```yaml
version: 1.0.0
requires:
  platformComponents: ">=1.0.0 <2.0.0"
```

A patch fixes implementation behavior and must preserve `requires` exactly. A minor adds
capability and may raise the platform minimum. A major is an incompatible chart contract change.
A chart patch does not require a platform-components or software-templates release when their
existing ranges already include it.

All repository-owned `Chart.yaml` versions match the repository release. Installations select an
exact immutable Git tag separately from the compatibility range.

## Release procedure

1. Choose SemVer from changes to the chart contract.
2. Update `release.yaml` and repository-owned chart versions.
3. Run `make release-check`.
4. Run applicable sibling compatibility checks.
5. Commit and push.
6. Create and push the exact `vX.Y.Z` tag.
7. Verify tag CI.
8. Select the new exact tag in platform configuration when desired.

The validator uses `node-semver`, requires tag/version equality and monotonic versions, rejects
patch dependency changes, and checks repository-owned chart versions.
