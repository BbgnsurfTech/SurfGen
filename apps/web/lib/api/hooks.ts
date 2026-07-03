'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_URL, api, loadTokens } from './client';
import type {
  ApiKey,
  Avatar,
  BrandKit,
  Monitor,
  Org,
  Plugin,
  Project,
  Provider,
  Stats,
  Video,
  VideoDetail,
  Voice,
  Webhook,
  Workflow,
} from './types';

/** Reactive "is a token present" — updates on login/logout in this or other tabs. */
export function useAuthed(): boolean {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    const sync = () => setAuthed(loadTokens() !== null);
    sync();
    window.addEventListener('surfgen:auth', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('surfgen:auth', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return authed === true;
}

/** Unauthenticated liveness probe — drives the topbar status pill. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/healthz`);
      if (!response.ok) throw new Error(`healthz ${response.status}`);
      return true;
    },
    refetchInterval: 30_000,
    retry: false,
  });
}

/** First org the principal belongs to — the working scope for every view. */
export function useOrg() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['org'],
    enabled: authed,
    queryFn: async () => (await api<Org[]>('GET', '/v1/orgs')).data[0] ?? null,
  });
}

function useOrgResource<T>(key: string, path: (orgId: string) => string, refetchInterval?: number) {
  const org = useOrg();
  const orgId = org.data?.id;
  return useQuery({
    queryKey: [key, orgId],
    enabled: !!orgId,
    ...(refetchInterval !== undefined && { refetchInterval }),
    queryFn: async (): Promise<T> => (await api<T>('GET', path(orgId!))).data,
  });
}

export const useStats = () => useOrgResource<Stats>('stats', (org) => `/v1/orgs/${org}/stats`, 30_000);
export const useAvatars = () => useOrgResource<Avatar[]>('avatars', (org) => `/v1/orgs/${org}/avatars`);
export const useVoices = () => useOrgResource<Voice[]>('voices', (org) => `/v1/orgs/${org}/voices`);
export const useBrandKits = () => useOrgResource<BrandKit[]>('brand-kits', (org) => `/v1/orgs/${org}/brand-kits`);
export const useWorkflows = () => useOrgResource<Workflow[]>('workflows', (org) => `/v1/orgs/${org}/workflows`);
export const useApiKeys = () => useOrgResource<ApiKey[]>('api-keys', (org) => `/v1/orgs/${org}/api-keys`);
export const useWebhooks = () => useOrgResource<Webhook[]>('webhooks', (org) => `/v1/orgs/${org}/webhooks`);

export function useProviders() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['providers'],
    enabled: authed,
    queryFn: async () => (await api<Provider[]>('GET', '/v1/providers')).data,
  });
}

export function usePlugins() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['plugins'],
    enabled: authed,
    queryFn: async () => (await api<Plugin[]>('GET', '/v1/plugins')).data,
  });
}

export function useMonitor() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['monitor'],
    enabled: authed,
    refetchInterval: 10_000,
    queryFn: async () => (await api<Monitor>('GET', '/v1/monitor')).data,
  });
}

/** First project + its videos — dashboard grid and editor entry point. */
export function useWorkspace() {
  const org = useOrg();
  const orgId = org.data?.id;
  return useQuery({
    queryKey: ['workspace', orgId],
    enabled: !!orgId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const projects = (await api<Project[]>('GET', `/v1/orgs/${orgId}/projects`)).data;
      const project = projects[0] ?? null;
      const videos = project
        ? (await api<Video[]>('GET', `/v1/orgs/${orgId}/projects/${project.id}/videos?limit=12`)).data
        : [];
      return { orgId: orgId!, project, videos };
    },
  });
}

export function useVideoDetail(videoId: string | null) {
  const workspace = useWorkspace();
  const scope = workspace.data;
  return useQuery({
    queryKey: ['video', videoId],
    enabled: !!scope?.project && !!videoId,
    queryFn: async (): Promise<VideoDetail> =>
      (await api<VideoDetail>('GET', `/v1/orgs/${scope!.orgId}/projects/${scope!.project!.id}/videos/${videoId}`))
        .data,
  });
}

/** Mutation helper: run against the current org, invalidate the listed keys. */
function useOrgMutation<TArgs, TResult = unknown>(
  invalidate: string[],
  run: (orgId: string, args: TArgs) => Promise<TResult>,
) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const orgId = org.data?.id;
      if (!orgId) throw new Error('no organization');
      return run(orgId, args);
    },
    onSuccess: () => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useCreateAvatar = () =>
  useOrgMutation<{ name: string; kind: Avatar['kind'] }>(['avatars'], async (orgId, body) =>
    api('POST', `/v1/orgs/${orgId}/avatars`, body),
  );

export const useCreateBrandKit = () =>
  useOrgMutation<Omit<BrandKit, 'id'>>(['brand-kits'], async (orgId, body) =>
    api('POST', `/v1/orgs/${orgId}/brand-kits`, body),
  );

export const useUpdateBrandKit = () =>
  useOrgMutation<{ id: string } & Partial<Omit<BrandKit, 'id'>>>(['brand-kits'], async (orgId, { id, ...body }) =>
    api('PATCH', `/v1/orgs/${orgId}/brand-kits/${id}`, body),
  );

export const useExtractBrand = () =>
  useOrgMutation<{ url: string }, { data: Pick<BrandKit, 'name' | 'sourceUrl' | 'colors'> }>(
    [],
    async (orgId, body) =>
      api<Pick<BrandKit, 'name' | 'sourceUrl' | 'colors'>>('POST', `/v1/orgs/${orgId}/brand-kits/extract`, body),
  );

export const useRunWorkflow = () =>
  useOrgMutation<{ workflowId: string }>(['workflows'], async (orgId, { workflowId }) =>
    api('POST', `/v1/orgs/${orgId}/workflows/${workflowId}/runs`),
  );

export const useTogglePlugin = () =>
  useOrgMutation<{ pluginId: string; enabled: boolean }>(['plugins'], async (_orgId, { pluginId, enabled }) =>
    api('PATCH', `/v1/plugins/${pluginId}`, { enabled }),
  );

export const useCreateApiKey = () =>
  useOrgMutation<{ name: string }, { data: { key: string; name: string } }>(
    ['api-keys'],
    async (orgId, body) => api<{ key: string; name: string }>('POST', `/v1/orgs/${orgId}/api-keys`, body),
  );

export const useRevokeApiKey = () =>
  useOrgMutation<{ keyId: string }>(['api-keys'], async (orgId, { keyId }) =>
    api('DELETE', `/v1/orgs/${orgId}/api-keys/${keyId}`),
  );

export const useCreateWebhook = () =>
  useOrgMutation<{ url: string; events: string[]; secretRef: string }>(['webhooks'], async (orgId, body) =>
    api('POST', `/v1/orgs/${orgId}/webhooks`, body),
  );

/** Mutation scoped to the workspace's project, invalidating video detail. */
function useVideoMutation<TArgs>(run: (base: string, args: TArgs) => Promise<unknown>) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs & { videoId: string }) => {
      const scope = workspace.data;
      if (!scope?.project) throw new Error('no project');
      return run(`/v1/orgs/${scope.orgId}/projects/${scope.project.id}/videos/${args.videoId}`, args);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['video'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

export const useCreateScene = () =>
  useVideoMutation<{ videoId: string; content?: Record<string, unknown> }>((base, args) =>
    api('POST', `${base}/scenes`, { content: args.content ?? {} }),
  );

export const useUpdateScene = () =>
  useVideoMutation<{ videoId: string; sceneId: string; content: Record<string, unknown> }>((base, args) =>
    api('PATCH', `${base}/scenes/${args.sceneId}`, { content: args.content }),
  );

export const useDeleteScene = () =>
  useVideoMutation<{ videoId: string; sceneId: string }>((base, args) =>
    api('DELETE', `${base}/scenes/${args.sceneId}`),
  );

/** Signed playback URLs — only fetched once the video is ready. */
export function useVideoOutput(videoId: string | null, isReady: boolean) {
  const workspace = useWorkspace();
  const scope = workspace.data;
  return useQuery({
    queryKey: ['video-output', videoId],
    enabled: !!scope?.project && !!videoId && isReady,
    staleTime: 10 * 60_000, // signed URLs live 15 min
    queryFn: async () =>
      (
        await api<{ media: string; thumbnail: string | null }>(
          'GET',
          `/v1/orgs/${scope!.orgId}/projects/${scope!.project!.id}/videos/${videoId}/output`,
        )
      ).data,
  });
}

export const useGenerateVideo = () => {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (videoId: string) => {
      const scope = workspace.data;
      if (!scope?.project) throw new Error('no project');
      return api('POST', `/v1/orgs/${scope.orgId}/projects/${scope.project.id}/videos/${videoId}/generate`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
      void queryClient.invalidateQueries({ queryKey: ['video'] });
    },
  });
};
