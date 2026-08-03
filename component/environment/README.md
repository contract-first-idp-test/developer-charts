# Component environment chart

Creates the environment-local ImageStream for one Component.

## Why this chart is separate

Registry infrastructure has a different lifecycle signal from a runtime release. The System chart
creates this Application from `components/<component>/environments/<environment>.yaml`, even when
no release file exists.

This allows Quay Bridge to provision the target environment repository and namespace-local robot
credentials before an image is promoted into it.

## Inputs and output

| Value | Purpose |
| --- | --- |
| `systemName` | System identity |
| `componentName` | Component and image repository identity |
| `environment` | Environment-local ImageStream context |

The chart renders one ImageStream. Quay Bridge owns the resulting external repository and
credentials; this chart creates neither credentials nor a `QuayIntegration`.

## Validate

```bash
helm lint component/environment
helm template example-component component/environment -f /path/to/environment-values.yaml
```

See [Platform requirements](../../docs/platform-requirements.md#quay-bridge) for the expected Quay
integration.
