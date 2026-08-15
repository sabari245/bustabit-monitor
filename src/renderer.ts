import './index.css';
import { HASH_POLL_SCRIPT } from './injected/hash-poll';
import type {
  AutomationScript,
  AutomationSettings,
  GameData,
  LogLevel,
  RedbotBetPage,
  RedbotBetRecord,
  RedbotChatMessage,
  StoredGame,
} from './types';

const BUSTABIT_URL = 'https://bustabit.com/play';
const REDBOT_CHANNEL = '@Redbot';
const MAX_GAMES_IN_MEMORY = 100;
const MAX_VISIBLE_GAMES = 10;
const REDBOT_ACTIVITY_PAGE_SIZE = 10;
const DEVELOPER_MODE_KEY = 'bustabit-monitor:developer-mode';
const AsyncFunction = Object.getPrototypeOf(async (): Promise<undefined> => undefined).constructor as new (
  ...args: string[]
) => (
  round: StoredGame,
  recentRounds: StoredGame[],
  sendMessage: (text: string) => Promise<void>,
  getHistory: (offset?: number, limit?: number) => Promise<StoredGame[]>,
) => Promise<unknown>;

type RedbotApi = {
  send: (command: string) => Promise<void>;
  bet: (bits: number | 'max') => Promise<void>;
  one: (bits: number) => Promise<void>;
  low: (bits: number) => Promise<void>;
  underTen: (bits: number) => Promise<void>;
  safe: (bits: number) => Promise<void>;
  spin: (bits: number, times?: number) => Promise<void>;
  stop: () => Promise<void>;
  balance: () => Promise<void>;
  withdraw: (bits: number) => Promise<void>;
};

const RedbotAsyncFunction = Object.getPrototypeOf(async (): Promise<undefined> => undefined).constructor as new (
  ...args: string[]
) => (
  round: StoredGame,
  recentRounds: StoredGame[],
  redbot: RedbotApi,
  getHistory: (offset?: number, limit?: number) => Promise<StoredGame[]>,
) => Promise<unknown>;

const webview = document.getElementById('game-webview') as Electron.WebviewTag;
const explorerStatusEl = document.getElementById('explorer-status') as HTMLSpanElement;
const explorerValueEl = document.getElementById('explorer-value') as HTMLElement;
const redbotAutomationStatusEl = document.getElementById(
  'redbot-automation-status',
) as HTMLSpanElement;
const redbotScriptsEl = document.getElementById(
  'redbot-automation-scripts',
) as HTMLTableSectionElement;
const addRedbotScriptEl = document.getElementById('add-redbot-script') as HTMLButtonElement;
const redbotScriptDialogEl = document.getElementById(
  'redbot-script-dialog',
) as HTMLDialogElement;
const redbotScriptFormEl = document.getElementById('redbot-script-form') as HTMLFormElement;
const redbotScriptDialogTitleEl = document.getElementById(
  'redbot-script-dialog-title',
) as HTMLHeadingElement;
const closeRedbotScriptDialogEl = document.getElementById(
  'close-redbot-script-dialog',
) as HTMLButtonElement;
const redbotScriptNameEl = document.getElementById('redbot-script-name') as HTMLInputElement;
const redbotScriptCodeEl = document.getElementById('redbot-script-code') as HTMLTextAreaElement;
const redbotScriptResultEl = document.getElementById(
  'redbot-script-result',
) as HTMLParagraphElement;
const copyRedbotPromptEl = document.getElementById('copy-redbot-prompt') as HTMLButtonElement;
const redbotReadinessDialogEl = document.getElementById(
  'redbot-readiness-dialog',
) as HTMLDialogElement;
const redbotReadinessTitleEl = document.getElementById(
  'redbot-readiness-title',
) as HTMLHeadingElement;
const redbotReadinessMessageEl = document.getElementById(
  'redbot-readiness-message',
) as HTMLParagraphElement;
const redbotReadinessListEl = document.getElementById(
  'redbot-readiness-list',
) as HTMLUListElement;
const redbotReadinessWarningEl = document.getElementById(
  'redbot-readiness-warning',
) as HTMLParagraphElement;
const closeRedbotReadinessDialogEl = document.getElementById(
  'close-redbot-readiness-dialog',
) as HTMLButtonElement;
const webviewFrameEl = document.getElementById('webview-frame') as HTMLDivElement;
const webviewLockEl = document.getElementById('webview-lock') as HTMLDivElement;
const redbotBalanceEl = document.getElementById('redbot-balance') as HTMLElement;
const redbotBalanceUpdatedEl = document.getElementById(
  'redbot-balance-updated',
) as HTMLSpanElement;
const redbotActivityEl = document.getElementById('redbot-activity') as HTMLTableSectionElement;
const redbotActivityPreviousEl = document.getElementById(
  'redbot-activity-previous',
) as HTMLButtonElement;
const redbotActivityFirstEl = document.getElementById(
  'redbot-activity-first',
) as HTMLButtonElement;
const redbotActivityNextEl = document.getElementById(
  'redbot-activity-next',
) as HTMLButtonElement;
const redbotActivityLastEl = document.getElementById(
  'redbot-activity-last',
) as HTMLButtonElement;
const redbotActivityPageEl = document.getElementById('redbot-activity-page') as HTMLSpanElement;
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
  redbotScripts: [],
  redbotDefaultsVersion: 1,
};
let roundQueue = Promise.resolve();
let displayedLogs = '';
let developerMode = localStorage.getItem(DEVELOPER_MODE_KEY) === 'true';
let webviewReady = false;
let editingScriptId: string | null = null;
let editingRedbotScriptId: string | null = null;
const scriptRunResults = new Map<string, { message: string; error: boolean }>();
const redbotScriptRunResults = new Map<string, { message: string; error: boolean }>();
let redbotActivityOffset = 0;
let redbotActivityTotal = 0;
let redbotActivitySyncing = false;
let redbotBalanceVerifiedAt: string | null = null;
let redbotBalanceCheckPromise: Promise<number> | null = null;

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

const REDBOT_CHATBOT_PROMPT = `I need you to write a JavaScript Redbot automation strategy for Bustabit Monitor.

The script runs once after every newly completed Bustabit round. Return only paste-ready JavaScript, without Markdown fences. It runs inside an async function and already receives these values:

1. round
The newest completed round: { id, hash, bust, receivedAt, reconstructed? }.

2. recentRounds
Up to 100 completed rounds, newest first. recentRounds[0] is round. Do not mutate it.

3. redbot
An object that sends commands to the currently selected private Redbot chat. Every method is async and must be awaited:
- await redbot.bet(bits) or await redbot.bet('max'): bet on the next game being under 1.98x.
- await redbot.one(bits): bet on under 1.01x.
- await redbot.low(bits): bet on under 1.2x.
- await redbot.underTen(bits): bet on under 10x.
- await redbot.safe(bits): bet on under 28x.
- await redbot.spin(bits, times = 1): run Redbot slots.
- await redbot.stop(): stop an active slot run.
- await redbot.balance(): request the Redbot balance.
- await redbot.withdraw(bits): withdraw from Redbot.
- await redbot.send(command): send another documented Redbot command beginning with $.

4. getHistory(offset = 0, limit = 100)
Loads stored rounds newest first. Limit is 1-1000. Page through history if more is required.

Safety rules
- This controls real Redbot funds. Use conservative bit amounts and never infer an omitted amount.
- Usually send at most one wagering command per round.
- Verify that enough history exists before calculating a streak or statistic.
- Do not use timers, polling, DOM access, fetch, imports, require, filesystem APIs, or direct Bustabit/Redbot APIs.
- Do not assume variables persist between invocations.
- The app itself verifies that the user is signed in, @Redbot is the active channel, and the chat input is visible before enabling or sending.
- If the requested amount, thresholds, lookback, cooldown, or loss limits are ambiguous, ask focused questions instead of generating code.

Example: bet 1 bit after five consecutive rounds below 1.98x:
const window = recentRounds.slice(0, 5);
if (window.length === 5 && window.every((item) => item.bust < 1.98)) {
  await redbot.bet(1);
}

My requested strategy
Describe the trigger, command, bit amount, lookback, cooldown, and stopping rules here.`;

function setStatus(message: string) {
  statusEl.textContent = message;
}

function setScriptResult(message: string, error = false) {
  scriptResultEl.textContent = message;
  scriptResultEl.classList.toggle('error', error);
}

function setRedbotScriptResult(message: string, error = false) {
  redbotScriptResultEl.textContent = message;
  redbotScriptResultEl.classList.toggle('error', error);
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

function setRedbotAutomationStatus() {
  const activeCount = automation.redbotScripts.filter((script) => script.enabled).length;
  const locked = activeCount > 0;
  redbotAutomationStatusEl.textContent = `${activeCount} active`;
  redbotAutomationStatusEl.classList.toggle('running', locked);
  webviewFrameEl.classList.toggle('locked', locked);
  webviewLockEl.hidden = !locked;
  webview.toggleAttribute('inert', locked);
  if (locked) webview.blur();
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
  activeChannel: string;
  redbotTabAvailable: boolean;
  redbotSelected: boolean;
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
        return {
          pageReady: false,
          activeChannel: '',
          redbotTabAvailable: false,
          redbotSelected: false,
          chatInputReady: false,
        };
      }

      var activeChannel = localStorage.getItem('active_channel') || '';
      var redbotSelected = isRedbotChannel(activeChannel);
      return {
        pageReady: true,
        activeChannel: activeChannel,
        redbotTabAvailable: findRedbotTabLabel() != null,
        redbotSelected: redbotSelected,
        chatInputReady: redbotSelected && findChatInput() != null,
      };
    })();
  `);
}

function probeRedbotActivityMessages(): Promise<RedbotChatMessage[]> {
  return webview.executeJavaScript(`
    (function () {
      var activityPattern = /(?:Your balance is [\\d,.]+ bits?|You have bet [\\d,.]+ bits?|The game was .+?\\. You (?:won|lost) [\\d,.]+ bits?)/i;
      var candidates = [];
      var elements = document.querySelectorAll('div, li, p');

      function textOf(node) {
        var text = node.innerText !== undefined ? node.innerText : node.textContent;
        return text == null ? '' : String(text).trim().replace(/\\s+/g, ' ');
      }

      for (var i = 0; i < elements.length; i++) {
        var text = textOf(elements[i]);
        if (!text || text.length > 500 || text.indexOf('Redbot:') < 0) continue;
        var rect = elements[i].getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.height > 60) continue;

        var labelIndex = text.indexOf('Redbot:');
        var message = text.slice(labelIndex + 'Redbot:'.length).trim();
        if (!activityPattern.test(message)) continue;
        var timeMatch = text.slice(0, labelIndex).match(/(?:^|\\s)(\\d{1,2}:\\d{2})(?:\\s|$)/);
        candidates.push({
          chatTime: timeMatch ? timeMatch[1] : null,
          message: message,
          top: Math.round(rect.top),
        });
      }

      candidates.sort(function (left, right) { return left.top - right.top; });
      var rowKeys = Object.create(null);
      var occurrences = Object.create(null);
      var output = [];
      for (var j = 0; j < candidates.length; j++) {
        var rowKey = String(candidates[j].top) + '|' + candidates[j].message;
        if (rowKeys[rowKey]) continue;
        rowKeys[rowKey] = true;
        var contentKey = (candidates[j].chatTime || '') + '|' + candidates[j].message.toLowerCase();
        occurrences[contentKey] = (occurrences[contentKey] || 0) + 1;
        output.push({
          sourceKey: contentKey + '|' + occurrences[contentKey],
          chatTime: candidates[j].chatTime,
          message: candidates[j].message,
        });
      }
      return output;
    })();
  `);
}

async function syncRedbotActivity(probe: RedbotChatProbe) {
  if (redbotActivitySyncing || !probe.redbotSelected || !webviewReady) return;
  redbotActivitySyncing = true;
  try {
    const messages = await probeRedbotActivityMessages();
    if (messages.length === 0) return;
    const stored = await window.electronAPI.storeRedbotChatMessages(messages);
    if (stored > 0) await refreshRedbotBets();
  } catch (error) {
    logRenderer('warn', 'redbot', 'Could not synchronize Redbot chat activity', errorDetails(error));
  } finally {
    redbotActivitySyncing = false;
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyRedbotBalance() {
  if (redbotBalanceCheckPromise) return redbotBalanceCheckPromise;
  redbotBalanceCheckPromise = (async () => {
    const probe = await getRedbotProbe();
    if (!redbotReady(probe)) throw new Error('The Redbot chat is not ready');

    const existingMessages = await probeRedbotActivityMessages();
    await window.electronAPI.storeRedbotChatMessages(existingMessages);
    const before = await window.electronAPI.getRedbotBets(0, REDBOT_ACTIVITY_PAGE_SIZE);
    explorerValueEl.textContent = 'Requesting the latest Redbot balance…';
    explorerStatusEl.textContent = 'Checking balance';
    await sendRedbotCommand('$bal');

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const messages = await probeRedbotActivityMessages();
      await window.electronAPI.storeRedbotChatMessages(messages);
      const page = await window.electronAPI.getRedbotBets(
        redbotActivityOffset,
        REDBOT_ACTIVITY_PAGE_SIZE,
      );
      renderRedbotBets(page);
      if (
        page.balanceBits != null &&
        page.balanceUpdatedAt &&
        page.balanceUpdatedAt !== before.balanceUpdatedAt
      ) {
        redbotBalanceVerifiedAt = page.balanceUpdatedAt;
        return page.balanceBits;
      }
      await wait(250);
    }
    throw new Error('Redbot did not return a new balance within 10 seconds');
  })();

  try {
    return await redbotBalanceCheckPromise;
  } finally {
    redbotBalanceCheckPromise = null;
    void refreshExplorerValue();
  }
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

    if (!probe.activeChannel) {
      explorerValueEl.textContent = 'Sign in to Bustabit';
      explorerValueEl.classList.add('missing');
      explorerStatusEl.textContent = 'Signed out';
    } else if (!probe.redbotSelected) {
      explorerValueEl.textContent = probe.redbotTabAvailable
        ? 'Select the Redbot conversation'
        : 'Open a private chat with Redbot';
      explorerValueEl.classList.add('missing');
      explorerStatusEl.textContent = 'Select Redbot';
    } else if (!probe.chatInputReady) {
      explorerValueEl.textContent = 'Open the Redbot chat view';
      explorerValueEl.classList.add('missing');
      explorerStatusEl.textContent = 'Chat hidden';
    } else {
      explorerValueEl.textContent = 'Redbot chat input is ready';
      explorerValueEl.classList.remove('missing');
      explorerStatusEl.textContent = 'Ready';
    }
    void syncRedbotActivity(probe);
  } catch (error) {
    explorerValueEl.textContent = '(unavailable)';
    explorerValueEl.classList.add('missing');
    explorerStatusEl.textContent = 'Error';
  }
}

function redbotReady(probe: RedbotChatProbe) {
  return probe.pageReady && probe.redbotSelected && probe.chatInputReady;
}

function unavailableRedbotProbe(): RedbotChatProbe {
  return {
    pageReady: false,
    activeChannel: '',
    redbotTabAvailable: false,
    redbotSelected: false,
    chatInputReady: false,
  };
}

async function getRedbotProbe() {
  if (!webviewReady) return unavailableRedbotProbe();
  try {
    return await probeRedbotChat();
  } catch {
    return unavailableRedbotProbe();
  }
}

function showRedbotReadinessDialog(probe: RedbotChatProbe) {
  redbotReadinessWarningEl.textContent = 'No wager was sent and the script remains disabled.';
  const signedIn = probe.pageReady && Boolean(probe.activeChannel);
  const steps = [
    { ready: probe.pageReady, text: 'Bustabit has finished loading.' },
    { ready: signedIn, text: 'You are signed in and chat is available.' },
    {
      ready: probe.redbotSelected,
      text: probe.redbotTabAvailable || probe.redbotSelected
        ? 'The private @Redbot conversation is selected.'
        : 'A private @Redbot conversation is open.',
    },
    { ready: probe.chatInputReady, text: 'The Redbot message input is visible.' },
  ];

  if (!probe.pageReady) {
    redbotReadinessTitleEl.textContent = 'Bustabit is not ready';
    redbotReadinessMessageEl.textContent = 'Wait for the embedded Bustabit page to finish loading.';
  } else if (!signedIn) {
    redbotReadinessTitleEl.textContent = 'Sign in to Bustabit';
    redbotReadinessMessageEl.textContent = 'Redbot automation requires an authenticated Bustabit chat session.';
  } else if (!probe.redbotSelected) {
    redbotReadinessTitleEl.textContent = 'Select the Redbot conversation';
    redbotReadinessMessageEl.textContent = probe.redbotTabAvailable
      ? 'Open the Redbot tab so @Redbot becomes the active channel.'
      : 'Add or open Redbot as a private conversation, then select it.';
  } else {
    redbotReadinessTitleEl.textContent = 'Open the Redbot chat view';
    redbotReadinessMessageEl.textContent = 'Leave History, Players, Channels, or other chat panels and return to the message view.';
  }

  redbotReadinessListEl.replaceChildren(...steps.map((step) => {
    const item = document.createElement('li');
    item.classList.toggle('ready', step.ready);
    item.textContent = step.text;
    return item;
  }));
  redbotReadinessDialogEl.showModal();
}

function showRedbotBalanceError(probe: RedbotChatProbe, error: unknown) {
  showRedbotReadinessDialog(probe);
  redbotReadinessTitleEl.textContent = 'Could not verify the Redbot balance';
  redbotReadinessMessageEl.textContent = getErrorMessage(error);
  const item = document.createElement('li');
  item.textContent = 'Redbot returned a fresh, parseable balance response.';
  redbotReadinessListEl.append(item);
  redbotReadinessWarningEl.textContent = '$bal was sent, but no wager was sent and the script remains disabled.';
}

const REDBOT_COMMAND_PATTERN = /^\$(?:(?:bet\s+(?:max|\d+(?:\.\d+)?)|(?:o|one|lo|low|ut|safe)\s+\d+(?:\.\d+)?|spin\s+\d+(?:\.\d+)?(?:\s+\d+t)?|withdraw\s+\d+(?:\.\d+)?)|(?:help|stop|balance|bal|monthly|race|pos|level|drop|eligible|blacklist|showbalanceafterbet|hidebalanceafterbet|enableshortcuts|disableshortcuts))$/i;

function normalizeRedbotCommand(command: string) {
  if (typeof command !== 'string') throw new Error('redbot.send requires a command string');
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!REDBOT_COMMAND_PATTERN.test(normalized)) {
    throw new Error('redbot.send only accepts documented Redbot commands');
  }
  return normalized;
}

function formatBits(bits: number) {
  if (!Number.isFinite(bits) || bits <= 0 || !Number.isSafeInteger(bits) && !/^\d+\.\d+$/.test(String(bits))) {
    throw new Error('Redbot bit amounts must be positive finite numbers');
  }
  const formatted = String(bits);
  if (!/^\d+(?:\.\d+)?$/.test(formatted)) {
    throw new Error('Redbot bit amounts must use ordinary decimal notation');
  }
  return formatted;
}

async function sendRedbotCommand(command: string) {
  const normalized = normalizeRedbotCommand(command);
  if (!webviewReady) throw new Error('The Bustabit webview is not ready');

  const result = await webview.executeJavaScript(`
    (function () {
      var targetChannel = ${JSON.stringify(REDBOT_CHANNEL)};
      var command = ${JSON.stringify(normalized)};
      var activeChannel = localStorage.getItem('active_channel') || '';
      if (activeChannel.toLowerCase() !== targetChannel.toLowerCase()) {
        return { ok: false, error: 'Select the private Redbot conversation first' };
      }

      var input = document.querySelector('input[name="message-input"]');
      if (!input || !input.getBoundingClientRect) {
        return { ok: false, error: 'Open the Redbot chat view first' };
      }
      var style = window.getComputedStyle(input);
      var rect = input.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) {
        return { ok: false, error: 'The Redbot message input is not visible' };
      }

      var valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      valueSetter.call(input, command);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
      return { ok: true };
    })();
  `) as { ok: boolean; error?: string };

  if (!result.ok) throw new Error(result.error ?? 'Could not send the Redbot command');
}

function createRedbotApi(round: StoredGame, script: AutomationScript): RedbotApi {
  const send = async (command: string) => {
    const stillEnabled = automation.redbotScripts.some(
      (item) => item.id === script.id && item.enabled,
    );
    if (!stillEnabled) throw new Error('The Redbot script was disabled before sending');
    await sendRedbotCommand(command);
    await window.electronAPI.trackRedbotAutomationCommand({
      scriptId: script.id,
      scriptName: script.name,
      triggerRoundId: round.id,
      command,
    });
    logRenderer('info', 'redbot', 'Redbot command sent', {
      roundId: round.id,
      commandName: command.trim().split(/\s+/)[0],
    });
  };

  return {
    send,
    bet: (bits) => send(`$bet ${bits === 'max' ? 'max' : formatBits(bits)}`),
    one: (bits) => send(`$one ${formatBits(bits)}`),
    low: (bits) => send(`$low ${formatBits(bits)}`),
    underTen: (bits) => send(`$ut ${formatBits(bits)}`),
    safe: (bits) => send(`$safe ${formatBits(bits)}`),
    spin: (bits, times = 1) => {
      if (!Number.isSafeInteger(times) || times <= 0) {
        throw new Error('redbot.spin times must be a positive integer');
      }
      return send(`$spin ${formatBits(bits)}${times === 1 ? '' : ` ${times}t`}`);
    },
    stop: () => send('$stop'),
    balance: () => send('$balance'),
    withdraw: (bits) => send(`$withdraw ${formatBits(bits)}`),
  };
}

async function initialize() {
  setDeveloperMode(developerMode);
  logRenderer('info', 'app', 'Renderer initialization started');
  if (!window.electronAPI) {
    throw new Error('Electron preload bridge is unavailable. Fully restart the application.');
  }
  const [storedGames, settings, redbotActivity] = await Promise.all([
    window.electronAPI.getRecentGames(),
    window.electronAPI.getAutomationSettings(),
    window.electronAPI.getRedbotBets(0, REDBOT_ACTIVITY_PAGE_SIZE),
  ]);
  games.push(...storedGames.slice(0, MAX_GAMES_IN_MEMORY));
  automation = settings;
  botTokenEl.value = settings.botToken;
  chatIdEl.value = settings.chatId;
  setAutomationStatus();
  renderAutomationScripts();
  renderRedbotScripts();
  renderRedbotBets(redbotActivity);
  renderGames();
  logRenderer('info', 'app', 'Renderer initialization completed', {
    recentRoundsLoaded: games.length,
    enabledScriptCount: settings.scripts.filter((script) => script.enabled).length,
    enabledRedbotScriptCount: settings.redbotScripts.filter((script) => script.enabled).length,
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
  redbotBalanceVerifiedAt = null;
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

addRedbotScriptEl.addEventListener('click', () => openRedbotScriptDialog());

closeRedbotScriptDialogEl.addEventListener('click', () => redbotScriptDialogEl.close());
closeRedbotReadinessDialogEl.addEventListener('click', () => redbotReadinessDialogEl.close());

redbotScriptFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = redbotScriptNameEl.value.trim();
  const code = redbotScriptCodeEl.value;
  if (!name || !code.trim()) {
    setRedbotScriptResult('Enter both a name and script code.', true);
    return;
  }

  const previousAutomation = automation;
  try {
    new RedbotAsyncFunction('round', 'recentRounds', 'redbot', 'getHistory', code);
    const existing = automation.redbotScripts.find(
      (script) => script.id === editingRedbotScriptId,
    );
    const script: AutomationScript = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      code,
      enabled: existing?.enabled ?? false,
    };
    automation = {
      ...automation,
      redbotScripts: existing
        ? automation.redbotScripts.map((item) => item.id === script.id ? script : item)
        : [...automation.redbotScripts, script],
    };
    await saveAutomationSettings();
    renderRedbotScripts();
    redbotScriptDialogEl.close();
    logRenderer('info', 'redbot', existing ? 'Redbot script updated' : 'Redbot script added', {
      scriptId: script.id,
      scriptName: script.name,
      scriptCharacters: script.code.length,
    });
  } catch (error) {
    automation = previousAutomation;
    setRedbotScriptResult(`Script error: ${getErrorMessage(error)}`, true);
  }
});

copyRedbotPromptEl.addEventListener('click', () => {
  window.electronAPI.copyText(REDBOT_CHATBOT_PROMPT);
  setRedbotScriptResult('Redbot chatbot prompt copied.');
  logRenderer('info', 'clipboard', 'Redbot chatbot prompt copied');
});

redbotScriptsEl.addEventListener('change', async (event) => {
  const toggle = event.target as HTMLInputElement;
  if (!toggle.matches('input[data-redbot-script-id]')) return;
  const script = automation.redbotScripts.find(
    (item) => item.id === toggle.dataset.redbotScriptId,
  );
  if (!script) return;

  const previousEnabled = script.enabled;
  if (toggle.checked) {
    const probe = await getRedbotProbe();
    await refreshExplorerValue();
    if (!redbotReady(probe)) {
      toggle.checked = false;
      showRedbotReadinessDialog(probe);
      return;
    }
    toggle.disabled = true;
    try {
      await verifyRedbotBalance();
    } catch (error) {
      toggle.checked = false;
      showRedbotBalanceError(probe, error);
      return;
    } finally {
      toggle.disabled = false;
    }
  }

  script.enabled = toggle.checked;
  try {
    await saveAutomationSettings();
    renderRedbotScripts();
    logRenderer('info', 'redbot', script.enabled ? 'Redbot script enabled' : 'Redbot script disabled', {
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    script.enabled = previousEnabled;
    renderRedbotScripts();
    setRedbotScriptResult(`Could not update Redbot script: ${getErrorMessage(error)}`, true);
  }
});

redbotScriptsEl.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-redbot-action]');
  if (!button) return;
  const script = automation.redbotScripts.find(
    (item) => item.id === button.dataset.redbotScriptId,
  );
  if (!script) return;

  if (button.dataset.redbotAction === 'edit') {
    openRedbotScriptDialog(script);
    return;
  }
  if (button.dataset.redbotAction !== 'delete' || !window.confirm(`Delete “${script.name}”?`)) return;

  const previousScripts = automation.redbotScripts;
  automation = {
    ...automation,
    redbotScripts: automation.redbotScripts.filter((item) => item.id !== script.id),
  };
  redbotScriptRunResults.delete(script.id);
  try {
    await saveAutomationSettings();
    renderRedbotScripts();
    logRenderer('info', 'redbot', 'Redbot script deleted', {
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    automation = { ...automation, redbotScripts: previousScripts };
    renderRedbotScripts();
    setRedbotScriptResult(`Could not delete Redbot script: ${getErrorMessage(error)}`, true);
  }
});

redbotActivityFirstEl.addEventListener('click', async () => {
  redbotActivityOffset = 0;
  await refreshRedbotBets();
});

redbotActivityPreviousEl.addEventListener('click', async () => {
  redbotActivityOffset = Math.max(0, redbotActivityOffset - REDBOT_ACTIVITY_PAGE_SIZE);
  await refreshRedbotBets();
});

redbotActivityNextEl.addEventListener('click', async () => {
  if (redbotActivityOffset + REDBOT_ACTIVITY_PAGE_SIZE >= redbotActivityTotal) return;
  redbotActivityOffset += REDBOT_ACTIVITY_PAGE_SIZE;
  await refreshRedbotBets();
});

redbotActivityLastEl.addEventListener('click', async () => {
  const lastPageIndex = Math.max(0, Math.ceil(redbotActivityTotal / REDBOT_ACTIVITY_PAGE_SIZE) - 1);
  redbotActivityOffset = lastPageIndex * REDBOT_ACTIVITY_PAGE_SIZE;
  await refreshRedbotBets();
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
  setRedbotAutomationStatus();
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

function openRedbotScriptDialog(script?: AutomationScript) {
  editingRedbotScriptId = script?.id ?? null;
  redbotScriptDialogTitleEl.textContent = script ? 'Edit Redbot script' : 'Add Redbot script';
  redbotScriptNameEl.value = script?.name ?? '';
  redbotScriptCodeEl.value = script?.code ?? '';
  setRedbotScriptResult('');
  redbotScriptDialogEl.showModal();
  redbotScriptNameEl.focus();
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
addButtonIcon(addRedbotScriptEl, 'M12 4.5v15m7.5-7.5h-15');
addButtonIcon(copyPromptEl, 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V10.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 7.5h3.375c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V9.75m7.5 7.5h-6.375A1.125 1.125 0 0 1 8.25 16.125V9.75');
addButtonIcon(copyRedbotPromptEl, 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V10.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 7.5h3.375c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V9.75m7.5 7.5h-6.375A1.125 1.125 0 0 1 8.25 16.125V9.75');
addButtonIcon(closeScriptDialogEl, 'M6 18 18 6M6 6l12 12');
addButtonIcon(closeRedbotScriptDialogEl, 'M6 18 18 6M6 6l12 12');
addButtonIcon(refreshLogsEl, 'M16.023 9.348h4.992V4.356m-1.291 9.768a8.25 8.25 0 1 1-2.23-8.362L21.015 9.348');
addButtonIcon(copyLogsEl, 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V10.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 7.5h3.375c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V9.75m7.5 7.5h-6.375A1.125 1.125 0 0 1 8.25 16.125V9.75');
addButtonIcon(openLogFolderEl, 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-5.25a2.25 2.25 0 0 0-2.25-2.25H4.5a2.25 2.25 0 0 0-2.25 2.25Z');
addButtonIcon(redbotActivityFirstEl, 'm18.75 4.5-7.5 7.5 7.5 7.5M11.25 4.5 3.75 12l7.5 7.5');
addButtonIcon(redbotActivityPreviousEl, 'm15.75 19.5-7.5-7.5 7.5-7.5');
addButtonIcon(redbotActivityNextEl, 'm8.25 4.5 7.5 7.5-7.5 7.5');
addButtonIcon(redbotActivityLastEl, 'm5.25 4.5 7.5 7.5-7.5 7.5m7.5-15 7.5 7.5-7.5 7.5');

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

function renderRedbotScripts() {
  setRedbotAutomationStatus();
  if (automation.redbotScripts.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'script-empty';
    cell.textContent = 'No Redbot scripts yet. Add a strategy, then enable it when Redbot is ready.';
    row.append(cell);
    redbotScriptsEl.replaceChildren(row);
    return;
  }

  redbotScriptsEl.replaceChildren(...automation.redbotScripts.map((script) => {
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
    const lastRun = redbotScriptRunResults.get(script.id);

    name.textContent = script.name;
    name.className = 'script-name';
    result.textContent = lastRun?.message ?? 'Not run yet';
    result.className = `script-run-result${lastRun?.error ? ' error' : ''}`;
    toggle.type = 'checkbox';
    toggle.checked = script.enabled;
    toggle.dataset.redbotScriptId = script.id;
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
    edit.dataset.redbotAction = 'edit';
    edit.dataset.redbotScriptId = script.id;

    remove.type = 'button';
    remove.className = 'destructive compact';
    remove.append(
      createHeroIcon(
        'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.92 21H8.08a2.25 2.25 0 0 1-2.24-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
      ),
      document.createTextNode('Delete'),
    );
    remove.dataset.redbotAction = 'delete';
    remove.dataset.redbotScriptId = script.id;
    actions.className = 'script-actions';
    actions.append(edit, remove);
    row.append(name, result, enabled, actions);
    return row;
  }));
}

async function refreshRedbotBets() {
  const page = await window.electronAPI.getRedbotBets(
    redbotActivityOffset,
    REDBOT_ACTIVITY_PAGE_SIZE,
  );
  renderRedbotBets(page);
}

function renderRedbotBets(page: RedbotBetPage) {
  redbotActivityTotal = page.total;
  if (page.balanceBits == null) {
    redbotBalanceEl.textContent = 'Not captured yet';
    const command = document.createElement('code');
    command.textContent = '$bal';
    redbotBalanceUpdatedEl.replaceChildren('Send ', command, ' in the Redbot chat to capture it.');
  } else {
    redbotBalanceEl.textContent = `${page.balanceBits.toLocaleString(undefined, {
      maximumFractionDigits: 8,
    })} bits`;
    redbotBalanceUpdatedEl.textContent = page.balanceUpdatedAt
      ? `Verified ${new Date(page.balanceUpdatedAt).toLocaleString()} · updated from confirmed results`
      : 'Updated from confirmed Redbot results';
  }

  const totalPages = Math.max(1, Math.ceil(page.total / REDBOT_ACTIVITY_PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.floor(redbotActivityOffset / REDBOT_ACTIVITY_PAGE_SIZE) + 1);
  redbotActivityPageEl.textContent = `Page ${currentPage} of ${totalPages}`;
  const firstPage = redbotActivityOffset === 0;
  const lastPage = redbotActivityOffset + REDBOT_ACTIVITY_PAGE_SIZE >= page.total;
  redbotActivityFirstEl.disabled = firstPage;
  redbotActivityPreviousEl.disabled = firstPage;
  redbotActivityNextEl.disabled = lastPage;
  redbotActivityLastEl.disabled = lastPage;

  if (page.items.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'script-empty';
    cell.textContent = 'No completed Redbot bets captured yet.';
    row.append(cell);
    redbotActivityEl.replaceChildren(row);
    return;
  }

  const labels: Record<RedbotBetRecord['outcome'], string> = {
    won: 'Bet won',
    lost: 'Bet lost',
  };
  redbotActivityEl.replaceChildren(...page.items.map((bet) => {
    const row = document.createElement('tr');
    const outcome = document.createElement('td');
    const details = document.createElement('td');
    const amount = document.createElement('td');
    const balance = document.createElement('td');

    outcome.textContent = labels[bet.outcome];
    outcome.className = `activity-kind ${bet.outcome}`;
    const detailText = `${bet.scriptName} · after round ${bet.triggerRoundId.toLocaleString()} · ${bet.details}`;
    details.textContent = detailText;
    details.title = detailText;
    details.className = 'activity-details';
    amount.textContent = `${bet.netBits >= 0 ? '+' : '−'}${Math.abs(bet.netBits).toLocaleString(undefined, {
      maximumFractionDigits: 8,
    })} bits`;
    amount.className = `activity-amount ${bet.outcome}`;
    balance.textContent = bet.balanceAfterBits == null
      ? '—'
      : `${bet.balanceAfterBits.toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} bits`;
    balance.className = 'activity-amount';
    row.append(outcome, details, amount, balance);
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
  const enabledRedbotScripts = automation.redbotScripts.filter((script) => script.enabled);
  await Promise.all([
    Promise.all(enabledScripts.map((script) => runAutomation(script, storedGame))),
    runRedbotAutomations(enabledRedbotScripts, storedGame),
  ]);
}

async function runRedbotAutomations(scripts: AutomationScript[], round: StoredGame) {
  if (scripts.length > 0 && !redbotBalanceVerifiedAt) {
    try {
      await verifyRedbotBalance();
    } catch (error) {
      for (const script of scripts) {
        redbotScriptRunResults.set(script.id, {
          message: `Round ${round.id}: balance check failed`,
          error: true,
        });
      }
      renderRedbotScripts();
      logRenderer('error', 'redbot', 'Redbot scripts skipped because balance verification failed', {
        roundId: round.id,
        error: errorDetails(error),
      });
      return;
    }
  }
  for (const script of scripts) await runRedbotAutomation(script, round);
}

async function runRedbotAutomation(script: AutomationScript, round: StoredGame) {
  try {
    const execute = new RedbotAsyncFunction(
      'round',
      'recentRounds',
      'redbot',
      'getHistory',
      script.code,
    );
    await execute(
      round,
      games.map((game) => ({ ...game })),
      createRedbotApi(round, script),
      window.electronAPI.getGameHistory,
    );
    redbotScriptRunResults.set(script.id, {
      message: `Succeeded for round ${round.id}`,
      error: false,
    });
    logRenderer('info', 'redbot', 'Redbot round script completed', {
      roundId: round.id,
      scriptId: script.id,
      scriptName: script.name,
    });
  } catch (error) {
    redbotScriptRunResults.set(script.id, {
      message: `Round ${round.id}: ${getErrorMessage(error)}`,
      error: true,
    });
    logRenderer('error', 'redbot', 'Redbot round script failed', {
      roundId: round.id,
      scriptId: script.id,
      scriptName: script.name,
      error: errorDetails(error),
    });
  } finally {
    renderRedbotScripts();
  }
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
