import type { NextApiRequest, NextApiResponse } from 'next';
import '../../lib/config'; // Import to ensure it was loaded and validated at startup. Path adjusted for api folder depth.
import { checkDatabaseConnection } from '../../lib/prisma';

interface HealthStatus {
  ok: boolean;
  message?: string;
  config?: {
    VEEQO: 'ok' | 'error';
    Shippo: 'ok' | 'error';
    FedEx: 'ok' | 'error';
  };
  database?: 'ok' | 'error';
  timestamp?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthStatus>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    // Check database connection
    const isDatabaseHealthy = await checkDatabaseConnection();

    // The import of '../../lib/config' at the top of the module ensures that
    // if any required env vars were missing, an error would have been thrown
    // during server startup or module initialization, likely preventing this
    // handler from being reached or causing the server to fail.
    // Thus, if we reach here, the initial config validation passed.

    const healthStatus = {
      ok: isDatabaseHealthy,
      message: isDatabaseHealthy 
        ? "All systems operational" 
        : "Database connection issues detected",
      config: { // This part is symbolic as the global throw prevents granular error reporting here if startup failed.
        VEEQO: 'ok',
        Shippo: 'ok',
        FedEx: 'ok',
      },
      database: isDatabaseHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    } as HealthStatus;

    return res.status(isDatabaseHealthy ? 200 : 503).json(healthStatus);
  } catch (error: any) {
    // This catch block might not be reached if the error in lib/config.ts
    // occurs during initial module loading and crashes the server/route.
    console.error("[API Health Check Error] Error during health check:", error);
    return res.status(500).json({
      ok: false,
      message: "Health check failed. An error occurred, possibly due to environment configuration issues at startup.",
      database: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
} 