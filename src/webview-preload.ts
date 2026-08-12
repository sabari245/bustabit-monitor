import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';

contextBridge.exposeInMainWorld('ipc', {
  postMessage: (message: string) => {
    ipcRenderer.sendToHost('btrack-game', message);
  },
  log: (level: string, message: string, details?: unknown) => {
    ipcRenderer.sendToHost(
      'btrack-log',
      JSON.stringify({ level, message, details }),
    );
  },
});

void webFrame
  .executeJavaScript(HASH_POLL_SCRIPT)
  .then(() =>
    ipcRenderer.sendToHost(
      'btrack-log',
      JSON.stringify({ level: 'info', message: 'Preload monitor injection completed' }),
    ),
  )
  .catch((error) =>
    ipcRenderer.sendToHost(
      'btrack-log',
      JSON.stringify({
        level: 'error',
        message: 'Preload monitor injection failed',
        details: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
