'use client';

import { PlugZap, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui/toast';
import { useGatewaySettings, useTestGateway, useUpdateGateway } from '../../../lib/api/hooks';

const CURRENCIES = ['NGN', 'USD', 'GHS', 'ZAR', 'KES'] as const;

/** Paystack gateway configuration — secret key is write-only (masked read). */
export function GatewayCard() {
  const flash = useToast();
  const settings = useGatewaySettings();
  const update = useUpdateGateway();
  const testKey = useTestGateway();

  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [currency, setCurrency] = useState<string>('NGN');

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setPublicKey(settings.data.publicKey ?? '');
    setCurrency(settings.data.currency);
  }, [settings.data]);

  const handleSave = () => {
    update.mutate(
      { enabled, publicKey: publicKey || null, currency, ...(secretKey && { secretKey }) },
      {
        onSuccess: () => {
          setSecretKey('');
          flash('Gateway settings saved');
        },
        onError: (error) => flash(error.message),
      },
    );
  };

  const handleTest = () =>
    testKey.mutate(undefined, {
      onSuccess: () => flash('Paystack key is valid — connection OK'),
      onError: (error) => flash(`Connection failed: ${error.message}`),
    });

  const inputClass =
    'h-[38px] w-full rounded-[11px] border border-line bg-shell px-3 text-[12.5px] text-primary outline-none focus:border-camel';

  return (
    <div className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
      <div className="flex items-start gap-3">
        <div className="flex size-[42px] flex-none items-center justify-center rounded-[11px] bg-[#0BA4DB] text-white">
          <PlugZap className="size-[18px]" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold">Paystack gateway</div>
          <div className="mt-0.5 text-[10.5px] text-stone">
            Keys are encrypted at rest — the secret is never shown again
          </div>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle payments"
          onClick={() => setEnabled((value) => !value)}
          className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-sand'
          }`}
        >
          <span
            className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[left] ${
              enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-taupe">Public key</span>
          <input
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            placeholder="pk_live_…"
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-taupe">
            Secret key {settings.data?.secretKeyMasked && `(stored: ${settings.data.secretKeyMasked})`}
          </span>
          <input
            type="password"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            placeholder={settings.data?.secretKeyMasked ? 'Enter a new key to replace' : 'sk_live_…'}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-taupe">Currency</span>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3.5">
        <button
          onClick={handleSave}
          disabled={update.isPending}
          className="flex h-[34px] items-center gap-[6px] rounded-full bg-primary px-4 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {update.isPending ? 'Saving…' : 'Save settings'}
        </button>
        <button
          onClick={handleTest}
          disabled={testKey.isPending}
          className="flex h-[34px] items-center gap-[6px] rounded-full border border-line bg-card px-4 text-[12px] font-bold text-primary disabled:opacity-60"
        >
          <ShieldCheck className="size-[15px]" strokeWidth={1.6} />
          {testKey.isPending ? 'Testing…' : 'Test connection'}
        </button>
      </div>
    </div>
  );
}
