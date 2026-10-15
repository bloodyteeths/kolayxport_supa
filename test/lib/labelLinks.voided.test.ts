import { describe, expect, it } from 'vitest';
import { getLatestLabel } from '@/lib/shipping/labelLinks';

describe('getLatestLabel: voided order-level label', () => {
  it('a voided order-level label is no label', () => {
    expect(getLatestLabel({ labelStatus: 'voided', shippingLabelUrl: 'https://x/label.pdf', trackingNumber: '1Z' }).url).toBeNull();
  });

  it('a voided order does not borrow the order-level URL for a label job without a file', () => {
    const latest = getLatestLabel({
      labelStatus: 'voided',
      shippingLabelUrl: 'https://x/old.pdf',
      line_items: [{ labelJobs: [{ status: 'created', trackingNumber: '7777', carrier: 'FedEx' }] }],
    });
    expect(latest.url).toBeNull();
    expect(latest.trackingNumber).toBe('7777');
  });

  it('a voided order does not lend its tracking number to a label job that has none', () => {
    const latest = getLatestLabel({
      labelStatus: 'voided',
      trackingNumber: 'VOIDED-1Z',
      line_items: [{ labelJobs: [{ status: 'created', pdfUrl: 'https://x/job.pdf', carrier: 'FedEx' }] }],
    });
    expect(latest.url).toBe('https://x/job.pdf');
    expect(latest.trackingNumber).toBeNull();
  });

  it('a non-voided order still lends its tracking number to a label job that has none', () => {
    const latest = getLatestLabel({
      trackingNumber: 'ORDER-1Z',
      line_items: [{ labelJobs: [{ status: 'created', pdfUrl: 'https://x/job.pdf' }] }],
    });
    expect(latest.trackingNumber).toBe('ORDER-1Z');
  });

  it('a newer created shipment still counts on a voided order', () => {
    const latest = getLatestLabel({
      labelStatus: 'voided',
      shippingLabelUrl: 'https://x/old.pdf',
      shipments: [{ id: 's1', status: 'created', trackingNumber: 'NEW', pdfUrl: 'https://x/new.pdf' }],
    });
    expect(latest.url).toBe('https://x/new.pdf');
    expect(latest.shipmentId).toBe('s1');
  });

  it('non-voided orders keep the order-level fallback', () => {
    expect(getLatestLabel({ labelStatus: 'created', shippingLabelUrl: 'https://x/label.pdf' }).url).toBe('https://x/label.pdf');
  });
});
