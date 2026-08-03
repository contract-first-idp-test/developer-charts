{{- define "contract-first-idp.platformChartsRepository" -}}
{{- .Values.spec.platform.charts.repositoryUrl -}}
{{- end -}}

{{/*
Build a clone URL from tenant SCM coordinates, accepting either a hostname or HTTP(S) base URL.
*/}}
{{- define "contract-first-idp.tenantRepository" -}}
{{- $host := trimSuffix "/" .host -}}
{{- if not (contains "://" $host) -}}
{{- $host = printf "https://%s" $host -}}
{{- end -}}
{{- printf "%s/%s/%s.git" $host (trimAll "/" .org) .repository -}}
{{- end -}}

{{/*
Derived Argo CD project names for the Domain -> System hierarchy.
*/}}
{{- define "contract-first-idp.domainProjectName" -}}
{{- printf "tenant-%s" .domainName -}}
{{- end -}}

{{- define "contract-first-idp.systemProjectName" -}}
{{- printf "tenant-%s-%s" .domainName .systemName -}}
{{- end -}}
