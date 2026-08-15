import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_LOG_FILES = 3;
let logPath = '';

export function initializeLogger(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  logPath = path.join(directory, 'app.log');
  if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_LOG_BYTES) {
    rotateLogs();
  }
}

export function log(
  level: LogLevel,
  scope: string,
  message: string,
  details?: unknown,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(details === undefined ? {} : { details: serializeDetails(details) }),
  };
  const line = JSON.stringify(entry);

  if (logPath) {
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_LOG_BYTES) {
        rotateLogs();
      }
      fs.appendFileSync(logPath, `${line}\n`);
    } catch (error) {
      console.error('Could not write application log:', error);
    }
  }

}

export function getLogPath() {
  return logPath;
}

export function readRecentLogs(maxLines = 300) {
  if (!logPath || !fs.existsSync(logPath)) return '';

  const file = fs.openSync(logPath, 'r');
  try {
    const size = fs.fstatSync(file).size;
    const bytesToRead = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(file, buffer, 0, bytesToRead, size - bytesToRead);
    return buffer
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-maxLines)
      .join('\n');
  } finally {
    fs.closeSync(file);
  }
}

function rotateLogs() {
  if (!logPath || !fs.existsSync(logPath)) return;

  const oldest = `${logPath}.${MAX_LOG_FILES}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${logPath}.${index + 1}`);
  }
  fs.renameSync(logPath, `${logPath}.1`);
}

function serializeDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return { name: details.name, message: details.message, stack: details.stack };
  }

  try {
    return JSON.parse(JSON.stringify(details)) as unknown;
  } catch {
    return String(details);
  }
}
