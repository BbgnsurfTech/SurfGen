{{- define "surfgen.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "surfgen.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "surfgen.labels" -}}
app.kubernetes.io/name: {{ include "surfgen.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "surfgen.image" -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .component (.root.Values.image.tag | default .root.Chart.AppVersion) -}}
{{- end -}}

{{- define "surfgen.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ include "surfgen.fullname" . }}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{/* Shared env: plain values from .Values.env + everything in existingSecret. */}}
{{- define "surfgen.sharedEnv" -}}
{{- range $key, $value := .Values.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}
