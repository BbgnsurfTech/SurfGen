'use client';

import { Braces, Copy, Plus, Radio, Share2, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import {
  useApiKeys,
  useCreateApiKey,
  useCreateWebhook,
  useRevokeApiKey,
  useWebhooks,
} from '../../../lib/api/hooks';
import { API_URL, ApiError } from '../../../lib/api/client';

const SURFACES = [
  { icon: Braces, label: 'REST API', desc: 'Resource CRUD over HTTPS — envelope + cursor pagination', tag: 'OpenAPI at /docs', bg: '#8B5E2F' },
  { icon: Radio, label: 'WebSocket', desc: 'Live job progress via org-scoped rooms', tag: 'in-band auth', bg: '#5C7A8B' },
  { icon: Share2, label: 'Webhooks', desc: 'HMAC-signed deliveries with replay protection', tag: 'X-SurfGen-Signature', bg: '#A67040' },
  { icon: Zap, label: 'CLIs', desc: 'surfgen (Node) and surfgen-py share ~/.surfgen config', tag: 'apps/cli · apps/cli-py', bg: '#7A4F22' },
];

function relativeTime(iso: string | null): string {
  if (!iso) return 'never used';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export default function DeveloperPage() {
  const flash = useToast();
  const keys = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const webhooks = useWebhooks();
  const createWebhook = useCreateWebhook();

  const [keyName, setKeyName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');

  const snippet = `curl -X POST ${API_URL}/v1/orgs/{orgId}/projects/{projectId}/videos \\
  -H "Authorization: Bearer <api key>" \\
  -H "Content-Type: application/json" \\
  -d '{ "title": "hello", "script": "Welcome to SurfGen.", "language": "en" }'
# then: POST .../videos/{id}/generate`;

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[26px] grid grid-cols-4 gap-4">
        {SURFACES.map((surface) => (
          <div key={surface.label} className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 flex-none items-center justify-center rounded-[11px] text-white" style={{ background: surface.bg }}>
                <surface.icon className="size-[18px]" strokeWidth={1.6} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold">{surface.label}</div>
                <span className="font-mono text-[10px] text-primary">{surface.tag}</span>
              </div>
            </div>
            <div className="mt-3 text-xs leading-normal text-taupe">{surface.desc}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-5">
        {/* quickstart */}
        <div className="overflow-hidden rounded-[18px] border border-line-dark bg-ink">
          <div className="flex h-12 items-center gap-2.5 border-b border-carbon px-4">
            <span className="font-mono text-[11px] text-taupe">POST /v1/videos → generate</span>
            <div className="flex-1" />
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(snippet);
                flash('Snippet copied');
              }}
              className="flex h-[30px] items-center gap-1.5 rounded-lg border border-line-dark bg-espresso px-3 text-xs font-semibold text-sand"
            >
              <Copy className="size-[13px]" strokeWidth={1.6} /> Copy
            </button>
          </div>
          <pre className="m-0 overflow-x-auto p-[22px] font-mono text-[12.5px] leading-[1.65] whitespace-pre text-shell">{snippet}</pre>
          <div className="border-t border-carbon px-[22px] py-3 text-[11px] text-taupe">
            Full interactive reference: <span className="font-mono text-camel">{API_URL}/docs</span> · concepts in
            docs/api/README.md
          </div>
        </div>

        {/* api keys */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="font-display text-sm font-bold">API keys</div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!keyName.trim()) return;
              createKey.mutate(
                { name: keyName.trim() },
                {
                  onSuccess: ({ data }) => {
                    setFreshKey(data.key);
                    setKeyName('');
                  },
                  onError: (error) =>
                    flash(error instanceof ApiError ? `${error.code}: ${error.message}` : 'Key creation failed'),
                },
              );
            }}
            className="mb-3 flex gap-2"
          >
            <input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="Key name (e.g. CI)"
              className="h-9 min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 text-xs outline-none placeholder:text-stone"
            />
            <button
              type="submit"
              disabled={createKey.isPending}
              className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-[13px] text-xs font-bold text-white disabled:opacity-60"
            >
              <Plus className="size-3.5" strokeWidth={2} /> New key
            </button>
          </form>
          {freshKey && (
            <div className="mb-3 rounded-xl border border-success/40 bg-success/8 p-3">
              <div className="mb-1 text-[11px] font-bold text-success">Copy now — shown once, stored hashed:</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{freshKey}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(freshKey);
                    setFreshKey(null);
                    flash('Key copied');
                  }}
                  className="flex size-7 flex-none items-center justify-center rounded-lg border border-line bg-card text-primary"
                  aria-label="Copy key"
                >
                  <Copy className="size-3.5" strokeWidth={1.6} />
                </button>
              </div>
            </div>
          )}
          {keys.isPending ? (
            <LoadingState label="Loading keys…" />
          ) : keys.data?.length === 0 ? (
            <EmptyState title="No API keys" hint="Create one above — it authorizes CLI and integration access." />
          ) : (
            keys.data?.map((key) => (
              <div key={key.id} className="flex items-center gap-[11px] border-b border-hairline py-[11px]">
                <span className="size-2 flex-none rounded-full bg-success" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{key.name}</span>
                    <span className="rounded-full border border-line bg-cream px-[9px] py-[3px] text-[10.5px] font-bold text-taupe">
                      {key.scopes.join(' · ') || 'full'}
                    </span>
                  </div>
                  <div className="mt-[3px] truncate font-mono text-[11px] text-stone">{key.keyPrefix}…</div>
                </div>
                <div className="flex-none text-right">
                  <button
                    onClick={() =>
                      revokeKey.mutate({ keyId: key.id }, { onSuccess: () => flash(`${key.name} revoked`) })
                    }
                    aria-label={`Revoke ${key.name}`}
                    className="flex size-[30px] items-center justify-center rounded-lg border border-line bg-paper text-danger"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.6} />
                  </button>
                  <div className="mt-[3px] text-[10px] text-stone">{relativeTime(key.lastUsedAt)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* webhooks */}
      <div className="mt-5 rounded-2xl border border-line bg-card px-5 py-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-sm font-bold">Webhook endpoints</div>
          <span className="text-[11px] text-stone">HMAC secret via env:/vault:/file: reference</span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!hookUrl.trim()) return;
            createWebhook.mutate(
              { url: hookUrl.trim(), events: ['video.*'], secretRef: 'env:SURFGEN_WEBHOOK_SECRET' },
              {
                onSuccess: () => {
                  setHookUrl('');
                  flash('Webhook endpoint added (events: video.*)');
                },
                onError: (error) =>
                  flash(error instanceof ApiError ? `${error.code}: ${error.message}` : 'Webhook creation failed'),
              },
            );
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={hookUrl}
            onChange={(event) => setHookUrl(event.target.value)}
            placeholder="https://your-app.dev/hooks/surfgen"
            className="h-9 min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 text-xs outline-none placeholder:text-stone"
          />
          <button
            type="submit"
            disabled={createWebhook.isPending}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-[11.5px] font-semibold text-primary disabled:opacity-60"
          >
            <Plus className="size-[13px]" strokeWidth={2} /> Add endpoint
          </button>
        </form>
        {webhooks.isPending ? (
          <LoadingState label="Loading webhooks…" />
        ) : webhooks.data?.length === 0 ? (
          <EmptyState
            title="No webhooks yet"
            hint="Deliveries are signed (X-SurfGen-Signature, 5-minute replay window) — see docs/api."
          />
        ) : (
          webhooks.data?.map((hook) => (
            <div key={hook.id} className="flex items-center gap-[11px] border-b border-hairline py-2.5">
              <span className={`size-2 flex-none rounded-full ${hook.enabled ? 'bg-success' : 'bg-stone'}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{hook.url}</span>
              <span className="font-mono text-[11px] font-semibold text-primary">{hook.events.join(', ')}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
