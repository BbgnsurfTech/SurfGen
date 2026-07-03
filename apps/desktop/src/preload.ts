/**
 * Preload bridge — the ONLY surface the studio gets from the desktop shell.
 * Keep this API minimal and read-only; it runs with contextIsolation.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { DetectedRuntime } from './discovery.js';

export interface SurfGenDesktopApi {
  readonly platform: NodeJS.Platform;
  localRuntimes(): Promise<DetectedRuntime[]>;
}

const api: SurfGenDesktopApi = {
  platform: process.platform,
  localRuntimes: () => ipcRenderer.invoke('surfgen:local-runtimes') as Promise<DetectedRuntime[]>,
};

contextBridge.exposeInMainWorld('surfgenDesktop', api);
