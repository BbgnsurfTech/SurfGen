'use client';

import {
  AudioLines,
  CreditCard,
  Database,
  Languages,
  PackagePlus,
  ScanFace,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../../components/ui/toast';

interface PluginCard {
  name: string;
  slug: string;
  icon: LucideIcon;
  iconBg: string;
  desc: string;
  version: string;
  health: 'healthy' | 'degraded';
}

const PLUGINS: PluginCard[] = [
  { name: 'ElevenLabs Voice', slug: 'plugins/voices/elevenlabs', icon: AudioLines, iconBg: '#8B5E2F', desc: 'Cloud voice cloning & streaming TTS with emotion control. Implements VoiceProvider.', version: 'v2.4.1', health: 'healthy' },
  { name: 'MuseTalk Lip-sync', slug: 'plugins/lipsync/musetalk', icon: ScanFace, iconBg: '#A67040', desc: 'GPU lip-sync worker. Registers itself on GPU-2 via Triton.', version: 'v1.8.0', health: 'healthy' },
  { name: 'ComfyUI Bridge', slug: 'plugins/image/comfyui', icon: Workflow, iconBg: '#5C7A8B', desc: 'Runs image graphs against a local ComfyUI instance. ImageProvider.', version: 'v0.9.3', health: 'healthy' },
  { name: 'DeepL Translate', slug: 'plugins/translation/deepl', icon: Languages, iconBg: '#7A4F22', desc: '40-language translation with glossary support. TranslationProvider.', version: 'v3.1.0', health: 'healthy' },
  { name: 'Stripe Billing', slug: 'plugins/billing/stripe', icon: CreditCard, iconBg: '#8B5E2F', desc: 'Usage-metered billing, quotas & invoicing.', version: 'v4.0.2', health: 'degraded' },
  { name: 'S3 Storage', slug: 'plugins/storage/s3', icon: Database, iconBg: '#524740', desc: 'S3-compatible object storage with signed URLs & lifecycle rules.', version: 'v2.0.0', health: 'healthy' },
];

export default function PluginsPage() {
  const flash = useToast();
  const [disabled, setDisabled] = useState<Record<string, boolean>>({});

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <div className="font-display text-[15px] font-bold">Installed plugins</div>
          <div className="mt-0.5 text-[12.5px] text-taupe">
            Each exposes initialize · health · generate · shutdown · capabilities
          </div>
        </div>
        <button
          onClick={() => flash('Registry browser — manifest + conformance suite required')}
          className="flex h-[38px] items-center gap-[7px] rounded-full border border-line bg-card px-[18px] text-[12.5px] font-bold text-primary"
        >
          <PackagePlus className="size-4" strokeWidth={1.6} /> Install from registry
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {PLUGINS.map((plugin) => {
          const off = !!disabled[plugin.slug];
          const healthColor = off ? '#A89684' : plugin.health === 'healthy' ? '#4F7C3A' : '#C48A1F';
          return (
            <div key={plugin.slug} className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-[42px] flex-none items-center justify-center rounded-[11px] text-white"
                  style={{ background: plugin.iconBg }}
                >
                  <plugin.icon className="size-[18px]" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold">{plugin.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone">{plugin.slug}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={!off}
                  aria-label={`Toggle ${plugin.name}`}
                  onClick={() => setDisabled((current) => ({ ...current, [plugin.slug]: !current[plugin.slug] }))}
                  className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
                    off ? 'bg-sand' : 'bg-primary'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[left] ${
                      off ? 'left-0.5' : 'left-[18px]'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 mb-3.5 text-xs leading-normal text-taupe">{plugin.desc}</div>
              <div className="flex items-center justify-between border-t border-hairline pt-[11px] text-[11px] text-stone">
                <span className="flex items-center gap-[5px]">
                  <span className="size-[7px] rounded-full" style={{ background: healthColor }} />
                  {off ? 'disabled' : plugin.health}
                </span>
                <span>{plugin.version}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
