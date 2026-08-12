import './index.css';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';
import type { GameData } from './types';

const BUSTABIT_URL = 'https://bustabit.com/play';

const webview = document.getElementById('game-webview') as Electron.WebviewTag;
const gameIdEl = document.getElementById('game-id')!;
const gameHashEl = document.getElementById('game-hash')!;
const gameBustEl = document.getElementById('game-bust')!;
const statusEl = document.getElementById('status')!;

function setStatus(message: string) {
  statusEl.textContent = message;
}

function getWebviewPreloadPath(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get(
    'webviewPreload',
  );
  if (fromQuery) return fromQuery;

  return window.electronAPI?.webviewPreload ?? null;
}

const webviewPreloadPath = getWebviewPreloadPath();

if (!webviewPreloadPath) {
  setStatus('Missing webview preload path — restart the application.');
  throw new Error('webview preload path is unavailable');
}

let started = false;

function startWebview() {
  if (started) return;
  started = true;

  webview.preload = webviewPreloadPath;
  webview.src = BUSTABIT_URL;
  setStatus('Loading bustabit.com/play…');
}

webview.addEventListener('dom-ready', () => {
  setStatus('Page loaded — waiting for game engine…');

  webview
    .executeJavaScript(HASH_POLL_SCRIPT)
    .then(() => {
      setStatus('Polling for game data…');
    })
    .catch(() => {
      setStatus('Failed to inject monitor script.');
    });
});

webview.addEventListener('did-fail-load', (event) => {
  if (event.isMainFrame) {
    setStatus(`Failed to load page (${event.errorCode}: ${event.errorDescription}).`);
  }
});

webview.addEventListener('ipc-message', (event) => {
  if (event.channel !== 'btrack-game') return;

  try {
    const data = JSON.parse(event.args[0] as string) as GameData;
    updateGameUI(data);
  } catch {
    setStatus('Received invalid game data.');
  }
});

function updateGameUI(data: GameData) {
  gameIdEl.textContent = data.id != null ? String(data.id) : 'Unavailable';
  gameHashEl.textContent = data.hash;
  gameBustEl.textContent = data.bust != null ? `${data.bust}x` : 'In progress';
  setStatus(`Last update: ${new Date().toLocaleTimeString()}`);
}

startWebview();
