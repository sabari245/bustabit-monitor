import { createHash, createHmac } from 'node:crypto';

export const CLASSIC_START_ID = 12_279_451;
export const CLASSIC_START_HASH =
  '86c808ac480d261de1d6481520cdd0064327a25c0da4f8109dd8ea7cce0662e6';

const GAME_SALT_HEX_UTF8_KEY =
  '00000000000000000001e08b7fd44f95e3e950ac65650a8031a6d5e1750e34be';

export function previousHash(hash: string) {
  return createHash('sha256').update(Buffer.from(hash, 'hex')).digest('hex');
}

export function bustMultiplier(hash: string) {
  const digest = createHmac('sha256', GAME_SALT_HEX_UTF8_KEY)
    .update(Buffer.from(hash, 'hex'))
    .digest('hex');
  const x = Number.parseInt(digest.slice(0, 13), 16) / 2 ** 52;
  return Math.max(100, Math.floor(99 / (1 - x))) / 100;
}
