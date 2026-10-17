import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { EtgbExcelService } from '@/lib/services/etgbExcelService';

const order: any = {
  id: 'o1',
  orderNumber: '1001',
  trackingNumber: '1Z999',
  customerName: 'Jane Doe',
  currency: 'USD',
  totalPrice: 40,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  shippingAddress: { country_code: 'US' },
  items: [],
};

describe('EtgbExcelService', () => {
  it("writes the seller's own company as exporter and never a built-in GTIP/description", async () => {
    const svc = new EtgbExcelService();
    const out = await svc.generateExcel({
      orders: [order],
      batchId: 'b1',
      userId: 'u1',
      exporter: { name: 'ÖRNEK TİCARET LTD', taxNumber: '1234567890', defaultHsCode: '442090', defaultCountryOfMfg: null },
    });
    const sheet = XLSX.read(out.buffer).Sheets['ETGB Export'];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    const header = rows[0] as string[];
    const row = rows[1] as any[];
    expect(row[header.indexOf('GÖNDEREN')]).toBe('ÖRNEK TİCARET LTD');
    expect(row[header.indexOf('GÖNDEREN V.D.')]).toBe('1234567890');
    expect(row[header.indexOf('GTIP NO')]).toBe('442090');
    expect(JSON.stringify(rows)).not.toMatch(/TAMSAR|6204439506|Textile Product/);
  });
});
