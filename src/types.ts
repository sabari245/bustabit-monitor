export interface GameData {
  hash: string;
  id: number | null;
  bust: number | null;
}

declare global {
  interface Window {
    electronAPI: {
      webviewPreload: string;
    };
  }
}
