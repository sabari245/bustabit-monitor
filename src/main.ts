import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  shell,
} from 'electron';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type {
  AutomationScript,
  AutomationSettings,
  GameData,
  RedbotActivity,
  RedbotAutomationCommand,
  RedbotBetPage,
  RedbotBetRecord,
  RedbotChatMessage,
  StoredGame,
  TelegramResult,
} from './types';
import {
  getLogPath,
  initializeLogger,
  log,
  type LogLevel,
  readRecentLogs,
} from './logger';
import {
  bustMultiplier,
  CLASSIC_START_HASH,
  CLASSIC_START_ID,
  previousHash,
} from './bustabit-chain';

nativeTheme.themeSource = 'dark';

const MAX_RECENT_GAMES = 100;
const DEFAULT_AUTOMATION_SCRIPTS: AutomationScript[] = [
  {
    id: 'default-10x-alert',
    name: '10x multiplier alert',
    code: [
      'if (round.bust >= 10) {',
      '  await sendMessage(`🚨 Round ${round.id} reached ${round.bust.toFixed(2)}x`);',
      '}',
    ].join('\n'),
    enabled: false,
  },
  {
    id: 'default-low-streak-alert',
    name: 'Five rounds below 2x',
    code: [
      'const window = recentRounds.slice(0, 5);',
      'if (window.length === 5 && window.every((item) => item.bust < 2)) {',
      '  await sendMessage(`Five consecutive rounds below 2x. Latest: ${round.bust.toFixed(2)}x`);',
      '}',
    ].join('\n'),
    enabled: false,
  },
  {
    id: 'default-average-spike-alert',
    name: '3x average spike',
    code: [
      'const previous = recentRounds.slice(1, 21);',
      'if (previous.length === 20) {',
      '  const average = previous.reduce((sum, item) => sum + item.bust, 0) / previous.length;',
      '  if (round.bust >= average * 3) {',
      '    await sendMessage(`Round ${round.id}: ${round.bust.toFixed(2)}x versus previous average ${average.toFixed(2)}x`);',
      '  }',
      '}',
    ].join('\n'),
    enabled: false,
  },
];
const DEFAULT_REDBOT_SCRIPTS: AutomationScript[] = [
  {
    id: 'default-redbot-flat-bet',
    name: 'Flat bet · 1 bit',
    code: [
      '// Demo: wager the same small amount after every completed round.',
      'const betBits = 1;',
      'await redbot.bet(betBits);',
    ].join('\n'),
    enabled: false,
  },
  {
    id: 'default-redbot-capped-martingale',
    name: 'Capped Martingale · 1–16 bits',
    code: [
      '// Demo: double after each consecutive 1.98x+ result, then stop after five losses.',
      '// Because progression is derived from history, enabling during a losing streak',
      '// starts at that streak\'s current level. Review the calculated cap before enabling.',
      'const baseBet = 1;',
      'const maxDoublings = 4;',
      'let consecutiveLosses = 0;',
      '',
      'for (const game of recentRounds) {',
      '  if (game.bust < 1.98) break;',
      '  consecutiveLosses += 1;',
      '}',
      '',
      'if (consecutiveLosses <= maxDoublings) {',
      '  const betBits = baseBet * (2 ** consecutiveLosses);',
      '  await redbot.bet(betBits);',
      '}',
    ].join('\n'),
    enabled: false,
  },
  {
    id: 'default-redbot-five-red-entry',
    name: 'Five-red streak · 1 bit',
    code: [
      '// Demo: place one flat bet only after five consecutive results below 1.98x.',
      'const streak = recentRounds.slice(0, 5);',
      'if (streak.length === 5 && streak.every((game) => game.bust < 1.98)) {',
      '  await redbot.bet(1);',
      '}',
    ].join('\n'),
    enabled: false,
  },
];
let recentGames: StoredGame[] = [];
let dataDirectory = '';
let historyPath = '';
let recentPath = '';
let settingsPath = '';
let redbotActivityPath = '';
let redbotAutomationBetsPath = '';
let redbotActivities: RedbotActivity[] = [];
let redbotBets: RedbotBetRecord[] = [];
const redbotActivitySourceKeys = new Set<string>();
let redbotBalanceBits: number | null = null;
let redbotBalanceUpdatedAt: string | null = null;

type TrackedRedbotBet = {
  id: string;
  scriptId: string;
  scriptName: string;
  triggerRoundId: number;
  command: string;
  target: string;
  expectedWagerBits: number | null;
  wagerBits: number | null;
  status: 'dispatched' | 'accepted' | 'won' | 'lost';
  confirmation: string | null;
  result: string | null;
  netBits: number | null;
  balanceAfterBits: number | null;
  createdAt: string;
};

type RedbotOutcomeQueueEntry = {
  trackedBetId: string | null;
  wagerBits: number;
};

type RedbotAutomationBetState = {
  bets: TrackedRedbotBet[];
  outcomeQueue: RedbotOutcomeQueueEntry[];
  balanceBits: number | null;
  balanceUpdatedAt: string | null;
};

let trackedRedbotBets: TrackedRedbotBet[] = [];
let redbotOutcomeQueue: RedbotOutcomeQueueEntry[] = [];

const webviewPreloadPath = pathToFileURL(
  path.join(__dirname, 'webview-preload.js'),
).href;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    if (fs.existsSync(filePath)) log('warn', 'storage', 'JSON file could not be read', {
      filePath,
      error: getErrorMessage(error),
    });
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function initializeStorage() {
  dataDirectory = path.join(app.getPath('userData'), 'data');
  historyPath = path.join(dataDirectory, 'rounds.jsonl');
  recentPath = path.join(dataDirectory, 'recent-rounds.json');
  settingsPath = path.join(dataDirectory, 'automation.json');
  redbotActivityPath = path.join(dataDirectory, 'redbot-activity.jsonl');
  redbotAutomationBetsPath = path.join(dataDirectory, 'redbot-automation-bets.json');
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (historyStartsAtClassicFloor()) {
    recentGames = readHistoryPage(0, MAX_RECENT_GAMES);
    writeJson(recentPath, recentGames);
  } else {
    log('warn', 'storage', 'Complete classic history is unavailable; rebuilding from live data');
    recentGames = [];
  }
  loadRedbotActivity();
  loadRedbotAutomationBets();
  log('info', 'storage', 'Storage initialized', {
    dataDirectory,
    historyPath,
    recentRoundsLoaded: recentGames.length,
    redbotActivityCount: redbotActivities.length,
    redbotAutomationBetCount: redbotBets.length,
  });
}

function historyStartsAtClassicFloor() {
  if (!fs.existsSync(historyPath)) return false;

  try {
    const file = fs.openSync(historyPath, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(file, buffer, 0, buffer.length, 0);
    fs.closeSync(file);
    const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
    const firstGame = JSON.parse(firstLine) as StoredGame;
    return firstGame.id === CLASSIC_START_ID && firstGame.hash === CLASSIC_START_HASH;
  } catch (error) {
    log('warn', 'storage', 'Could not verify the start of round history', error);
    return false;
  }
}

function emitBackfillProgress(processed: number, total: number, currentId: number) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('backfill:progress', { processed, total, currentId });
  }
}

async function backfillAndStore(game: GameData): Promise<StoredGame | null> {
  if (
    typeof game?.hash !== 'string' ||
    !/^[0-9a-fA-F]{64}$/.test(game.hash) ||
    typeof game.id !== 'number' ||
    !Number.isSafeInteger(game.id) ||
    typeof game.bust !== 'number' ||
    !Number.isFinite(game.bust)
  ) {
    log('warn', 'games', 'Invalid round rejected', {
      id: game?.id,
      bust: game?.bust,
      hashType: typeof game?.hash,
    });
    return null;
  }

  const normalizedHash = game.hash.toLowerCase();
  const existing = recentGames.find((item) => item.hash === normalizedHash);
  if (existing) {
    log('debug', 'games', 'Duplicate round ignored', { id: game.id });
    return null;
  }

  const newestStored = recentGames[0];
  if (newestStored && game.id <= newestStored.id) {
    log('warn', 'games', 'Out-of-order round ignored', {
      receivedId: game.id,
      newestStoredId: newestStored.id,
    });
    return null;
  }

  if (game.id < CLASSIC_START_ID) {
    throw new Error(`Game ${game.id} predates the supported classic hash chain.`);
  }

  const targetId = newestStored ? newestStored.id + 1 : CLASSIC_START_ID;
  const total = game.id - targetId + 1;
  const temporaryPath = path.join(dataDirectory, `backfill-${process.pid}.jsonl.tmp`);
  const temporaryFile = fs.openSync(temporaryPath, 'w');
  const recentBackfill: StoredGame[] = [];
  const receivedAt = new Date().toISOString();
  let hash = normalizedHash;
  let processed = 0;
  let generationError: unknown;

  log('info', 'backfill', 'Hash-chain backfill started', {
    fromId: game.id,
    toId: targetId,
    rounds: total,
    fullClassicBackfill: !newestStored,
  });
  emitBackfillProgress(0, total, game.id);

  try {
    for (let batchStart = game.id; batchStart >= targetId; batchStart -= 2500) {
      const batchEnd = Math.max(targetId, batchStart - 2499);
      let output = '';
      for (let id = batchStart; id >= batchEnd; id -= 1) {
        const storedGame: StoredGame = {
          id,
          hash,
          bust: id === game.id ? game.bust : bustMultiplier(hash),
          receivedAt,
          reconstructed: id !== game.id,
        };
        if (recentBackfill.length < MAX_RECENT_GAMES) recentBackfill.push(storedGame);
        output += `${JSON.stringify(storedGame)}\n`;
        processed += 1;
        if (id > targetId) hash = previousHash(hash);
      }
      fs.writeSync(temporaryFile, output);
      emitBackfillProgress(processed, total, batchEnd);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } catch (error) {
    generationError = error;
  } finally {
    fs.closeSync(temporaryFile);
  }
  if (generationError) {
    fs.unlinkSync(temporaryPath);
    throw generationError;
  }

  const oldestGenerated = recentBackfill.length === total
    ? recentBackfill[recentBackfill.length - 1]
    : {
        id: targetId,
        hash,
        bust: bustMultiplier(hash),
        receivedAt,
        reconstructed: targetId !== game.id,
      };
  if (!newestStored && oldestGenerated.hash !== CLASSIC_START_HASH) {
    fs.unlinkSync(temporaryPath);
    throw new Error(`Hash chain did not reach the classic floor at game ${CLASSIC_START_ID}.`);
  }
  if (newestStored && previousHash(oldestGenerated.hash) !== newestStored.hash) {
    fs.unlinkSync(temporaryPath);
    throw new Error(
      `Hash chain does not connect game ${targetId} to stored game ${newestStored.id}.`,
    );
  }

  try {
    if (newestStored) {
      appendFileInReverse(temporaryPath, historyPath, false);
    } else {
      const rebuiltHistoryPath = `${historyPath}.rebuild.tmp`;
      appendFileInReverse(temporaryPath, rebuiltHistoryPath, true);
      fs.renameSync(rebuiltHistoryPath, historyPath);
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  recentGames = [...recentBackfill, ...recentGames].slice(0, MAX_RECENT_GAMES);
  writeJson(recentPath, recentGames);
  emitBackfillProgress(total, total, targetId);
  log('info', 'backfill', 'Hash-chain backfill completed', {
    fromId: game.id,
    toId: targetId,
    roundsStored: total,
  });
  return recentGames[0];
}

function appendFileInReverse(
  sourcePath: string,
  destinationPath: string,
  replace: boolean,
) {
  const source = fs.openSync(sourcePath, 'r');
  const destination = fs.openSync(destinationPath, replace ? 'w' : 'a');
  const chunkSize = 256 * 1024;
  let position = fs.fstatSync(source).size;
  let remainder = '';

  try {
    while (position > 0) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      fs.readSync(source, buffer, 0, bytesToRead, position);
      const lines = `${buffer.toString('utf8')}${remainder}`.split('\n');
      remainder = position > 0 ? lines.shift() ?? '' : '';
      const output: string[] = [];
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index]) output.push(lines[index]);
      }
      if (output.length > 0) fs.writeSync(destination, `${output.join('\n')}\n`);
    }
  } finally {
    fs.closeSync(source);
    fs.closeSync(destination);
  }
}

function getAutomationSettings(): AutomationSettings {
  const settings = readJson<Partial<AutomationSettings> & {
    script?: unknown;
    active?: unknown;
  }>(settingsPath, {});
  const scripts = Array.isArray(settings.scripts)
    ? settings.scripts.filter(
        (script) =>
          script &&
          typeof script.id === 'string' &&
          typeof script.name === 'string' &&
          typeof script.code === 'string' &&
          typeof script.enabled === 'boolean',
      )
    : typeof settings.script === 'string' && settings.script
      ? [
          {
            id: 'migrated-script',
            name: 'My automation',
            code: settings.script,
            enabled: settings.active === true,
          },
          ...DEFAULT_AUTOMATION_SCRIPTS.map((script) => ({ ...script })),
        ]
      : DEFAULT_AUTOMATION_SCRIPTS.map((script) => ({ ...script }));
  const storedRedbotScripts = Array.isArray(settings.redbotScripts)
    ? settings.redbotScripts.filter(
        (script) =>
          script &&
          typeof script.id === 'string' &&
          typeof script.name === 'string' &&
          typeof script.code === 'string' &&
          typeof script.enabled === 'boolean',
      )
    : [];
  const redbotDefaultsVersion = typeof settings.redbotDefaultsVersion === 'number'
    ? settings.redbotDefaultsVersion
    : 0;
  const redbotScripts = redbotDefaultsVersion >= 1
    ? storedRedbotScripts
    : [
        ...storedRedbotScripts,
        ...DEFAULT_REDBOT_SCRIPTS
          .filter((script) => !storedRedbotScripts.some((stored) => stored.id === script.id))
          .map((script) => ({ ...script })),
      ];
  return {
    botToken: typeof settings.botToken === 'string' ? settings.botToken : '',
    chatId: typeof settings.chatId === 'string' ? settings.chatId : '',
    scripts,
    redbotScripts,
    redbotDefaultsVersion: 1,
  };
}

function loadRedbotActivity() {
  redbotActivities = [];
  redbotBets = [];
  redbotActivitySourceKeys.clear();
  redbotBalanceBits = null;
  redbotBalanceUpdatedAt = null;
  if (!fs.existsSync(redbotActivityPath)) return;

  const lines = fs.readFileSync(redbotActivityPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const activity = JSON.parse(line) as RedbotActivity;
      if (
        !activity ||
        typeof activity.id !== 'string' ||
        typeof activity.sourceKey !== 'string' ||
        !['balance', 'bet', 'win', 'loss'].includes(activity.kind) ||
        typeof activity.message !== 'string' ||
        typeof activity.recordedAt !== 'string'
      ) {
        continue;
      }
      redbotActivities.push(activity);
      redbotActivitySourceKeys.add(activity.sourceKey);
      if (activity.kind === 'balance' && activity.balanceBits != null) {
        redbotBalanceBits = activity.balanceBits;
        redbotBalanceUpdatedAt = activity.recordedAt;
      }
    } catch (error) {
      log('warn', 'redbot', 'Ignored an invalid Redbot activity line', {
        error: getErrorMessage(error),
      });
    }
  }
  redbotActivities.reverse();
}

function refreshPublicRedbotBets() {
  redbotBets = trackedRedbotBets
    .filter((bet) => bet.status === 'won' || bet.status === 'lost')
    .map((bet) => ({
      id: bet.id,
      outcome: bet.status as RedbotBetRecord['outcome'],
      scriptName: bet.scriptName,
      triggerRoundId: bet.triggerRoundId,
      details: [bet.target, bet.result].filter(Boolean).join(' · '),
      wagerBits: bet.wagerBits ?? 0,
      netBits: bet.netBits ?? 0,
      balanceAfterBits: bet.balanceAfterBits,
    }))
    .reverse();
}

function loadRedbotAutomationBets() {
  const state = readJson<Partial<RedbotAutomationBetState>>(redbotAutomationBetsPath, {});
  trackedRedbotBets = Array.isArray(state.bets)
    ? state.bets.filter(
        (bet) =>
          bet &&
          typeof bet.id === 'string' &&
          typeof bet.scriptId === 'string' &&
          typeof bet.scriptName === 'string' &&
          typeof bet.triggerRoundId === 'number' &&
          typeof bet.command === 'string' &&
          typeof bet.target === 'string' &&
          ['dispatched', 'accepted', 'won', 'lost'].includes(bet.status),
      )
    : [];
  redbotOutcomeQueue = Array.isArray(state.outcomeQueue)
    ? state.outcomeQueue.filter(
        (entry) =>
          entry &&
          (entry.trackedBetId === null || typeof entry.trackedBetId === 'string') &&
          typeof entry.wagerBits === 'number' &&
          Number.isFinite(entry.wagerBits),
      )
    : [];
  if (typeof state.balanceBits === 'number' && Number.isFinite(state.balanceBits)) {
    redbotBalanceBits = state.balanceBits;
  }
  if (typeof state.balanceUpdatedAt === 'string') {
    redbotBalanceUpdatedAt = state.balanceUpdatedAt;
  }
  refreshPublicRedbotBets();
}

function saveRedbotAutomationBets() {
  const state: RedbotAutomationBetState = {
    bets: trackedRedbotBets,
    outcomeQueue: redbotOutcomeQueue,
    balanceBits: redbotBalanceBits,
    balanceUpdatedAt: redbotBalanceUpdatedAt,
  };
  writeJson(redbotAutomationBetsPath, state);
}

function parseAutomationWager(command: string) {
  const normalized = command.trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^\$(bet|o|one|lo|low|ut|safe)\s+(max|\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const commandName = match[1].toLowerCase();
  const targets: Record<string, string> = {
    bet: 'Next game being red',
    o: 'Next game under 1.01x',
    one: 'Next game under 1.01x',
    lo: 'Next game under 1.2x',
    low: 'Next game under 1.2x',
    ut: 'Next game under 10x',
    safe: 'Next game under 28x',
  };
  return {
    target: targets[commandName],
    expectedWagerBits: match[2].toLowerCase() === 'max' ? null : parseBits(match[2]),
  };
}

function trackRedbotAutomationCommand(input: RedbotAutomationCommand) {
  if (
    !input ||
    typeof input.scriptId !== 'string' ||
    typeof input.scriptName !== 'string' ||
    !Number.isSafeInteger(input.triggerRoundId) ||
    typeof input.command !== 'string'
  ) {
    throw new Error('Invalid Redbot automation command metadata');
  }
  const wager = parseAutomationWager(input.command);
  if (!wager) return null;
  const trackedBet: TrackedRedbotBet = {
    id: randomUUID(),
    scriptId: input.scriptId,
    scriptName: input.scriptName.slice(0, 80),
    triggerRoundId: input.triggerRoundId,
    command: input.command,
    target: wager.target,
    expectedWagerBits: wager.expectedWagerBits,
    wagerBits: null,
    status: 'dispatched',
    confirmation: null,
    result: null,
    netBits: null,
    balanceAfterBits: null,
    createdAt: new Date().toISOString(),
  };
  trackedRedbotBets.push(trackedBet);
  saveRedbotAutomationBets();
  return trackedBet.id;
}

function discardRedbotAutomationCommand(trackingId: string) {
  if (typeof trackingId !== 'string' || !trackingId) {
    throw new Error('Invalid Redbot automation tracking ID');
  }
  const trackedBet = trackedRedbotBets.find(
    (bet) => bet.id === trackingId && bet.status === 'dispatched',
  );
  if (!trackedBet) return;

  trackedRedbotBets = trackedRedbotBets.filter((bet) => bet.id !== trackingId);
  redbotOutcomeQueue = redbotOutcomeQueue.filter(
    (entry) => entry.trackedBetId !== trackingId,
  );
  refreshPublicRedbotBets();
  saveRedbotAutomationBets();
}

function targetFromConfirmation(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('under 1.01x')) return 'Next game under 1.01x';
  if (lower.includes('under 1.2x')) return 'Next game under 1.2x';
  if (lower.includes('under 10x')) return 'Next game under 10x';
  if (lower.includes('under 28x')) return 'Next game under 28x';
  if (lower.includes('being red')) return 'Next game being red';
  return null;
}

function applyRedbotActivity(activity: RedbotActivity) {
  if (activity.kind === 'balance' && activity.balanceBits != null) {
    redbotBalanceBits = activity.balanceBits;
    redbotBalanceUpdatedAt = activity.recordedAt;
    return;
  }
  if (activity.kind === 'bet' && activity.amountBits != null) {
    const target = targetFromConfirmation(activity.message);
    const trackedBet = trackedRedbotBets.find(
      (bet) =>
        bet.status === 'dispatched' &&
        bet.target === target &&
        (bet.expectedWagerBits == null || bet.expectedWagerBits === activity.amountBits),
    );
    if (trackedBet) {
      trackedBet.status = 'accepted';
      trackedBet.wagerBits = activity.amountBits;
      trackedBet.confirmation = activity.message;
    }
    redbotOutcomeQueue.push({
      trackedBetId: trackedBet?.id ?? null,
      wagerBits: activity.amountBits,
    });
    return;
  }
  if ((activity.kind !== 'win' && activity.kind !== 'loss') || activity.amountBits == null) return;

  const pendingOutcome = redbotOutcomeQueue.shift();
  if (!pendingOutcome) return;
  const won = activity.kind === 'win';
  const netBits = won
    ? Math.round((activity.amountBits - pendingOutcome.wagerBits) * 1e8) / 1e8
    : -activity.amountBits;
  if (won && netBits < 0) {
    log('warn', 'redbot', 'Ignored an implausible winning result', {
      trackedBetId: pendingOutcome.trackedBetId,
      wagerBits: pendingOutcome.wagerBits,
      reportedWinBits: activity.amountBits,
    });
    return;
  }
  if (redbotBalanceBits != null) {
    redbotBalanceBits = Math.round((redbotBalanceBits + netBits) * 1e8) / 1e8;
  }
  if (!pendingOutcome.trackedBetId) return;
  const trackedBet = trackedRedbotBets.find((bet) => bet.id === pendingOutcome.trackedBetId);
  if (!trackedBet || trackedBet.status !== 'accepted') return;
  trackedBet.status = won ? 'won' : 'lost';
  trackedBet.result = activity.message
    .replace(/\s*You (?:won|lost) [\d,.]+ bits?!?\.?$/i, '')
    .replace(/[.!]+$/, '');
  trackedBet.netBits = netBits;
  trackedBet.balanceAfterBits = redbotBalanceBits;
}

function parseBits(value: string) {
  const bits = Number(value.replace(/,/g, ''));
  return Number.isFinite(bits) && bits >= 0 ? bits : null;
}

function parseRedbotChatMessage(input: RedbotChatMessage): RedbotActivity | null {
  const message = input.message.trim().replace(/\s+/g, ' ');
  let kind: RedbotActivity['kind'];
  let amountBits: number | null = null;
  let balanceBits: number | null = null;
  let match = message.match(/^Your balance is ([\d,.]+) bits?\.?$/i);

  if (match) {
    kind = 'balance';
    balanceBits = parseBits(match[1]);
    if (balanceBits == null) return null;
  } else {
    match = message.match(/^You have bet ([\d,.]+) bits?\b/i);
    if (match) {
      kind = 'bet';
      amountBits = parseBits(match[1]);
    } else {
      match = message.match(/^The game was .+?\. You won ([\d,.]+) bits?!?$/i);
      if (match) {
        kind = 'win';
        amountBits = parseBits(match[1]);
      } else {
        match = message.match(/^The game was .+?\. You lost ([\d,.]+) bits?\.?$/i);
        if (!match) return null;
        kind = 'loss';
        amountBits = parseBits(match[1]);
      }
    }
    if (amountBits == null) return null;
  }

  return {
    id: randomUUID(),
    sourceKey: input.sourceKey,
    kind,
    message,
    amountBits,
    balanceBits,
    chatTime: typeof input.chatTime === 'string' ? input.chatTime.slice(0, 20) : null,
    recordedAt: new Date().toISOString(),
  };
}

function storeRedbotChatMessages(messages: RedbotChatMessage[]) {
  let stored = 0;
  for (const input of messages.slice(0, 200)) {
    if (
      !input ||
      typeof input.sourceKey !== 'string' ||
      !input.sourceKey ||
      input.sourceKey.length > 600 ||
      typeof input.message !== 'string' ||
      input.message.length > 500 ||
      redbotActivitySourceKeys.has(input.sourceKey)
    ) {
      continue;
    }
    const activity = parseRedbotChatMessage(input);
    if (!activity) continue;

    fs.appendFileSync(redbotActivityPath, `${JSON.stringify(activity)}\n`);
    redbotActivities.unshift(activity);
    redbotActivitySourceKeys.add(activity.sourceKey);
    applyRedbotActivity(activity);
    stored += 1;
  }
  if (stored > 0) {
    refreshPublicRedbotBets();
    saveRedbotAutomationBets();
  }
  if (stored > 0) log('info', 'redbot', 'Redbot chat activity stored', {
    stored,
    total: redbotActivities.length,
    completedBets: redbotBets.length,
    balanceBits: redbotBalanceBits,
  });
  return stored;
}

function getRedbotBets(offset: number, limit: number): RedbotBetPage {
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 10));
  return {
    items: redbotBets.slice(safeOffset, safeOffset + safeLimit),
    total: redbotBets.length,
    balanceBits: redbotBalanceBits,
    balanceUpdatedAt: redbotBalanceUpdatedAt,
  };
}

function readHistoryPage(offset: number, limit: number): StoredGame[] {
  if (!fs.existsSync(historyPath)) {
    log('debug', 'history', 'History requested before history file exists');
    return [];
  }

  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit) || 100));
  const file = fs.openSync(historyPath, 'r');
  const fileSize = fs.fstatSync(file).size;
  const chunkSize = 64 * 1024;
  const games: StoredGame[] = [];
  let position = fileSize;
  let remainder = '';
  let skipped = 0;

  try {
    while (position > 0 && games.length < safeLimit) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      fs.readSync(file, buffer, 0, bytesToRead, position);
      const lines = `${buffer.toString('utf8')}${remainder}`.split('\n');
      remainder = position > 0 ? lines.shift() ?? '' : '';

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index]) continue;
        if (skipped < safeOffset) {
          skipped += 1;
          continue;
        }
        games.push(JSON.parse(lines[index]) as StoredGame);
        if (games.length === safeLimit) break;
      }
    }
  } finally {
    fs.closeSync(file);
  }

  log('debug', 'history', 'History page loaded', {
    offset: safeOffset,
    limit: safeLimit,
    returned: games.length,
  });
  return games;
}

function registerIpcHandlers() {
  ipcMain.handle('diagnostics:log', (_event, level, scope, message, details) => {
    const safeLevel: LogLevel = ['debug', 'info', 'warn', 'error'].includes(level)
      ? level
      : 'info';
    log(
      safeLevel,
      `renderer:${String(scope).slice(0, 80)}`,
      String(message).slice(0, 2000),
      details,
    );
  });
  ipcMain.on('preload:error', (_event, error) =>
    log('error', 'preload', 'Preload bridge exposure failed', error),
  );
  ipcMain.handle('diagnostics:copy', (_event, text) => {
    const safeText = typeof text === 'string' ? text : String(text);
    clipboard.writeText(safeText);
  });
  ipcMain.handle('diagnostics:get', () => ({
    path: getLogPath(),
    content: readRecentLogs(),
  }));
  ipcMain.handle('diagnostics:open-folder', () =>
    shell.openPath(path.dirname(getLogPath())),
  );
  ipcMain.handle('games:recent', () => {
    log('debug', 'games', 'Recent rounds requested', { count: recentGames.length });
    return recentGames;
  });
  ipcMain.handle('games:history', (_event, offset = 0, limit = 100) => {
    try {
      return readHistoryPage(Number(offset), Number(limit));
    } catch (error) {
      log('error', 'history', 'Could not read history page', error);
      throw new Error(`Could not read history: ${getErrorMessage(error)}`);
    }
  });
  ipcMain.handle('games:store', async (_event, game: GameData) => {
    log('debug', 'games', 'Round storage requested', {
      id: game?.id,
      bust: game?.bust,
      hash: typeof game?.hash === 'string' ? game.hash.slice(0, 12) : undefined,
    });
    try {
      return await backfillAndStore(game);
    } catch (error) {
      log('error', 'games', 'Could not persist round', {
        id: game.id,
        historyPath,
        recentPath,
        error: getErrorMessage(error),
      });
      throw new Error(`Storage error: ${getErrorMessage(error)}`);
    }
  });
  ipcMain.handle('redbot:activity:get', (_event, offset = 0, limit = 10) =>
    getRedbotBets(Number(offset), Number(limit)),
  );
  ipcMain.handle('redbot:activity:store', (_event, messages: RedbotChatMessage[]) => {
    try {
      return storeRedbotChatMessages(Array.isArray(messages) ? messages : []);
    } catch (error) {
      log('error', 'redbot', 'Could not store Redbot chat activity', error);
      throw new Error(`Could not store Redbot activity: ${getErrorMessage(error)}`);
    }
  });
  ipcMain.handle('redbot:command:track', (_event, command: RedbotAutomationCommand) => {
    try {
      return trackRedbotAutomationCommand(command);
    } catch (error) {
      log('error', 'redbot', 'Could not track Redbot automation command', error);
      throw new Error(`Could not track Redbot command: ${getErrorMessage(error)}`);
    }
  });
  ipcMain.handle('redbot:command:discard', (_event, trackingId: string) => {
    try {
      discardRedbotAutomationCommand(trackingId);
    } catch (error) {
      log('error', 'redbot', 'Could not discard Redbot automation command', error);
      throw new Error(`Could not discard Redbot command: ${getErrorMessage(error)}`);
    }
  });
  ipcMain.handle('automation:get', getAutomationSettings);
  ipcMain.handle(
    'automation:save',
    (_event, settings: AutomationSettings) => {
      try {
        writeJson(settingsPath, settings);
        log('info', 'automation', 'Automation settings saved', {
          scriptCount: settings.scripts.length,
          enabledScriptCount: settings.scripts.filter((script) => script.enabled).length,
          redbotScriptCount: settings.redbotScripts.length,
          enabledRedbotScriptCount: settings.redbotScripts.filter((script) => script.enabled).length,
          hasBotToken: Boolean(settings.botToken),
          hasChatId: Boolean(settings.chatId),
        });
      } catch (error) {
        log('error', 'automation', 'Could not save automation settings', error);
        throw new Error(`Could not save automation settings: ${getErrorMessage(error)}`);
      }
    },
  );
  ipcMain.handle(
    'telegram:send',
    async (
      _event,
      botToken: string,
      chatId: string,
      text: string,
    ): Promise<TelegramResult> => {
      if (!botToken.trim() || !chatId.trim() || !text.trim()) {
        log('warn', 'telegram', 'Message rejected because configuration is incomplete');
        return { ok: false, error: 'Bot token, chat ID, and message are required.' };
      }
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken.trim())) {
        log('warn', 'telegram', 'Message rejected because bot token format is invalid');
        return { ok: false, error: 'The Telegram bot token format is invalid.' };
      }

      try {
        log('info', 'telegram', 'Sending Telegram message', {
          chatIdSuffix: chatId.trim().slice(-4),
          messageCharacters: text.length,
        });
        const response = await net.fetch(
          `https://api.telegram.org/bot${botToken.trim()}/sendMessage`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId.trim(), text }),
          },
        );
        const result = (await response.json()) as {
          ok?: boolean;
          description?: string;
        };
        if (result.ok) {
          log('info', 'telegram', 'Telegram message sent');
          return { ok: true };
        }
        const error = result.description ?? 'Telegram rejected the message.';
        log('warn', 'telegram', 'Telegram rejected the message', {
          status: response.status,
          error,
        });
        return { ok: false, error };
      } catch (error) {
        log('error', 'telegram', 'Telegram request failed', error);
        return { ok: false, error: 'Could not reach Telegram.' };
      }
    },
  );
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
    },
  });

  Menu.setApplicationMenu(null);
  log('info', 'window', 'Main window created');

  mainWindow.webContents.on('did-finish-load', () =>
    log('info', 'window', 'Renderer finished loading'),
  );
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) =>
    log('error', 'window', 'Renderer failed to load', { code, description, url }),
  );
  mainWindow.webContents.on('render-process-gone', (_event, details) =>
    log('error', 'window', 'Renderer process exited', details),
  );
  mainWindow.webContents.on('console-message', (_event, details) =>
    log(
      details.level === 'error'
        ? 'error'
        : details.level === 'warning'
          ? 'warn'
          : 'debug',
      'renderer-console',
      details.message,
      { lineNumber: details.lineNumber, sourceId: details.sourceId },
    ),
  );

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    devUrl.searchParams.set('webviewPreload', webviewPreloadPath);
    mainWindow.loadURL(devUrl.toString());
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { webviewPreload: webviewPreloadPath } },
    );
  }

};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  initializeLogger(path.join(app.getPath('userData'), 'logs'));
  log('info', 'app', 'Application starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
  });
  try {
    initializeStorage();
    registerIpcHandlers();
    createWindow();
  } catch (error) {
    log('error', 'app', 'Application initialization failed', error);
    throw error;
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('uncaughtExceptionMonitor', (error) =>
  log('error', 'process', 'Uncaught main-process exception', error),
);
process.on('unhandledRejection', (error) =>
  log('error', 'process', 'Unhandled main-process rejection', error),
);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
