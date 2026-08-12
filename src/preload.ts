import { contextBridge } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    webviewPreload: pathToFileURL(
      path.join(__dirname, 'webview-preload.js'),
    ).href,
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
