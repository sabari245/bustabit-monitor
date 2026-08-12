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
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type {
  AutomationScript,
  AutomationSettings,
  GameData,
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
let recentGames: StoredGame[] = [];
let dataDirectory = '';
let historyPath = '';
let recentPath = '';
let settingsPath = '';

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
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (historyStartsAtClassicFloor()) {
    recentGames = readHistoryPage(0, MAX_RECENT_GAMES);
    writeJson(recentPath, recentGames);
  } else {
    log('warn', 'storage', 'Complete classic history is unavailable; rebuilding from live data');
    recentGames = [];
  }
  log('info', 'storage', 'Storage initialized', {
    dataDirectory,
    historyPath,
    recentRoundsLoaded: recentGames.length,
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
      ? [{
          id: 'migrated-script',
          name: 'My automation',
          code: settings.script,
          enabled: settings.active === true,
        }]
      : DEFAULT_AUTOMATION_SCRIPTS.map((script) => ({ ...script }));
  return {
    botToken: typeof settings.botToken === 'string' ? settings.botToken : '',
    chatId: typeof settings.chatId === 'string' ? settings.chatId : '',
    scripts,
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
  ipcMain.handle('automation:get', getAutomationSettings);
  ipcMain.handle(
    'automation:save',
    (_event, settings: AutomationSettings) => {
      try {
        writeJson(settingsPath, settings);
        log('info', 'automation', 'Automation settings saved', {
          scriptCount: settings.scripts.length,
          enabledScriptCount: settings.scripts.filter((script) => script.enabled).length,
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
