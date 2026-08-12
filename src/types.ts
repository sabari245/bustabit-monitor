export interface GameData {
  hash: string;
  id: number | null;
  bust: number | null;
}

export interface StoredGame {
  hash: string;
  id: number;
  bust: number;
  receivedAt: string;
  reconstructed?: boolean;
}

export interface AutomationScript {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
}

export interface AutomationSettings {
  botToken: string;
  chatId: string;
  scripts: AutomationScript[];
}

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLogs {
  path: string;
  content: string;
}

export interface BackfillProgress {
  processed: number;
  total: number;
  currentId: number;
}

declare global {
  interface Window {
    electronAPI: {
      copyText: (text: string) => Promise<void>;
      log: (
        level: LogLevel,
        scope: string,
        message: string,
        details?: unknown,
      ) => Promise<void>;
      getDiagnosticLogs: () => Promise<DiagnosticLogs>;
      openLogFolder: () => Promise<string>;
      onBackfillProgress: (callback: (progress: BackfillProgress) => void) => void;
      getRecentGames: () => Promise<StoredGame[]>;
      getGameHistory: (offset?: number, limit?: number) => Promise<StoredGame[]>;
      storeGame: (game: GameData) => Promise<StoredGame | null>;
      getAutomationSettings: () => Promise<AutomationSettings>;
      saveAutomationSettings: (settings: AutomationSettings) => Promise<void>;
      sendTelegramMessage: (
        botToken: string,
        chatId: string,
        text: string,
      ) => Promise<TelegramResult>;
    };
  }
}
