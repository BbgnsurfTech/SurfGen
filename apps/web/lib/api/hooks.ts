'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_URL, api, loadTokens } from './client';

export type VideoStatus =
  | 'draft'
  | 'queued'
  | 'generating'
  | 'rendering'
  | 'post_processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface ApiVideo {
  id: string;
  title: string;
  status: VideoStatus;
  language: string;
  updatedAt: string;
  output: { durationMs?: number } | null;
}

interface Org {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

/** Reactive "is a token present" — updates on login/logout in this or other tabs. */
export function useAuthed(): boolean {
  const [authed, setAuthed] = useState(false);
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
  return authed;
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

/**
 * Videos of the principal's first org/project — the dashboard's live data.
 * Disabled (and the dashboard falls back to demo data) until logged in.
 */
export function useWorkspaceVideos() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['workspace-videos'],
    enabled: authed,
    refetchInterval: 15_000,
    queryFn: async (): Promise<ApiVideo[]> => {
      const orgs = (await api<Org[]>('GET', '/v1/orgs')).data;
      const org = orgs[0];
      if (!org) return [];
      const projects = (await api<Project[]>('GET', `/v1/orgs/${org.id}/projects`)).data;
      const project = projects[0];
      if (!project) return [];
      return (await api<ApiVideo[]>('GET', `/v1/orgs/${org.id}/projects/${project.id}/videos?limit=8`)).data;
    },
  });
}
