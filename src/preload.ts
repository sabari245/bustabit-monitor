import { contextBridge, ipcRenderer } from 'electron';
import type {
  AutomationSettings,
  BackfillProgress,
  GameData,
  LogLevel,
  RedbotChatMessage,
  RedbotAutomationCommand,
} from './types';

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    copyText: (text: string) => ipcRenderer.invoke('diagnostics:copy', text),
    log: (level: LogLevel, scope: string, message: string, details?: unknown) =>
      ipcRenderer.invoke('diagnostics:log', level, scope, message, details),
    getDiagnosticLogs: () => ipcRenderer.invoke('diagnostics:get'),
    openLogFolder: () => ipcRenderer.invoke('diagnostics:open-folder'),
    onBackfillProgress: (callback: (progress: BackfillProgress) => void) =>
      ipcRenderer.on('backfill:progress', (_event, progress) => callback(progress)),
    getRecentGames: () => ipcRenderer.invoke('games:recent'),
    getGameHistory: (offset = 0, limit = 100) =>
      ipcRenderer.invoke('games:history', offset, limit),
    storeGame: (game: GameData) => ipcRenderer.invoke('games:store', game),
    getAutomationSettings: () => ipcRenderer.invoke('automation:get'),
    saveAutomationSettings: (settings: AutomationSettings) =>
      ipcRenderer.invoke('automation:save', settings),
    sendTelegramMessage: (botToken: string, chatId: string, text: string) =>
      ipcRenderer.invoke('telegram:send', botToken, chatId, text),
    getRedbotBets: (offset = 0, limit = 10) =>
      ipcRenderer.invoke('redbot:activity:get', offset, limit),
    storeRedbotChatMessages: (messages: RedbotChatMessage[]) =>
      ipcRenderer.invoke('redbot:activity:store', messages),
    trackRedbotAutomationCommand: (command: RedbotAutomationCommand) =>
      ipcRenderer.invoke('redbot:command:track', command),
    discardRedbotAutomationCommand: (trackingId: string) =>
      ipcRenderer.invoke('redbot:command:discard', trackingId),
  });
} catch (error) {
  ipcRenderer.send(
    'preload:error',
    error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  );
}
