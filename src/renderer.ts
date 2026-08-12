import './index.css';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';
import type { GameData } from './types';

const BUSTABIT_URL = 'https://bustabit.com/play';
const MAX_GAMES = 100;

const webview = document.getElementById('game-webview') as Electron.WebviewTag;
const gamesEl = document.getElementById('games') as HTMLTableSectionElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const games: Array<GameData & { receivedAt: Date }> = [];

function setStatus(message: string) {
  statusEl.textContent = message;
}

function getWebviewPreloadPath(): string | null {
  return new URLSearchParams(window.location.search).get('webviewPreload') ??
    window.electronAPI?.webviewPreload ??
    null;
}

const webviewPreloadPath = getWebviewPreloadPath();

if (!webviewPreloadPath) {
  setStatus('Missing WebView preload path. Restart the application.');
  throw new Error('webview preload path is unavailable');
}

webview.preload = webviewPreloadPath;
webview.src = BUSTABIT_URL;
setStatus('Connecting...');

webview.addEventListener('dom-ready', () => {
  webview
    .executeJavaScript(HASH_POLL_SCRIPT)
    .then(() => setStatus('Connected. Waiting for the next completed game...'))
    .catch(() => setStatus('Failed to start the game monitor.'));
});

webview.addEventListener('did-fail-load', (event) => {
  if (event.isMainFrame) {
    setStatus(`Load failed (${event.errorCode}: ${event.errorDescription}).`);
  }
});

webview.addEventListener('ipc-message', (event) => {
  if (event.channel !== 'btrack-game') return;

  try {
    addGame(JSON.parse(event.args[0] as string) as GameData);
  } catch {
    setStatus('Received invalid game data.');
  }
});

function addGame(data: GameData) {
  if (!data.hash || data.id == null || data.bust == null) return;

  const existing = games.findIndex((game) => game.hash === data.hash);
  if (existing >= 0) games.splice(existing, 1);
  games.unshift({ ...data, receivedAt: new Date() });
  games.splice(MAX_GAMES);
  renderGames();
  setStatus(`Live. ${games.length} game${games.length === 1 ? '' : 's'} captured.`);
}

function renderGames() {
  gamesEl.replaceChildren(
    ...games.map((game) => {
      const row = document.createElement('tr');
      const id = document.createElement('td');
      const hash = document.createElement('td');
      const bust = document.createElement('td');
      const received = document.createElement('td');

      id.textContent = String(game.id);
      hash.textContent = game.hash;
      hash.className = 'hash';
      bust.textContent = `${game.bust.toFixed(2)}x`;
      bust.className = game.bust >= 2 ? 'bust high' : 'bust low';
      received.textContent = game.receivedAt.toLocaleTimeString();
      row.append(id, hash, bust, received);
      return row;
    }),
  );
}
