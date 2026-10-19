// GET /api/admin/partners/report?month=YYYY-MM[&format=csv] — partner report (lib/partners/report.ts). Admin only.
// Counts and money only, no user identifiers (KVKK).
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { loadPartnerReport, monthRange, reportToCsv } from '@/lib/partners/report';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : null;
  if (month && !monthRange(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const report = await loadPartnerReport(month);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="partner-report-${month ?? 'all'}.csv"`);
    return res.status(200).send(reportToCsv(report));
  }
  return res.status(200).json(report);
});
