{{/*
Expand the name of the chart.
*/}}
{{- define "enclave.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "enclave.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "enclave.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "enclave.labels" -}}
helm.sh/chart: {{ include "enclave.chart" . }}
{{ include "enclave.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (stable across upgrades — never include version here).
*/}}
{{- define "enclave.selectorLabels" -}}
app.kubernetes.io/name: {{ include "enclave.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "enclave.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "enclave.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Component fullnames */}}
{{- define "enclave.backend.fullname" -}}{{ include "enclave.fullname" . }}-backend{{- end }}
{{- define "enclave.frontend.fullname" -}}{{ include "enclave.fullname" . }}-frontend{{- end }}
{{- define "enclave.postgresql.fullname" -}}{{ include "enclave.fullname" . }}-postgresql{{- end }}
{{- define "enclave.redis.fullname" -}}{{ include "enclave.fullname" . }}-redis{{- end }}

{{/* Secret name (existing or generated) */}}
{{- define "enclave.secretName" -}}
{{- if .Values.auth.existingSecret }}{{ .Values.auth.existingSecret }}{{- else }}{{ include "enclave.fullname" . }}{{- end }}
{{- end }}

{{/* Resolved image tag default: <component.tag> -> <image.tag> -> appVersion */}}
{{- define "enclave.imageTag" -}}
{{- $top := index . 0 -}}{{- $tag := index . 1 -}}
{{- $tag | default $top.Values.image.tag | default $top.Chart.AppVersion -}}
{{- end }}

{{/* Backend image ref */}}
{{- define "enclave.backend.image" -}}
{{- $repo := .Values.backend.image.repository | default (printf "%s/%s/backend" .Values.image.registry .Values.image.repository) -}}
{{- $tag := include "enclave.imageTag" (list . .Values.backend.image.tag) -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}

{{/* Frontend image ref */}}
{{- define "enclave.frontend.image" -}}
{{- $repo := .Values.frontend.image.repository | default (printf "%s/%s/frontend" .Values.image.registry .Values.image.repository) -}}
{{- $tag := include "enclave.imageTag" (list . .Values.frontend.image.tag) -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}

{{/* Migrations image ref */}}
{{- define "enclave.migrations.image" -}}
{{- $repo := .Values.migrations.image.repository | default (printf "%s/%s/migrations" .Values.image.registry .Values.image.repository) -}}
{{- $tag := include "enclave.imageTag" (list . .Values.migrations.image.tag) -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}

{{/* Effective Postgres host: the in-cluster service when deploy=true, else the external host */}}
{{- define "enclave.postgresql.host" -}}
{{- if .Values.postgresql.deploy }}{{ include "enclave.postgresql.fullname" . }}{{- else }}{{ required "postgresql.host is required when postgresql.deploy=false" .Values.postgresql.host }}{{- end }}
{{- end }}

{{/* Effective Redis URL: the in-cluster service when deploy=true, else redis.url (may be empty for single-replica) */}}
{{- define "enclave.redis.url" -}}
{{- if .Values.redis.deploy }}{{ printf "redis://%s:6379" (include "enclave.redis.fullname" .) }}{{- else }}{{ .Values.redis.url }}{{- end }}
{{- end }}
