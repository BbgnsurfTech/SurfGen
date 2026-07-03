'use client';

import { AudioLines, Mic, Play, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../../components/ui/toast';
import { THUMBS } from '../../../lib/demo/projects';

const AVATARS = [
  { name: 'Amara — Studio', type: 'Photo', color: '#8B5E2F', meta: 'MuseTalk · v3' },
  { name: 'Idris — Corporate', type: 'Video', color: '#A67040', meta: 'Wav2Lip · v2' },
  { name: 'Zainab — News', type: '3D', color: '#5C7A8B', meta: 'SadTalker' },
  { name: 'Musa — Casual', type: 'Realtime', color: '#4F7C3A', meta: 'Realtime · beta' },
  { name: 'Team Brand', type: 'Enterprise', color: '#7A4F22', meta: 'Brand kit' },
  { name: 'Fatima — Field', type: 'Photo', color: '#8B5E2F', meta: 'Photo avatar' },
  { name: 'CEO Avatar', type: 'Custom', color: '#A8442B', meta: 'EchoMimic' },
  { name: 'Ngozi — Host', type: 'Video', color: '#A67040', meta: 'Video avatar' },
];

const VOICES = [
  { name: 'Amara Clone', lang: 'en-NG · warm · cloned', provider: 'XTTS', color: '#8B5E2F' },
  { name: 'Idris Pro', lang: 'en-GB · authoritative', provider: 'ElevenLabs', color: '#A67040' },
  { name: 'Hausa Narrator', lang: 'ha-NG · neutral', provider: 'Piper', color: '#5C7A8B' },
  { name: 'Zoe', lang: 'en-US · bright', provider: 'OpenAI', color: '#4F7C3A' },
  { name: 'Yoruba Host', lang: 'yo-NG · lively', provider: 'Coqui', color: '#7A4F22' },
];

/** Deterministic pseudo-waveform (same formula as the design prototype). */
const waveHeights = (seed: number): number[] =>
  Array.from({ length: 26 }, (_, i) => 8 + Math.abs(Math.sin(i * 0.9 + seed) * 18) + ((i * 7 + seed * 13) % 9));

export default function StudioPage() {
  const flash = useToast();
  const [tab, setTab] = useState<'avatars' | 'voices'>('avatars');

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-6 flex w-fit gap-1 rounded-full border border-line bg-cream p-1">
        {(
          [
            ['avatars', 'Avatars', UsersRound],
            ['voices', 'Voices', AudioLines],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex h-[34px] items-center gap-[7px] rounded-full px-[18px] text-[13px] font-bold ${
              tab === id ? 'bg-card text-primary shadow-[0_2px_6px_rgba(26,26,26,.08)]' : 'text-taupe'
            }`}
          >
            <Icon className="size-[15px]" strokeWidth={1.6} /> {label}
          </button>
        ))}
      </div>

      {tab === 'avatars' ? (
        <div className="grid grid-cols-5 gap-[18px]">
          <button
            onClick={() => flash('Avatar creation — upload a photo or record a take')}
            className="flex min-h-[230px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-sand bg-card text-primary"
          >
            <div className="flex size-[52px] items-center justify-center rounded-full bg-cream">
              <UserPlus className="size-6" strokeWidth={1.6} />
            </div>
            <div className="font-display text-sm font-bold">Create avatar</div>
            <div className="max-w-[150px] text-center text-[11.5px] text-stone">
              Upload a photo or record a video take
            </div>
          </button>
          {AVATARS.map((avatar, i) => (
            <div
              key={avatar.name}
              className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(26,26,26,.04)]"
            >
              <div className="relative h-[150px]" style={{ background: THUMBS[i % THUMBS.length] }}>
                <span
                  className="absolute top-[9px] left-[9px] rounded-full px-[9px] py-[3px] text-[10px] font-bold text-white"
                  style={{ background: avatar.color }}
                >
                  {avatar.type}
                </span>
              </div>
              <div className="px-3.5 py-3">
                <div className="font-display text-[13.5px] font-bold">{avatar.name}</div>
                <div className="mt-[3px] text-[11px] text-taupe">{avatar.meta}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex max-w-[860px] flex-col gap-3">
          <div className="flex items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-sand bg-card p-[18px]">
            <div className="flex size-[46px] flex-none items-center justify-center rounded-full bg-cream text-primary">
              <Mic className="size-[22px]" strokeWidth={1.6} />
            </div>
            <div className="flex-1">
              <div className="font-display text-sm font-bold">Clone a voice</div>
              <div className="text-xs text-taupe">
                30 seconds of clean audio. Powered by XTTS / ElevenLabs — swap via config.
              </div>
            </div>
            <button
              onClick={() => flash('Voice cloning requires a signed consent token')}
              className="h-9 rounded-full bg-primary px-[18px] text-[12.5px] font-bold text-white"
            >
              Start
            </button>
          </div>
          {VOICES.map((voice, i) => (
            <div key={voice.name} className="flex items-center gap-4 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
              <button
                onClick={() => flash(`Previewing ${voice.name}`)}
                aria-label={`Preview ${voice.name}`}
                className="flex size-[38px] flex-none items-center justify-center rounded-full border border-line bg-cream text-primary"
              >
                <Play className="size-[15px]" strokeWidth={1.6} />
              </button>
              <div className="w-[150px] flex-none">
                <div className="font-display text-[13.5px] font-bold">{voice.name}</div>
                <div className="text-[11px] text-taupe">{voice.lang}</div>
              </div>
              <div className="flex h-[30px] flex-1 items-center gap-0.5">
                {waveHeights(i + 1).map((h, j) => (
                  <span
                    key={j}
                    className="min-w-0.5 flex-1 rounded-full bg-sand"
                    style={{ height: `${h.toFixed(0)}px` }}
                  />
                ))}
              </div>
              <span
                className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold text-white"
                style={{ background: voice.color }}
              >
                {voice.provider}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
