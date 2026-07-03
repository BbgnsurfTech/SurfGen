'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { API_URL, getAccessToken } from './client';
import { useAuthed } from './hooks';

export interface LiveEvent {
  name: string;
  payload: Record<string, unknown> & {
    videoId?: string;
    runId?: string;
    stage?: string;
    overallPercent?: number;
    error?: string;
  };
  occurredAt?: string;
}

type Listener = (event: LiveEvent) => void;

const LiveContext = createContext<(listener: Listener) => () => void>(() => () => {});

const RECONNECT_DELAY_MS = 5_000;

/** Query keys refreshed whenever pipeline/video events arrive. */
const INVALIDATE_ON_EVENT = ['workspace', 'video', 'monitor', 'stats'];

/**
 * One WebSocket for the whole studio (gateway at /ws, org-scoped rooms).
 * Auth is in-band; consumers subscribe via useLiveEvent(listener).
 */
export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const authed = useAuthed();
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    if (!authed) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const wsUrl = API_URL.replace(/^http/, 'ws');
      socket = new WebSocket(`${wsUrl}/ws`);
      socket.onopen = () => {
        // Nest WsAdapter message shape: { event, data }.
        socket?.send(JSON.stringify({ event: 'auth', data: { token: getAccessToken() ?? '' } }));
      };
      socket.onmessage = (message) => {
        let parsed: { type?: string; name?: string; payload?: LiveEvent['payload']; occurredAt?: string };
        try {
          parsed = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (parsed.type !== 'event' || !parsed.name) return;
        for (const key of INVALIDATE_ON_EVENT) void queryClient.invalidateQueries({ queryKey: [key] });
        const event: LiveEvent = { name: parsed.name, payload: parsed.payload ?? {}, occurredAt: parsed.occurredAt };
        for (const listener of listeners.current) listener(event);
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [authed, queryClient]);

  return <LiveContext.Provider value={subscribe}>{children}</LiveContext.Provider>;
}

/** Subscribe to live pipeline/video events for the lifetime of the component. */
export function useLiveEvent(listener: Listener): void {
  const subscribe = useContext(LiveContext);
  const stable = useRef(listener);
  stable.current = listener;
  useEffect(() => subscribe((event) => stable.current(event)), [subscribe]);
}
