# PostgreSQL Resource profile

Implements one Contract-First IDP Resource as a Crunchy `PostgresCluster`.

The generic Resource ApplicationSet in the System chart layers System-owned common values with one
environment file, then supplies the System, Resource, and environment-specific cluster names.

## Inputs

| Values | Purpose |
| --- | --- |
| `systemName`, `resourceName`, `clusterName` | Catalog and cluster identity |
| `postgresVersion` | PostgreSQL major version |
| `instances.replicas` | Database instance count |
| `storage` | Volume size and optional storage class |
| `user` | Initial application user and database |

## Platform dependency

The target cluster must have the Crunchy Postgres Operator and `PostgresCluster` CRD installed.
Requested storage classes must also exist.

Tenant Resource state selects this supported profile but cannot override the trusted platform chart
repository or revision.

## Validate

```bash
helm lint resource/postgresql
helm template example-db resource/postgresql -f /path/to/postgresql-values.yaml
```
