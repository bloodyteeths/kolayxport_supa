import { describe, expect, it, vi } from 'vitest';
import { activationLine, isActivationEvent, isActivationProvider, summarizeActivation } from '@/lib/activation/events';

describe('activation events', () => {
  it('whitelists events and providers', () => {
    expect(isActivationEvent('oauth_start')).toBe(true);
    expect(isActivationEvent('drop table')).toBe(false);
    expect(isActivationProvider('ebay')).toBe(true);
    expect(isActivationProvider('evil')).toBe(false);
  });
  it('summarizes a stuck eBay attempt and a later success', () => {
    const at = (m: string, provider?: string, t = '2026-10-22T13:18:00Z') => ({ message: `activation:${m}`, details: provider ? { provider } : null, timestamp: t });
    const s = summarizeActivation([
      at('app_visit'), at('checklist_view'), at('connect_click', 'ebay'),
      ...Array.from({ length: 7 }, () => at('oauth_start', 'ebay')),
      at('app_visit', undefined, '2026-10-26T08:00:00Z'), at('oauth_start', 'etsy'), at('oauth_ok', 'etsy'), at('credentials_saved', 'trendyol'),
    ]);
    expect(s).toMatchObject({ visits: 2, checklist: true, clicked: ['ebay'], started: { ebay: 7, etsy: 1 }, connected: ['etsy'], credentials: ['trendyol'], lastSeen: '2026-10-26T08:00:00.000Z' });
    expect(activationLine(s)).toBe('2 visits · checklist · clicked ebay · started ebay×7/etsy · connected etsy · keys trendyol');
    expect(activationLine(summarizeActivation([]))).toBe('');
  });
});

describe('POST /api/activation/event', () => {
  it('accepts only client events, needs a provider for connect clicks', async () => {
    vi.resetModules();
    const recorded: unknown[] = [];
    vi.doMock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
    vi.doMock('@/lib/logger', () => ({ logger: { event: (...a: unknown[]) => { recorded.push(a); } } }));
    const { default: handler } = await import('@/pages/api/activation/event');
    const run = async (body: unknown) => {
      let code = 0;
      const res: any = { status: (c: number) => { code = c; return res; }, end: () => res };
      await handler({ method: 'POST', body } as any, res);
      return code;
    };
    expect(await run({ event: 'app_visit' })).toBe(204);
    expect(await run({ event: 'connect_click', provider: 'etsy' })).toBe(204);
    expect(await run({ event: 'connect_click' })).toBe(400);
    expect(await run({ event: 'oauth_ok', provider: 'etsy' })).toBe(400);
    expect(await run(JSON.stringify({ event: 'checklist_view' }))).toBe(204);
    expect(recorded.map((a: any) => [a[2], a[4].userId])).toEqual([['activation:app_visit', 'u1'], ['activation:connect_click', 'u1'], ['activation:checklist_view', 'u1']]);
  });
});

describe('editor activation events', () => {
  it('summarizes editor opens, chosen jobs, staged and sent counts', () => {
    const at = (m: string, details: unknown = null) => ({ message: `activation:${m}`, details, timestamp: '2026-10-24T10:00:00Z' });
    const s = summarizeActivation([
      at('editor_open'), at('editor_job', { job: 'changePrice', count: 3 }), at('editor_job', { job: 'changePrice' }), at('editor_job', { job: 'addTags' }),
      at('editor_staged', { count: 3 }), at('editor_staged', { count: 2 }), at('editor_sent', { count: 5 }),
    ]);
    expect(s.editor).toEqual({ opens: 1, jobs: { changePrice: 2, addTags: 1 }, staged: 5, sent: 5 });
    expect(activationLine(s)).toBe('editor 1× (changePrice×2/addTags) staged 5 sent 5');
  });
  it('the API records only a safe job name and a bounded count', async () => {
    vi.resetModules();
    const recorded: any[] = [];
    vi.doMock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
    vi.doMock('@/lib/logger', () => ({ logger: { event: (...a: unknown[]) => { recorded.push(a); } } }));
    const { default: handler } = await import('@/pages/api/activation/event');
    const res: any = { status: () => res, end: () => res };
    await handler({ method: 'POST', body: { event: 'editor_job', job: 'changePrice', count: 4 } } as any, res);
    await handler({ method: 'POST', body: { event: 'editor_job', job: '<script>x</script>', count: 1e9 } } as any, res);
    await handler({ method: 'POST', body: { event: 'editor_sent', count: -2 } } as any, res);
    expect(recorded.map((a) => [a[2], a[3]])).toEqual([
      ['activation:editor_job', { job: 'changePrice', count: 4 }],
      ['activation:editor_job', { count: 100000 }],
      ['activation:editor_sent', undefined],
    ]);
  });
});
