import { callSpApiWithRetry, type AmazonRegion } from './amazonClient';
import { logger } from '../logger';
import { gunzipSync } from 'zlib';

/**
 * Amazon SP-API Reports processor.
 * Handles the create → poll → download → parse workflow.
 */

// ---------------------------------------------------------------------------
// Report Types
// ---------------------------------------------------------------------------

export const REPORT_TYPES = {
  ALL_ORDERS_BY_DATE: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE',
  ALL_ORDERS_BY_UPDATE: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE',
  SETTLEMENT: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE',
  ACTIVE_LISTINGS: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA',
  ALL_LISTINGS: 'GET_MERCHANT_LISTINGS_ALL_DATA',
  FBA_INVENTORY: 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA',
} as const;

// ---------------------------------------------------------------------------
// Create Report
// ---------------------------------------------------------------------------

export async function requestReport(
  token: string,
  region: AmazonRegion,
  reportType: string,
  marketplaceIds: string[],
  dataStartTime?: string,
  dataEndTime?: string,
): Promise<string> {
  const body: any = {
    reportType,
    marketplaceIds,
  };

  if (dataStartTime) body.dataStartTime = dataStartTime;
  if (dataEndTime) body.dataEndTime = dataEndTime;

  const response = await callSpApiWithRetry(
    '/reports/2021-06-30/reports',
    token,
    region,
    { method: 'POST', body: JSON.stringify(body) },
  );

  const reportId = response.reportId;
  logger.info('Amazon report requested', { reportId, reportType });
  return reportId;
}

// ---------------------------------------------------------------------------
// Poll Report Status
// ---------------------------------------------------------------------------

export type ReportStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'FATAL';

export interface ReportInfo {
  reportId: string;
  reportType: string;
  processingStatus: ReportStatus;
  reportDocumentId?: string;
  dataStartTime?: string;
  dataEndTime?: string;
}

export async function getReportStatus(
  token: string,
  region: AmazonRegion,
  reportId: string,
): Promise<ReportInfo> {
  return callSpApiWithRetry(
    `/reports/2021-06-30/reports/${reportId}`,
    token,
    region,
  );
}

/**
 * Poll until the report is DONE or fails.
 * Uses exponential backoff: 5s, 10s, 20s, 40s, 60s...
 */
export async function pollReportUntilDone(
  token: string,
  region: AmazonRegion,
  reportId: string,
  maxAttempts: number = 20,
): Promise<ReportInfo> {
  let delay = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const info = await getReportStatus(token, region, reportId);

    if (info.processingStatus === 'DONE') {
      logger.info('Amazon report ready', { reportId, documentId: info.reportDocumentId });
      return info;
    }

    if (info.processingStatus === 'CANCELLED' || info.processingStatus === 'FATAL') {
      throw new Error(`Amazon report ${reportId} failed: ${info.processingStatus}`);
    }

    logger.info('Amazon report still processing', {
      reportId,
      status: info.processingStatus,
      attempt: attempt + 1,
      nextDelayMs: delay,
    });

    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 60000); // Cap at 60s
  }

  throw new Error(`Amazon report ${reportId} timed out after ${maxAttempts} attempts`);
}

// ---------------------------------------------------------------------------
// Download Report
// ---------------------------------------------------------------------------

export async function getReportDocument(
  token: string,
  region: AmazonRegion,
  reportDocumentId: string,
): Promise<{ url: string; compressionAlgorithm?: string }> {
  return callSpApiWithRetry(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
    token,
    region,
  );
}

/**
 * Download and decompress a report document.
 * Returns the raw text content (usually TSV).
 */
export async function downloadReport(
  token: string,
  region: AmazonRegion,
  reportDocumentId: string,
): Promise<string> {
  const doc = await getReportDocument(token, region, reportDocumentId);

  const response = await fetch(doc.url);
  if (!response.ok) {
    throw new Error(`Failed to download report: ${response.status}`);
  }

  if (doc.compressionAlgorithm === 'GZIP') {
    const buffer = Buffer.from(await response.arrayBuffer());
    return gunzipSync(buffer).toString('utf-8');
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// Full workflow: request → poll → download
// ---------------------------------------------------------------------------

/**
 * Request an order report and wait for it to complete.
 * Returns parsed TSV content as a string.
 */
export async function fetchOrderReport(
  token: string,
  region: AmazonRegion,
  marketplaceIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<string> {
  const reportId = await requestReport(
    token,
    region,
    REPORT_TYPES.ALL_ORDERS_BY_DATE,
    marketplaceIds,
    startDate.toISOString(),
    endDate.toISOString(),
  );

  const info = await pollReportUntilDone(token, region, reportId);

  if (!info.reportDocumentId) {
    throw new Error('Report completed but no document ID');
  }

  return downloadReport(token, region, info.reportDocumentId);
}

/**
 * Get the most recent settlement reports (auto-generated by Amazon).
 */
export async function getSettlementReports(
  token: string,
  region: AmazonRegion,
  maxResults: number = 10,
): Promise<ReportInfo[]> {
  const response = await callSpApiWithRetry(
    `/reports/2021-06-30/reports?reportTypes=${REPORT_TYPES.SETTLEMENT}&pageSize=${maxResults}&processingStatuses=DONE`,
    token,
    region,
  );

  return response.reports || [];
}
