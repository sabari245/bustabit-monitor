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
  redbotScripts: AutomationScript[];
  redbotDefaultsVersion: number;
}

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

export type RedbotActivityKind = 'balance' | 'bet' | 'win' | 'loss';

export interface RedbotChatMessage {
  sourceKey: string;
  chatTime: string | null;
  message: string;
}

export interface RedbotActivity {
  id: string;
  sourceKey: string;
  kind: RedbotActivityKind;
  message: string;
  amountBits: number | null;
  balanceBits: number | null;
  chatTime: string | null;
  recordedAt: string;
}

export type RedbotBetOutcome = 'won' | 'lost';

export interface RedbotBetRecord {
  id: string;
  outcome: RedbotBetOutcome;
  scriptName: string;
  triggerRoundId: number;
  details: string;
  wagerBits: number;
  netBits: number;
  balanceAfterBits: number | null;
}

export interface RedbotAutomationCommand {
  scriptId: string;
  scriptName: string;
  triggerRoundId: number;
  command: string;
}

export interface RedbotBetPage {
  items: RedbotBetRecord[];
  total: number;
  balanceBits: number | null;
  balanceUpdatedAt: string | null;
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
      getRedbotBets: (offset?: number, limit?: number) => Promise<RedbotBetPage>;
      storeRedbotChatMessages: (messages: RedbotChatMessage[]) => Promise<number>;
      trackRedbotAutomationCommand: (command: RedbotAutomationCommand) => Promise<void>;
    };
  }
}
