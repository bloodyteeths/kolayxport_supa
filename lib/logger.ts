import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  level: LogLevel;
  message: string;
  userId?: string;
  operation?: string;
  details?: Record<string, any>;
  error?: Error;
  timestamp: Date;
}

export async function log(entry: Omit<LogEntry, 'timestamp'>) {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: new Date(),
  };

  // Console logging for development
  if (process.env.NODE_ENV !== 'production') {
    const consoleMethod = entry.level === 'error' ? 'error' : 
                         entry.level === 'warn' ? 'warn' : 
                         entry.level === 'debug' ? 'debug' : 'log';
    console[consoleMethod](JSON.stringify(logEntry, null, 2));
  }

  // Store in database
  try {
    await prisma.syncLog.create({
      data: {
        level: entry.level,
        message: entry.message,
        userId: entry.userId,
        operation: entry.operation,
        details: entry.details || {},
        error: entry.error ? entry.error.message : null,
        timestamp: logEntry.timestamp,
      },
    });
  } catch (error) {
    // Fallback to console if DB logging fails
    console.error('Failed to store log entry:', error);
  }
}

// Convenience methods
export const logger = {
  info: (message: string, details?: Record<string, any>) => 
    log({ level: 'info', message, details }),
  
  warn: (message: string, details?: Record<string, any>) => 
    log({ level: 'warn', message, details }),
  
  error: (message: string, error?: Error, details?: Record<string, any>) => 
    log({ level: 'error', message, error, details }),
  
  debug: (message: string, details?: Record<string, any>) => 
    log({ level: 'debug', message, details }),
}; 