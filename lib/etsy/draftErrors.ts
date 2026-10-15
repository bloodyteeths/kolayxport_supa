// Typed errors raised by the Etsy staged-draft engine. API routes map `status`
// to the HTTP status and forward `code` / `key` / `issues` so the UI can render
// a translated message (next-intl key under `etsy.draftSync.*` /
// `etsy.validation.*`) instead of a raw server string.

export interface DraftIssue {
  field: string;
  severity: 'block_save' | 'block_sync';
  /** i18n key, relative to the `etsy` namespace (e.g. `validation.titleTooLong`). */
  key: string;
  params?: Record<string, string | number>;
  /** English fallback message (for logs / older clients). */
  message: string;
}

export class EtsyDraftError extends Error {
  code: string;
  status: number;
  key?: string;
  params?: Record<string, string | number>;
  issues?: DraftIssue[];

  constructor(
    code: string,
    message: string,
    opts: { status?: number; key?: string; params?: Record<string, string | number>; issues?: DraftIssue[] } = {},
  ) {
    super(message);
    this.name = 'EtsyDraftError';
    this.code = code;
    this.status = opts.status ?? 400;
    this.key = opts.key;
    this.params = opts.params;
    this.issues = opts.issues;
  }
}

export function isEtsyDraftError(err: unknown): err is EtsyDraftError {
  return Boolean(err) && (err as any).name === 'EtsyDraftError' && typeof (err as any).code === 'string';
}

/**
 * The draft for this listing is being sent to Etsy right now. Staging onto it
 * (or creating a sibling draft) is refused with 409 { code: 'DRAFT_SENDING' },
 * the same code/key the batch-media route reports per item.
 */
export const DRAFT_SENDING = 'DRAFT_SENDING' as const;

export function draftSendingError(): EtsyDraftError {
  return new EtsyDraftError(DRAFT_SENDING, 'This draft is being sent to Etsy right now. Wait for it to finish.', {
    status: 409,
    key: 'draftSync.draftSyncing',
  });
}

export function isDraftSendingError(err: unknown): boolean {
  return isEtsyDraftError(err) && err.code === DRAFT_SENDING;
}

/** Shape an error for a JSON API response. Never leaks stack traces. */
export function draftErrorResponse(err: any, fallback: string): { status: number; body: Record<string, any> } {
  if (isEtsyDraftError(err)) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        ...(err.key ? { key: err.key } : {}),
        ...(err.params ? { params: err.params } : {}),
        ...(err.issues ? { issues: err.issues } : {}),
      },
    };
  }
  return { status: 500, body: { error: err?.message || fallback } };
}
