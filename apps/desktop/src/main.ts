/**
 * SurfGen desktop shell.
 *
 * Wraps the web studio in a hardened BrowserWindow and answers one IPC call:
 * which local AI runtimes (Ollama, LM Studio, …) this machine is running, so
 * the studio can surface "local mode available" without the API's discovery.
 *
 * Security posture: no nodeIntegration, contextIsolation on, sandbox on,
 * navigation locked to the studio origin, window.open → system browser.
 */

import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { detectLocalRuntimes } from './discovery.js';

const WEB_URL = process.env.SURFGEN_WEB_URL ?? 'http://localhost:3000';
const ALLOWED_ORIGIN = new URL(WEB_URL).origin;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10101c',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadURL(WEB_URL);
}

app.whenReady().then(() => {
  ipcMain.handle('surfgen:local-runtimes', () => detectLocalRuntimes());

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  // In-app navigation stays on the studio origin; everything else is denied.
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== ALLOWED_ORIGIN) event.preventDefault();
  });
  // window.open / target=_blank goes to the system browser, never a new shell window.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
