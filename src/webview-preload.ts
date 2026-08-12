import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';

contextBridge.exposeInMainWorld('ipc', {
  postMessage: (message: string) => {
    ipcRenderer.sendToHost('btrack-game', message);
  },
});

void webFrame.executeJavaScript(HASH_POLL_SCRIPT);
