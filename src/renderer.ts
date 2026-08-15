import './index.css';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';
import type {
  AutomationScript,
  AutomationSettings,
  GameData,
  LogLevel,
  StoredGame,
} from './types';

const BUSTABIT_URL = 'https://bustabit.com/play';
const REDBOT_CHANNEL = '@Redbot';
const MAX_GAMES_IN_MEMORY = 100;
const MAX_VISIBLE_GAMES = 10;
const DEVELOPER_MODE_KEY = 'bustabit-monitor:developer-mode';
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (
  round: StoredGame,
  recentRounds: StoredGame[],
  sendMessage: (text: string) => Promise<void>,
  getHistory: (offset?: number, limit?: number) => Promise<StoredGame[]>,
) => Promise<unknown>;

const webview = document.getElementById('game-webview') as Electron.WebviewTag;
const explorerStatusEl = document.getElementById('explorer-status') as HTMLSpanElement;
const explorerValueEl = document.getElementById('explorer-value') as HTMLElement;
const gamesEl = document.getElementById('games') as HTMLTableSectionElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const developerModeEl = document.getElementById(
  'toggle-developer-mode',
) as HTMLInputElement;
const developerModeLabelEl = document.getElementById(
  'developer-mode-label',
) as HTMLSpanElement;
const developerOnlyEls = document.querySelectorAll<HTMLElement>('.developer-only');
const botTokenEl = document.getElementById('bot-token') as HTMLInputElement;
const chatIdEl = document.getElementById('chat-id') as HTMLInputElement;
const saveCredentialsEl = document.getElementById('save-credentials') as HTMLButtonElement;
const automationResultEl = document.getElementById('automation-result') as HTMLParagraphElement;
const scriptsEl = document.getElementById('automation-scripts') as HTMLTableSectionElement;
const addScriptEl = document.getElementById('add-script') as HTMLButtonElement;
const scriptDialogEl = document.getElementById('script-dialog') as HTMLDialogElement;
const scriptFormEl = document.getElementById('script-form') as HTMLFormElement;
const scriptDialogTitleEl = document.getElementById('script-dialog-title') as HTMLHeadingElement;
const closeScriptDialogEl = document.getElementById('close-script-dialog') as HTMLButtonElement;
const scriptNameEl = document.getElementById('script-name') as HTMLInputElement;
const scriptCodeEl = document.getElementById('script-code') as HTMLTextAreaElement;
const copyPromptEl = document.getElementById('copy-prompt') as HTMLButtonElement;
const refreshLogsEl = document.getElementById('refresh-logs') as HTMLButtonElement;
const copyLogsEl = document.getElementById('copy-logs') as HTMLButtonElement;
const openLogFolderEl = document.getElementById('open-log-folder') as HTMLButtonElement;
const logPathEl = document.getElementById('log-path') as HTMLParagraphElement;
const diagnosticLogsEl = document.getElementById('diagnostic-logs') as HTMLPreElement;
const automationStatusEl = document.getElementById(
  'automation-status',
) as HTMLSpanElement;
const scriptResultEl = document.getElementById('script-result') as HTMLParagraphElement;
const games: StoredGame[] = [];
let automation: AutomationSettings = {
  botToken: '',
  chatId: '',
  scripts: [],
};
let roundQueue = Promise.resolve();
let displayedLogs = '';
let developerMode = localStorage.getItem(DEVELOPER_MODE_KEY) === 'true';
let webviewReady = false;
let editingScriptId: string | null = null;
const scriptRunResults = new Map<string, { message: string; error: boolean }>();

const CHATBOT_PROMPT = `I need you to write a JavaScript automation script for a desktop application called Bustabit Monitor.

Context
The application watches completed Bustabit game rounds. I will paste your JavaScript into the application's "Add round script" dialog, save it, and enable it in the scripts table. Every enabled script executes once after each newly completed round has been saved. It should decide whether a Telegram message needs to be sent. Do not write an entire application, Telegram client, HTML page, Node.js program, or installation instructions. Return only code that can be pasted directly into the script editor, unless I explicitly ask for an explanation.

Runtime API
The script body runs inside an async JavaScript function, so top-level await is supported. These four values are already available as variables. Do not import, declare, or mock them:

1. round
The newly completed round:
{
  id: number,
  hash: string,
  bust: number,
  receivedAt: string, // ISO timestamp when the app stored/reconstructed it
  reconstructed?: boolean // true when recovered from the hash chain
}

2. recentRounds
An array containing at most the newest 100 rounds, ordered newest first. recentRounds[0] is the current round. Every item has the same fields as round. Do not mutate this array.

3. sendMessage(text)
An async function that sends text to the Telegram bot and chat configured in the application. Call it with non-empty text and await it:
await sendMessage("Alert text");
It throws an error if Telegram rejects the message or cannot be reached. Only call it when the requested condition is met. Telegram messages should be concise and useful.

4. getHistory(offset = 0, limit = 100)
An async function that loads completed rounds from persistent disk history, newest first. Missing classic-era rounds are reconstructed from the verified hash chain back to game 12,279,451. It returns a Promise of round objects. offset skips that many newest records, and limit can be from 1 to 1000. Page through history when more than 1000 records are needed rather than requesting or retaining an unbounded amount of data. The current round is already present at offset 0.

Rules and constraints
- Write ordinary modern JavaScript, not TypeScript. Do not include Markdown code fences in the final answer.
- The script is invoked again independently for every new round. Variables created by one invocation should not be assumed to exist on the next invocation.
- Prefer recentRounds when the strategy needs no more than 100 rounds. Use getHistory only when older data is genuinely required.
- Prevent false alerts when there is insufficient history. Check array lengths before calculating statistics or streaks.
- Avoid infinite loops, timers, polling, DOM access, filesystem access, environment variables, npm packages, require, imports, and direct Telegram HTTP requests.
- Do not expose the bot token or chat ID in messages or code. Use sendMessage.
- Avoid duplicate alerts within one invocation. Usually make at most one sendMessage call per completed round unless I explicitly request otherwise.
- Handle numeric comparisons carefully. The bust value is already a multiplier such as 1.42 or 12.5.
- If the requested strategy is ambiguous, ask me focused questions before producing code. Otherwise, produce a complete paste-ready script.

Examples

Alert when the current multiplier reaches 10x:
if (round.bust >= 10) {
  await sendMessage(\`🚨 Round \${round.id} reached \${round.bust.toFixed(2)}x\`);
}

Alert after five consecutive rounds below 2x:
const window = recentRounds.slice(0, 5);
if (window.length === 5 && window.every((item) => item.bust < 2)) {
  await sendMessage(
    \`Five consecutive rounds below 2x. Latest: \${round.bust.toFixed(2)}x\`,
  );
}

Alert when the current round is at least three times the average of the previous 20 rounds:
const previous = recentRounds.slice(1, 21);
if (previous.length === 20) {
  const average = previous.reduce((sum, item) => sum + item.bust, 0) / previous.length;
  if (round.bust >= average * 3) {
    await sendMessage(
      \`Round \${round.id}: \${round.bust.toFixed(2)}x versus previous average \${average.toFixed(2)}x\`,
    );
  }
}

Use older persisted history in bounded pages:
const latestThousand = await getHistory(0, 1000);
if (latestThousand.length >= 100) {
  const highRounds = latestThousand.filter((item) => item.bust >= 10).length;
  const rate = (highRounds / latestThousand.length) * 100;
  if (round.bust >= 10) {
    await sendMessage(
      \`10x+ round: \${round.bust.toFixed(2)}x. Recent 10x+ rate: \${rate.toFixed(1)}%\`,
    );
  }
}

My requested strategy
Describe the strategy here, including thresholds, lookback size, message wording, and any cooldown or edge-case behavior. Then generate the paste-ready script.`;

function setStatus(message: string) {
  statusEl.textContent = message;
}

function setScriptResult(message: string, error = false) {
  scriptResultEl.textContent = message;
  scriptResultEl.classList.toggle('error', error);
}

function setAutomationResult(message: string, error = false) {
  automationResultEl.textContent = message;
  automationResultEl.classList.toggle('error', error);
}

function setAutomationStatus() {
  const activeCount = automation.scripts.filter((script) => script.enabled).length;
  automationStatusEl.textContent = `${activeCount} active`;
  automationStatusEl.classList.toggle('running', activeCount > 0);
}

function setDeveloperMode(enabled: boolean) {
  developerMode = enabled;
  localStorage.setItem(DEVELOPER_MODE_KEY, String(enabled));
  developerModeEl.checked = enabled;
  developerModeEl.setAttribute('aria-label', `${enabled ? 'Disable' : 'Enable'} developer mode`);
  developerModeLabelEl.textContent = 'Developer mode';
  developerOnlyEls.forEach((element) => {
    element.hidden = !enabled;
  });
  if (enabled) void refreshDiagnosticLogs();
}

function logRenderer(
  level: LogLevel,
  scope: string,
  message: string,
  details?: unknown,
) {
  void window.electronAPI?.log(level, scope, message, details).catch(() => undefined);
}

function errorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) };
}

function getWebviewPreloadPath(): string | null {
  return new URLSearchParams(window.location.search).get('webviewPreload');
}

type RedbotChatProbe = {
  pageReady: boolean;
  open: boolean;
  label: string | null;
  chatInputReady: boolean;
};

function probeRedbotChat(): Promise<RedbotChatProbe> {
  return webview.executeJavaScript(`
    (function () {
      var targetChannel = ${JSON.stringify(REDBOT_CHANNEL)};

      function textOf(node) {
        var text = node.innerText !== undefined ? node.innerText : node.textContent;
        return text == null ? '' : String(text).trim();
      }

      function isVisible(node) {
        if (!node || !node.getBoundingClientRect) return false;
        var style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        var rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function isPageReady() {
        var root = document.getElementById('root');
        return Boolean(root && root.children.length > 0);
      }

      function isRedbotChannel(channel) {
        return channel.toLowerCase() === targetChannel.toLowerCase();
      }

      function findRedbotTabLabel() {
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var paragraphs = buttons[i].querySelectorAll('p');
          for (var j = 0; j < paragraphs.length; j++) {
            if (textOf(paragraphs[j]) === 'Redbot') return 'Redbot';
          }
        }
        return null;
      }

      function findChatInput() {
        var input = document.querySelector('input[name="message-input"]');
        return input && isVisible(input) ? input : null;
      }

      if (!isPageReady()) {
        return { pageReady: false, open: false, label: null, chatInputReady: false };
      }

      var activeChannel = localStorage.getItem('active_channel') || '';
      var open = isRedbotChannel(activeChannel) || findRedbotTabLabel() != null;
      return {
        pageReady: true,
        open: open,
        label: open ? 'Redbot' : null,
        chatInputReady: open && findChatInput() != null,
      };
    })();
  `);
}

async function refreshExplorerValue() {
  if (!webviewReady) {
    explorerValueEl.textContent = 'Waiting for the webview…';
    explorerValueEl.classList.add('missing');
    explorerStatusEl.textContent = 'Waiting…';
    return;
  }

  try {
    const probe = await probeRedbotChat();
    if (!probe.pageReady) {
      explorerValueEl.textContent = 'Waiting for Bustabit page…';
      explorerValueEl.classList.add('missing');
      explorerStatusEl.textContent = 'Loading…';
      return;
    }

    const missing = !probe.open;
    explorerValueEl.textContent = missing
      ? '(Redbot chat not open)'
      : probe.chatInputReady
        ? probe.label ?? 'Redbot'
        : `${probe.label ?? 'Redbot'} · input missing`;
    explorerValueEl.classList.toggle('missing', missing);
    explorerStatusEl.textContent = missing
      ? 'Closed'
      : probe.chatInputReady
        ? 'Ready'
        : 'Open';
  } catch (error) {
    explorerValueEl.textContent = '(unavailable)';
    explorerValueEl.classList.add('missing');
    explorerStatusEl.textContent = 'Error';
  }
}

async function initialize() {
  setDeveloperMode(developerMode);
  logRenderer('info', 'app', 'Renderer initialization started');
  if (!window.electronAPI) {
    throw new Error('Electron preload bridge is unavailable. Fully restart the application.');
  }
  const [storedGames, settings] = await Promise.all([
    window.electronAPI.getRecentGames(),
    window.electronAPI.getAutomationSettings(),
  ]);
  games.push(...storedGames.slice(0, MAX_GAMES_IN_MEMORY));
  automation = settings;
  botTokenEl.value = settings.botToken;
  chatIdEl.value = settings.chatId;
  setAutomationStatus();
  renderAutomationScripts();
  renderGames();
  logRenderer('info', 'app', 'Renderer initialization completed', {
    recentRoundsLoaded: games.length,
    enabledScriptCount: settings.scripts.filter((script) => script.enabled).length,
  });
}

function refreshExplorerWhenInteractive() {
  if (!webviewReady) return;
  void refreshExplorerValue();
}

const initialization = initialize().catch((error) => {
  const message = getErrorMessage(error);
  setStatus(`Could not load local app data: ${message}`);
  logRenderer('error', 'app', 'Renderer initialization failed', errorDetails(error));
});
const webviewPreloadPath = getWebviewPreloadPath();

if (!webviewPreloadPath) {
  setStatus('Missing WebView preload path. Restart the application.');
  logRenderer('error', 'webview', 'WebView preload path is unavailable');
} else {
  webview.preload = webviewPreloadPath;
  try {
    const currentUrl = webview.getURL();
    if (!currentUrl || currentUrl === 'about:blank') {
      webview.src = BUSTABIT_URL;
      setStatus('Connecting...');
    } else {
      webviewReady = true;
      void refreshExplorerValue();
    }
  } catch {
    webview.src = BUSTABIT_URL;
    setStatus('Connecting...');
  }
  logRenderer('info', 'webview', 'WebView configured', {
    url: BUSTABIT_URL,
    hasPreloadPath: true,
  });
}

webview.addEventListener('dom-ready', () => {
  logRenderer('info', 'webview', 'WebView DOM is ready');
  webviewReady = true;
  void refreshExplorerValue();
  webview
    .executeJavaScript(HASH_POLL_SCRIPT)
    .then(() => {
      setStatus('Connected. Waiting for the next completed round...');
      logRenderer('info', 'webview', 'Round monitor script installed');
    })
    .catch((error) => {
      const message = getErrorMessage(error);
      setStatus(`Failed to start the game monitor: ${message}`);
      logRenderer('error', 'webview', 'Could not install round monitor script', errorDetails(error));
    });
});

webview.addEventListener('did-start-loading', () =>
  logRenderer('debug', 'webview', 'WebView started loading'),
);

webview.addEventListener('did-stop-loading', () => {
  logRenderer('info', 'webview', 'WebView stopped loading', { url: webview.getURL() });
  refreshExplorerWhenInteractive();
});

webview.addEventListener('did-navigate', (event) => {
  webviewReady = false;
  explorerStatusEl.textContent = 'Waiting…';
  logRenderer('info', 'webview', 'WebView navigated', { url: event.url });
});

if (webviewPreloadPath) refreshExplorerWhenInteractive();

webview.addEventListener('console-message', (event) =>
  logRenderer(event.level >= 3 ? 'error' : event.level === 2 ? 'warn' : 'debug', 'webview-console', event.message, {
    line: event.line,
    sourceId: event.sourceId,
  }),
);

webview.addEventListener('render-process-gone', (event) =>
  logRenderer('error', 'webview', 'WebView renderer process exited', { reason: event.reason }),
);

webview.addEventListener('did-fail-load', (event) => {
  if (event.isMainFrame) {
    setStatus(`Load failed (${event.errorCode}: ${event.errorDescription}).`);
    logRenderer('error', 'webview', 'WebView failed to load', {
      errorCode: event.errorCode,
      errorDescription: event.errorDescription,
      validatedURL: event.validatedURL,
    });
  }
});

webview.addEventListener('ipc-message', (event) => {
  if (event.channel === 'btrack-log') {
    try {
      const entry = JSON.parse(event.args[0] as string) as {
        level?: LogLevel;
        message?: string;
        details?: unknown;
      };
      logRenderer(
        entry.level ?? 'info',
        'webview-monitor',
        entry.message ?? 'WebView monitor event',
        entry.details,
      );
    } catch (error) {
      logRenderer('warn', 'webview-monitor', 'Invalid monitor log payload', errorDetails(error));
    }
    return;
  }
  if (event.channel !== 'btrack-game') return;

  try {
    const game = JSON.parse(event.args[0] as string) as GameData;
    logRenderer('debug', 'games', 'Round received from WebView', {
      id: game.id,
      bust: game.bust,
      hash: game.hash?.slice(0, 12),
    });
    roundQueue = roundQueue
      .then(async () => {
        await initialization;
        await addGame(game);
      })
      .catch((error) => {
        const message = getErrorMessage(error);
        setStatus(`Could not save the latest round: ${message}`);
        logRenderer('error', 'games', 'Round processing failed', {
          id: game.id,
          error: errorDetails(error),
        });
      });
  } catch (error) {
    setStatus(`Received invalid game data: ${getErrorMessage(error)}`);
    logRenderer('error', 'games', 'Invalid WebView round payload', errorDetails(error));
  }
});

setInterval(() => {
  void refreshExplorerValue();
}, 1000);

saveCredentialsEl.addEventListener('click', async () => {
  automation = {
    ...automation,
    botToken: botTokenEl.value.trim(),
    chatId: chatIdEl.value.trim(),
  };
  try {
    await saveAutomationSettings();
    setAutomationResult('Telegram connection saved.');
  } catch (error) {
    setAutomationResult(`Could not save: ${getErrorMessage(error)}`, true);
  }
});

addScriptEl.addEventListener('click', () => openScriptDialog());

closeScriptDialogEl.addEventListener('click', () => scriptDialogEl.close());

scriptFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = scriptNameEl.value.trim();
  const code = scriptCodeEl.value;
  if (!name || !code.trim()) {
    setScriptResult('Enter both a name and script code.', true);
    return;
  }

  try {
    new AsyncFunction('round', 'recentRounds', 'sendMessage', 'getHistory', code);
    const existing = automation.scripts.find((script) => script.id === editingScriptId);
    const script: AutomationScript = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      code,
      enabled: existing?.enabled ?? true,
    };
    automation = {
      ...automation,
      scripts: existing
        ? automation.scripts.map((item) => item.id === script.id ? script : item)
        : [...automation.scripts, script],
    };
    await saveAutomationSettings();
    renderAutomationScripts();
    scriptDialogEl.close();
    logRenderer('info', 'automation', existing ? 'Script updated' : 'Script added', {
      scriptId: script.id,
      scriptName: script.name,
      scriptCharacters: script.code.length,
    });
  } catch (error) {
    setScriptResult(`Script error: ${getErrorMessage(error)}`, true);
  }
});

copyPromptEl.addEventListener('click', () => {
  window.electronAPI.copyText(CHATBOT_PROMPT);
  setScriptResult('Chatbot prompt copied.');
  logRenderer('info', 'clipboard', 'Chatbot prompt copied');
});

developerModeEl.addEventListener('change', () => {
  setDeveloperMode(developerModeEl.checked);
  logRenderer('info', 'developer-mode', developerMode ? 'Enabled' : 'Disabled');
});

refreshLogsEl.addEventListener('click', () => void refreshDiagnosticLogs());

copyLogsEl.addEventListener('click', async () => {
  await refreshDiagnosticLogs();
  window.electronAPI.copyText(displayedLogs);
  setAutomationResult('Diagnostic logs copied to the clipboard.');
  logRenderer('info', 'diagnostics', 'Displayed logs copied');
});

openLogFolderEl.addEventListener('click', async () => {
  const error = await window.electronAPI.openLogFolder();
  if (error) {
    setAutomationResult(`Could not open log folder: ${error}`, true);
    logRenderer('error', 'diagnostics', 'Could not open log folder', { error });
  } else {
    logRenderer('info', 'diagnostics', 'Log folder opened');
  }
});

scriptsEl.addEventListener('change', async (event) => {
  const toggle = event.target as HTMLInputElement;
  if (!toggle.matches('input[data-script-id]')) return;
  const script = automation.scripts.find((item) => item.id === toggle.dataset.scriptId);
  if (!script) return;

  script.enabled = toggle.checked;
  try {
    await saveAutomationSettings();
    renderAutomationScripts();
    logRenderer('info', 'automation', script.enabled ? 'Script enabled' : 'Script disabled', {
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    script.enabled = !toggle.checked;
    toggle.checked = script.enabled;
    setAutomationResult(`Could not update script: ${getErrorMessage(error)}`, true);
  }
});

scriptsEl.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button) return;
  const script = automation.scripts.find((item) => item.id === button.dataset.scriptId);
  if (!script) return;

  if (button.dataset.action === 'edit') {
    openScriptDialog(script);
    return;
  }
  if (button.dataset.action !== 'delete' || !window.confirm(`Delete “${script.name}”?`)) return;

  automation = {
    ...automation,
    scripts: automation.scripts.filter((item) => item.id !== script.id),
  };
  scriptRunResults.delete(script.id);
  try {
    await saveAutomationSettings();
    renderAutomationScripts();
    logRenderer('info', 'automation', 'Script deleted', {
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    automation = { ...automation, scripts: [...automation.scripts, script] };
    renderAutomationScripts();
    setAutomationResult(`Could not delete script: ${getErrorMessage(error)}`, true);
  }
});

window.addEventListener('error', (event) =>
  logRenderer('error', 'window', 'Unhandled renderer error', {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    error: errorDetails(event.error),
  }),
);

window.addEventListener('unhandledrejection', (event) =>
  logRenderer('error', 'window', 'Unhandled renderer rejection', errorDetails(event.reason)),
);

window.electronAPI?.onBackfillProgress((progress) => {
  const percent = progress.total === 0
    ? 100
    : Math.floor((progress.processed / progress.total) * 100);
  setStatus(
    progress.processed === progress.total
      ? `History backfill complete. ${progress.total.toLocaleString()} rounds stored.`
      : `Backfilling history: ${percent}% (${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()})`,
  );
});

async function saveAutomationSettings() {
  await window.electronAPI.saveAutomationSettings(automation);
  setAutomationStatus();
}

function openScriptDialog(script?: AutomationScript) {
  editingScriptId = script?.id ?? null;
  scriptDialogTitleEl.textContent = script ? 'Edit round script' : 'Add round script';
  scriptNameEl.value = script?.name ?? '';
  scriptCodeEl.value = script?.code ?? '';
  setScriptResult('');
  scriptDialogEl.showModal();
  scriptNameEl.focus();
}

function createHeroIcon(pathData: string) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  const path = document.createElementNS(namespace, 'path');

  icon.setAttribute('class', 'button-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  icon.setAttribute('aria-hidden', 'true');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', pathData);
  icon.append(path);
  return icon;
}

function addButtonIcon(button: HTMLButtonElement, pathData: string) {
  button.classList.add('with-icon');
  button.prepend(createHeroIcon(pathData));
}

addButtonIcon(addScriptEl, 'M12 4.5v15m7.5-7.5h-15');
addButtonIcon(copyPromptEl, 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V10.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 7.5h3.375c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V9.75m7.5 7.5h-6.375A1.125 1.125 0 0 1 8.25 16.125V9.75');
addButtonIcon(closeScriptDialogEl, 'M6 18 18 6M6 6l12 12');
addButtonIcon(refreshLogsEl, 'M16.023 9.348h4.992V4.356m-1.291 9.768a8.25 8.25 0 1 1-2.23-8.362L21.015 9.348');
addButtonIcon(copyLogsEl, 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V10.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 7.5h3.375c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V9.75m7.5 7.5h-6.375A1.125 1.125 0 0 1 8.25 16.125V9.75');
addButtonIcon(openLogFolderEl, 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-5.25a2.25 2.25 0 0 0-2.25-2.25H4.5a2.25 2.25 0 0 0-2.25 2.25Z');

function renderAutomationScripts() {
  setAutomationStatus();
  if (automation.scripts.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'script-empty';
    cell.textContent = 'No scripts yet. Add one to start automating rounds.';
    row.append(cell);
    scriptsEl.replaceChildren(row);
    return;
  }

  scriptsEl.replaceChildren(...automation.scripts.map((script) => {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const result = document.createElement('td');
    const enabled = document.createElement('td');
    const actions = document.createElement('td');
    const toggleLabel = document.createElement('label');
    const toggle = document.createElement('input');
    const toggleTrack = document.createElement('span');
    const toggleText = document.createElement('span');
    const edit = document.createElement('button');
    const remove = document.createElement('button');
    const lastRun = scriptRunResults.get(script.id);

    name.textContent = script.name;
    name.className = 'script-name';
    result.textContent = lastRun?.message ?? 'Not run yet';
    result.className = `script-run-result${lastRun?.error ? ' error' : ''}`;
    toggle.type = 'checkbox';
    toggle.checked = script.enabled;
    toggle.dataset.scriptId = script.id;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', `${script.enabled ? 'Disable' : 'Enable'} ${script.name}`);
    toggleLabel.className = 'script-toggle';
    toggleTrack.className = 'script-toggle-track';
    toggleTrack.setAttribute('aria-hidden', 'true');
    toggleText.className = 'script-toggle-text';
    toggleText.textContent = script.enabled ? 'On' : 'Off';
    toggleLabel.append(toggle, toggleTrack, toggleText);
    enabled.append(toggleLabel);
    edit.type = 'button';
    edit.className = 'secondary compact with-icon';
    edit.append(
      createHeroIcon(
        'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14.25v4.875A2.625 2.625 0 0 1 15.375 21H5.625A2.625 2.625 0 0 1 3 18.375V8.625A2.625 2.625 0 0 1 5.625 6h4.875',
      ),
      document.createTextNode('Edit'),
    );
    edit.dataset.action = 'edit';
    edit.dataset.scriptId = script.id;
    remove.type = 'button';
    remove.className = 'destructive compact';
    remove.append(
      createHeroIcon(
        'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.92 21H8.08a2.25 2.25 0 0 1-2.24-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
      ),
      document.createTextNode('Delete'),
    );
    remove.dataset.action = 'delete';
    remove.dataset.scriptId = script.id;
    actions.className = 'script-actions';
    actions.append(edit, remove);
    row.append(name, result, enabled, actions);
    return row;
  }));
}

async function addGame(data: GameData) {
  if (!data.hash || data.id == null || data.bust == null) {
    logRenderer('warn', 'games', 'Incomplete round ignored', {
      hasHash: Boolean(data.hash),
      id: data.id,
      bust: data.bust,
    });
    return;
  }

  const storedGame = await window.electronAPI.storeGame(data);
  if (!storedGame) {
    logRenderer('debug', 'games', 'Round was rejected or already stored', { id: data.id });
    return;
  }

  const storedGames = await window.electronAPI.getRecentGames();
  games.splice(0, games.length, ...storedGames.slice(0, MAX_GAMES_IN_MEMORY));
  renderGames();
  setStatus(`Live. Keeping ${games.length} recent round${games.length === 1 ? '' : 's'} in memory.`);
  logRenderer('info', 'games', 'Round added to renderer memory', {
    id: storedGame.id,
    roundsInMemory: games.length,
    roundsVisible: Math.min(games.length, MAX_VISIBLE_GAMES),
  });
  const enabledScripts = automation.scripts.filter((script) => script.enabled);
  await Promise.all(enabledScripts.map((script) => runAutomation(script, storedGame)));
}

async function runAutomation(script: AutomationScript, round: StoredGame) {
  try {
    const execute = new AsyncFunction(
      'round',
      'recentRounds',
      'sendMessage',
      'getHistory',
      script.code,
    );
    const sendMessage = async (text: string) => {
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('sendMessage requires non-empty text');
      }

      const result = await window.electronAPI.sendTelegramMessage(
        automation.botToken,
        automation.chatId,
        text,
      );
      if (!result.ok) throw new Error(result.error);
      logRenderer('info', 'automation', 'Script sent a Telegram message', {
        roundId: round.id,
        messageCharacters: text.length,
      });
    };
    await execute(
      round,
      games.map((game) => ({ ...game })),
      sendMessage,
      window.electronAPI.getGameHistory,
    );
    scriptRunResults.set(script.id, {
      message: `Succeeded for round ${round.id}`,
      error: false,
    });
    logRenderer('info', 'automation', 'Round script completed', {
      roundId: round.id,
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    scriptRunResults.set(script.id, {
      message: `Round ${round.id}: ${getErrorMessage(error)}`,
      error: true,
    });
    logRenderer('error', 'automation', 'Round script failed', {
      roundId: round.id,
      scriptId: script.id,
      scriptName: script.name,
      error: errorDetails(error),
    });
  } finally {
    renderAutomationScripts();
  }
}

async function refreshDiagnosticLogs() {
  try {
    const logs = await window.electronAPI.getDiagnosticLogs();
    displayedLogs = logs.content;
    logPathEl.textContent = logs.path;
    logPathEl.title = logs.path;
    diagnosticLogsEl.textContent = logs.content || 'No diagnostics have been written yet.';
    diagnosticLogsEl.scrollTop = diagnosticLogsEl.scrollHeight;
  } catch (error) {
    diagnosticLogsEl.textContent = `Could not load diagnostics: ${getErrorMessage(error)}`;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function renderGames() {
  const visibleGames = games.slice(0, MAX_VISIBLE_GAMES);
  if (visibleGames.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    row.id = 'empty-row';
    cell.colSpan = 4;
    cell.textContent = 'Waiting for the next completed round...';
    row.append(cell);
    gamesEl.replaceChildren(row);
    return;
  }

  gamesEl.replaceChildren(
    ...visibleGames.map((game) => {
      const row = document.createElement('tr');
      const id = document.createElement('td');
      const hash = document.createElement('td');
      const bust = document.createElement('td');
      const received = document.createElement('td');

      id.textContent = String(game.id);
      hash.textContent = game.hash;
      hash.className = 'hash';
      bust.textContent = `${game.bust.toFixed(2)}x`;
      bust.className = `bust ${game.bust >= 2 ? 'high' : 'low'}`;
      received.textContent = new Date(game.receivedAt).toLocaleTimeString();
      row.append(id, hash, bust, received);
      return row;
    }),
  );
}
