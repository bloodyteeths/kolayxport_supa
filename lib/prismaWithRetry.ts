import prisma from './prisma';

// Wrapper to handle Prisma operations with retry logic for serverless environments
export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure connection before operation
      await prisma.$connect();
      
      // Quick health check to ensure the connection is working
      await prisma.$queryRaw`SELECT 1`;
      
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      console.error(`[Prisma] Attempt ${attempt}/${maxRetries} failed:`, {
        message: error.message,
        code: error.code,
        clientVersion: error.clientVersion
      });
      
      // Check if it's a connection error
      if (
        error.message?.includes('connection') ||
        error.message?.includes('FATAL') ||
        error.message?.includes('Engine is not yet connected') ||
        error.message?.includes('not yet connected') ||
        error.code === 'P1001' ||
        error.code === 'P1002'
      ) {
        // Disconnect and wait before retry
        try {
          await prisma.$disconnect();
        } catch (disconnectError) {
          console.error('[Prisma] Disconnect error:', disconnectError);
        }
        
        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delay = 100 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`[Prisma] Retrying after ${delay}ms...`);
          continue;
        }
      }
      
      // If not a connection error or last attempt, throw
      throw error;
    }
  }
  
  throw lastError;
}

export default withPrismaRetry;