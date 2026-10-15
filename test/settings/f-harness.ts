// Shared request/response doubles for settings Group F API route tests.
import { vi } from 'vitest';

export function makeReq(init: { method?: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {}) {
  return { method: init.method ?? 'GET', query: init.query ?? {}, body: init.body, headers: init.headers ?? {} } as any;
}

export function makeRes() {
  const state = { status: 0, body: null as any, headers: {} as Record<string, unknown> };
  const res: any = {
    setHeader: vi.fn((k: string, v: unknown) => { state.headers[k] = v; return res; }),
    status: vi.fn((code: number) => { state.status = code; return res; }),
    json: vi.fn((body: any) => { state.body = body; return res; }),
    end: vi.fn(() => res),
    state,
  };
  return res;
}
