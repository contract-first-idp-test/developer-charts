{{/*
Approved build/runtime recipes. Tenant Git selects only build.profile; image, command,
Dockerfile, and runtime defaults remain platform-owned here.
*/}}
{{- define "component.buildRecipe" -}}
{{- $recipes := dict
  "quarkus-jvm" (dict
    "executor" "maven"
    "task" "maven"
    "taskNamespace" "tekton-tasks"
    "builderImage" "registry.access.redhat.com/ubi9/openjdk-21:1.24"
    "goals" (list "clean" "verify" "-B")
    "dockerfilePath" "./src/main/docker/Dockerfile.jvm"
    "runtimePort" 8080
    "healthPort" 9000
    "readinessPath" "/q/health/ready"
    "livenessPath" "/q/health/live")
  "quarkus-native" (dict
    "executor" "maven"
    "task" "maven"
    "taskNamespace" "tekton-tasks"
    "builderImage" "quay.io/quarkus/ubi9-quarkus-mandrel-builder-image:jdk-21"
    "goals" (list "clean" "verify" "-Dnative" "-DskipITs" "-B")
    "dockerfilePath" "./src/main/docker/Dockerfile.native"
    "runtimePort" 8080
    "healthPort" 9000
    "readinessPath" "/q/health/ready"
    "livenessPath" "/q/health/live")
  "spring-boot" (dict
    "executor" "maven"
    "task" "maven"
    "taskNamespace" "tekton-tasks"
    "builderImage" "registry.access.redhat.com/ubi9/openjdk-21:1.24"
    "goals" (list "clean" "verify" "-B")
    "dockerfilePath" "./src/main/docker/Dockerfile"
    "runtimePort" 8080
    "healthPort" 8081
    "readinessPath" "/actuator/health/readiness"
    "livenessPath" "/actuator/health/liveness")
  "nodejs" (dict
    "executor" "script"
    "task" "nodejs"
    "taskNamespace" "tekton-tasks"
    "script" "npm ci\nnpm test"
    "dockerfilePath" "./Dockerfile"
    "runtimePort" 8080
    "healthPort" 8080
    "readinessPath" "/health/ready"
    "livenessPath" "/health/live")
-}}
{{- $profile := required "build.profile is required" .Values.build.profile -}}
{{- $recipe := get $recipes $profile -}}
{{- if not $recipe -}}{{ fail (printf "unsupported build.profile %q" $profile) }}{{- end -}}
{{- toYaml $recipe -}}
{{- end -}}
