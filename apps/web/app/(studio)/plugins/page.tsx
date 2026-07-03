'use client';

import { Blocks, PackagePlus } from 'lucide-react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { usePlugins, useTogglePlugin } from '../../../lib/api/hooks';

const ICON_BG = ['#8B5E2F', '#A67040', '#5C7A8B', '#7A4F22', '#524740', '#A8442B'];

export default function PluginsPage() {
  const flash = useToast();
  const plugins = usePlugins();
  const toggle = useTogglePlugin();

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <div className="font-display text-[15px] font-bold">Installed plugins</div>
          <div className="mt-0.5 text-[12.5px] text-taupe">
            Workers self-register their loaded manifests — each exposes initialize · health · generate · shutdown
          </div>
        </div>
        <button
          onClick={() => flash('Drop a plugin folder into plugins/ — the conformance suite gates registration')}
          className="flex h-[38px] items-center gap-[7px] rounded-full border border-line bg-card px-[18px] text-[12.5px] font-bold text-primary"
        >
          <PackagePlus className="size-4" strokeWidth={1.6} /> Install from registry
        </button>
      </div>

      {plugins.isPending ? (
        <LoadingState label="Loading plugin registry…" />
      ) : plugins.data?.length === 0 ? (
        <EmptyState
          title="No plugins registered yet"
          hint="Start a pipeline worker — it loads plugins/ and registers every valid manifest here."
        />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {plugins.data?.map((plugin, index) => (
            <div key={plugin.id} className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-[42px] flex-none items-center justify-center rounded-[11px] text-white"
                  style={{ background: ICON_BG[index % ICON_BG.length] }}
                >
                  <Blocks className="size-[18px]" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold">{plugin.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone">
                    {(plugin.manifest.capabilities ?? []).join(' · ') || 'plugin'}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={plugin.enabled}
                  aria-label={`Toggle ${plugin.name}`}
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate(
                      { pluginId: plugin.id, enabled: !plugin.enabled },
                      { onError: () => flash('Toggle failed') },
                    )
                  }
                  className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
                    plugin.enabled ? 'bg-primary' : 'bg-sand'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[left] ${
                      plugin.enabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 mb-3.5 text-xs leading-normal text-taupe">{plugin.description}</div>
              <div className="flex items-center justify-between border-t border-hairline pt-[11px] text-[11px] text-stone">
                <span className="flex items-center gap-[5px]">
                  <span className={`size-[7px] rounded-full ${plugin.enabled ? 'bg-success' : 'bg-stone'}`} />
                  {plugin.enabled ? 'enabled' : 'disabled'}
                </span>
                <span>v{plugin.version}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
