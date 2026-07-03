'use client';

import { AudioLines, Mic, Play, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadingState, gradientFor } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { useAvatars, useCreateAvatar, useVoices } from '../../../lib/api/hooks';
import type { Avatar } from '../../../lib/api/types';

const KIND_LABEL: Record<Avatar['kind'], { label: string; color: string }> = {
  photo: { label: 'Photo', color: '#8B5E2F' },
  video: { label: 'Video', color: '#A67040' },
  three_d: { label: '3D', color: '#5C7A8B' },
  animated_character: { label: 'Animated', color: '#4F7C3A' },
};

function CreateAvatarCard() {
  const flash = useToast();
  const create = useCreateAvatar();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-[230px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-sand bg-card text-primary"
      >
        <div className="flex size-[52px] items-center justify-center rounded-full bg-cream">
          <UserPlus className="size-6" strokeWidth={1.6} />
        </div>
        <div className="font-display text-sm font-bold">Create avatar</div>
        <div className="max-w-[150px] text-center text-[11.5px] text-stone">
          Registers a photo avatar; upload source media next
        </div>
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        create.mutate(
          { name: name.trim(), kind: 'photo' },
          {
            onSuccess: () => {
              flash(`Avatar "${name.trim()}" created`);
              setName('');
              setOpen(false);
            },
            onError: () => flash('Could not create avatar'),
          },
        );
      }}
      className="flex min-h-[230px] flex-col justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-sand bg-card p-4"
    >
      <div className="font-display text-sm font-bold text-ink">New photo avatar</div>
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Avatar name"
        className="h-10 rounded-[11px] border border-line bg-paper px-3 text-[13px] outline-none placeholder:text-stone"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="h-9 flex-1 rounded-full bg-primary text-xs font-bold text-white disabled:opacity-60"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 flex-1 rounded-full border border-line bg-card text-xs font-semibold text-taupe"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function StudioPage() {
  const flash = useToast();
  const [tab, setTab] = useState<'avatars' | 'voices'>('avatars');
  const avatars = useAvatars();
  const voices = useVoices();

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
        avatars.isPending ? (
          <LoadingState label="Loading avatars…" />
        ) : (
          <div className="grid grid-cols-5 gap-[18px]">
            <CreateAvatarCard />
            {avatars.data?.map((avatar, i) => {
              const kind = KIND_LABEL[avatar.kind];
              return (
                <div
                  key={avatar.id}
                  className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(26,26,26,.04)]"
                >
                  <div className="relative h-[150px]" style={{ background: gradientFor(i) }}>
                    <span
                      className="absolute top-[9px] left-[9px] rounded-full px-[9px] py-[3px] text-[10px] font-bold text-white"
                      style={{ background: kind.color }}
                    >
                      {kind.label}
                    </span>
                  </div>
                  <div className="px-3.5 py-3">
                    <div className="font-display text-[13.5px] font-bold">{avatar.name}</div>
                    <div className="mt-[3px] text-[11px] text-taupe">
                      {avatar.providerId ?? 'default provider chain'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : voices.isPending ? (
        <LoadingState label="Loading voices…" />
      ) : (
        <div className="flex max-w-[860px] flex-col gap-3">
          <div className="flex items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-sand bg-card p-[18px]">
            <div className="flex size-[46px] flex-none items-center justify-center rounded-full bg-cream text-primary">
              <Mic className="size-[22px]" strokeWidth={1.6} />
            </div>
            <div className="flex-1">
              <div className="font-display text-sm font-bold">Clone a voice</div>
              <div className="text-xs text-taupe">
                Requires a signed consent token — runs through the pipeline&apos;s voice-clone stage (XTTS /
                ElevenLabs by config).
              </div>
            </div>
            <button
              onClick={() => flash('Voice cloning needs a consent token — see docs/api')}
              className="h-9 rounded-full bg-primary px-[18px] text-[12.5px] font-bold text-white"
            >
              Start
            </button>
          </div>
          {voices.data?.length === 0 && (
            <EmptyState title="No voices yet" hint="Register a voice via the API, or run the seed script." />
          )}
          {voices.data?.map((voice) => (
            <div key={voice.id} className="flex items-center gap-4 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
              <button
                onClick={() => flash(`Preview uses the ${voice.providerId} provider`)}
                aria-label={`Preview ${voice.name}`}
                className="flex size-[38px] flex-none items-center justify-center rounded-full border border-line bg-cream text-primary"
              >
                <Play className="size-[15px]" strokeWidth={1.6} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[13.5px] font-bold">{voice.name}</div>
                <div className="text-[11px] text-taupe">
                  {voice.language} · {voice.externalId}
                  {voice.isCloned ? ' · cloned' : ''}
                </div>
              </div>
              <span className="flex-none rounded-full bg-primary px-2.5 py-1 text-[10.5px] font-bold text-white">
                {voice.providerId}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
