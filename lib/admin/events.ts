import { logger, type LogCategory, type LogLevel } from '@/lib/logger';

/**
 * Thin wrappers over `logger.event()` so calling code reads naturally and the cockpit
 * can rely on a fixed set of category strings.
 *
 * Everything routed through these helpers ends up in `SyncLog` with `category` set, and
 * goes through the existing redactor. No raw payloads. No secrets. No buyer PII.
 */

type EventArgs = {
  message: string;
  details?: Record<string, any>;
  userId?: string;
  operation?: string;
  error?: Error;
};

function dispatch(category: LogCategory, level: LogLevel, args: EventArgs) {
  return logger.event(category, level, args.message, args.details, {
    userId: args.userId,
    operation: args.operation,
    error: args.error,
  });
}

export const logSecurityEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('security', level, args);

export const logCronEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('cron', level, args);

export const logIntegrationEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('integration', level, args);

export const logBillingEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('billing', level, args);

export const logExtensionEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('extension', level, args);

export const logShippingEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('shipping', level, args);

export const logEtgbEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('etgb', level, args);

export const logSystemEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('system', level, args);

export const logAuthEvent = (level: LogLevel, args: EventArgs) =>
  dispatch('auth', level, args);
