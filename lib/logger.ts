import prisma from './prisma';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Coarse domain bucket so the admin monitoring cockpit can filter quickly.
 * Keep this list short — anything finer-grained goes in `operation`.
 */
export type LogCategory =
  | 'security'
  | 'cron'
  | 'integration'
  | 'billing'
  | 'extension'
  | 'shipping'
  | 'etgb'
  | 'system'
  | 'auth';

export interface LogEntry {
  level: LogLevel;
  category?: LogCategory;
  message: string;
  userId?: string;
  operation?: string;
  details?: Record<string, any>;
  error?: Error;
  timestamp: Date;
}

const SECRET_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|x-extension-auth|password|passphrase|token|tokens|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|api[_-]?secret|secret|client[_-]?secret|private[_-]?key|stripe[_-]?signature|signing[_-]?secret)$/i;

const SECRET_SUBSTRING_PATTERN = /(token|secret|password|api[_-]?key|client[_-]?secret|private[_-]?key|oauth[_-]?code|authorization[_-]?code)/i;

// Buyer/customer PII. We deliberately do NOT match generic `name` (listing/shop/
// file names are not PII) — only personal-contact fields. Redacting these keeps
// buyer PII out of the SyncLog store even if a caller passes a raw order object.
const PII_KEY_PATTERN =
  /(e[_-]?mail|phone|mobile|first[_-]?name|last[_-]?name|full[_-]?name|buyer[_-]?name|customer[_-]?name|recipient|address|street|postal|zip[_-]?code|national[_-]?id|tax[_-]?id|tckn|iban|card[_-]?number)/i;

// Scrub anything that looks like an e-mail address out of free-text string values.
const EMAIL_VALUE_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const REDACTED = '[REDACTED]' as const;
const PII_REDACTED = '[PII_REDACTED]' as const;
const MAX_DEPTH = 8;
const MAX_STRING_LEN = 4096;

function shouldRedactKey(key: string): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true;
  if (SECRET_SUBSTRING_PATTERN.test(key)) return true;
  return false;
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERN.test(key);
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Error) && !(v instanceof Date);
}

export function redact(value: any, depth = 0, seen: WeakSet<object> = new WeakSet()): any {
  if (depth > MAX_DEPTH) return '[TRUNCATED:depth]';
  if (value == null) return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: typeof value.message === 'string' ? value.message.slice(0, MAX_STRING_LEN) : value.message,
      code: (value as any).code,
      stack: value.stack,
    };
  }

  if (value instanceof Date) return value;

  if (typeof value === 'string') {
    const scrubbed = value.replace(EMAIL_VALUE_PATTERN, '[EMAIL_REDACTED]');
    return scrubbed.length > MAX_STRING_LEN ? scrubbed.slice(0, MAX_STRING_LEN) + '...[TRUNCATED]' : scrubbed;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    return value.map(v => redact(v, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (shouldRedactKey(k)) {
        out[k] = REDACTED;
        continue;
      }
      if (isPiiKey(k)) {
        out[k] = PII_REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1, seen);
    }
    return out;
  }

  return value;
}

function jsonReplacer(_key: string, value: any): any {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: (value as any).code,
      stack: value.stack,
    };
  }
  return value;
}

export async function log(entry: Omit<LogEntry, 'timestamp'>) {
  const safeDetails = redact(entry.details ?? {}) as Record<string, any>;
  const safeMessage =
    typeof entry.message === 'string' && entry.message.length > MAX_STRING_LEN
      ? entry.message.slice(0, MAX_STRING_LEN) + '...[TRUNCATED]'
      : entry.message;

  const logEntry: LogEntry = {
    ...entry,
    message: safeMessage,
    details: safeDetails,
    timestamp: new Date(),
  };

  if (process.env.NODE_ENV !== 'production') {
    const consoleMethod =
      entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.level === 'debug' ? 'debug' : 'log';
    try {
      console[consoleMethod](
        JSON.stringify(
          {
            level: logEntry.level,
            message: logEntry.message,
            userId: logEntry.userId,
            operation: logEntry.operation,
            details: logEntry.details,
            error: logEntry.error
              ? { name: logEntry.error.name, message: logEntry.error.message, code: (logEntry.error as any).code }
              : undefined,
            timestamp: logEntry.timestamp,
          },
          jsonReplacer,
          2,
        ),
      );
    } catch {
      console[consoleMethod](`[${logEntry.level}] ${logEntry.message}`);
    }
  }

  try {
    await prisma.syncLog.create({
      data: {
        level: entry.level,
        // `category` is a recent column (migration 20260531150000) — `as any` keeps the call
        // working on older generated clients during the deploy window.
        ...(entry.category ? { category: entry.category as any } : {}),
        message: safeMessage,
        userId: entry.userId,
        operation: entry.operation,
        details: safeDetails,
        error: entry.error ? entry.error.message?.slice(0, MAX_STRING_LEN) ?? null : null,
        timestamp: logEntry.timestamp,
      } as any,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error('Failed to store log entry:', error.name, error.message?.slice(0, 200));
    } else {
      console.error('Failed to store log entry');
    }
  }
}

export const logger = {
  info: (message: string, details?: Record<string, any>) => log({ level: 'info', message, details }),

  warn: (message: string, details?: Record<string, any>) => log({ level: 'warn', message, details }),

  error: (message: string, error?: Error, details?: Record<string, any>) =>
    log({ level: 'error', message, error, details }),

  debug: (message: string, details?: Record<string, any>) => log({ level: 'debug', message, details }),

  /**
   * Category-tagged event. Prefer over a bare logger.warn when the message belongs to a
   * cockpit-visible bucket so it can be filtered server-side via SyncLog.category.
   */
  event: (
    category: LogCategory,
    level: LogLevel,
    message: string,
    details?: Record<string, any>,
    extras?: { userId?: string; operation?: string; error?: Error },
  ) =>
    log({
      level,
      category,
      message,
      details,
      userId: extras?.userId,
      operation: extras?.operation,
      error: extras?.error,
    }),
};
