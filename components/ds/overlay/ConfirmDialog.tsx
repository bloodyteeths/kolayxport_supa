import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import OutlinedInput from '@mui/material/OutlinedInput';
import { useTranslations } from 'next-intl';
import { neutral as n, radius, tone as toneTokens } from '@/lib/ds/tokens';
import { Modal } from './Modal';

/**
 * DS confirm options (`description`, `destructive` are accepted as aliases of `body`, `tone: 'danger'`, so older
 * callers of `lib/hooks/useConfirm` keep working unchanged).
 */
export interface ConfirmOptions {
  /** Names the object: "Delete listing 'Baby Blanket'?" */
  title: string;
  body?: React.ReactNode;
  /** @deprecated legacy alias of `body`. */
  description?: React.ReactNode;
  /** Preview of affected items; the first `maxItems` (default 10) are shown, then "and N more". */
  items?: string[];
  maxItems?: number;
  /** Default: ds.overlay.confirm.confirm, or ds.overlay.confirm.delete when tone is danger. */
  confirmLabel?: string;
  /** Default: ds.overlay.cancel. */
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** @deprecated legacy alias of `tone: 'danger'`. */
  destructive?: boolean;
  /**
   * The user must type this text (trimmed, case-sensitive) into a field inside the dialog before the
   * primary enables. Required for irreversible bulk actions on > 10 items and any queued Etsy delete
   * (DS §3.6). Replaces the legacy `window.prompt`.
   */
  typeToConfirm?: string;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** z 1550 (default true: a confirm usually sits over a panel or modal). */
  nested?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function isDangerConfirm(o: Pick<ConfirmOptions, 'tone' | 'destructive'>): boolean {
  return o.tone === 'danger' || !!o.destructive;
}

export function typedMatches(typed: string, expected: string | undefined): boolean {
  return !expected || typed.trim() === expected.trim();
}

/** Presentational confirm (DS §3.6). Prefer `useConfirm()`. */
export function ConfirmDialog({
  open, onConfirm, onCancel, title, body, description, items, maxItems = 10, confirmLabel, cancelLabel,
  tone, destructive, typeToConfirm, nested = true, className, ...rest
}: ConfirmDialogProps) {
  const t = useTranslations('ds.overlay');
  const [typed, setTyped] = useState('');
  const inputId = useId();
  useEffect(() => {
    if (open) setTyped('');
  }, [open, typeToConfirm]);

  const danger = isDangerConfirm({ tone, destructive });
  const ok = typedMatches(typed, typeToConfirm);
  const shown = items ? items.slice(0, maxItems) : [];
  const hidden = items ? Math.max(0, items.length - shown.length) : 0;
  const content = body ?? description;
  const submit = () => {
    if (ok) onConfirm();
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      nested={nested}
      size="sm"
      className={className}
      data-testid={rest['data-testid'] ?? 'ds-confirm'}
      focusSecondary={danger && !typeToConfirm}
      primary={{
        id: 'confirm',
        label: confirmLabel || (danger ? t('confirm.delete') : t('confirm.confirm')),
        tone: danger ? 'danger' : 'default',
        disabled: !ok,
        onClick: submit,
      }}
      secondary={{ id: 'cancel', label: cancelLabel || t('cancel'), onClick: onCancel }}
    >
      {content || shown.length > 0 || typeToConfirm ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {content && <Box sx={{ color: n[600] }}>{content}</Box>}
          {shown.length > 0 && (
            <Box
              component="ul"
              data-testid="confirm-items"
              sx={{ m: 0, py: '8px', pl: '24px', pr: '8px', maxHeight: 220, overflowY: 'auto', bgcolor: n[50], borderRadius: `${radius.md}px`, fontSize: 13, lineHeight: '18px' }}
            >
              {shown.map((item, i) => (
                <Box component="li" key={`${i}-${item}`} sx={{ py: '2px', wordBreak: 'break-word' }}>
                  {item}
                </Box>
              ))}
              {hidden > 0 && (
                <Box component="li" sx={{ listStyle: 'none', ml: '-16px', pt: '4px', color: n[500] }}>
                  {t('confirm.andMore', { count: hidden })}
                </Box>
              )}
            </Box>
          )}
          {typeToConfirm && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Box component="label" htmlFor={inputId} sx={{ fontSize: 13, lineHeight: '18px', fontWeight: 500, color: n[800] }}>
                {t.rich('confirm.typeToConfirm', { text: typeToConfirm, b: (chunks) => <strong>{chunks}</strong> })}
              </Box>
              <OutlinedInput
                id={inputId}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={typeToConfirm}
                error={typed.length > 0 && !ok}
                inputProps={{
                  'aria-label': t('confirm.typeToConfirmAria'),
                  'aria-describedby': typed.length > 0 && !ok ? `${inputId}-err` : undefined,
                  autoComplete: 'off', autoCapitalize: 'off', spellCheck: false,
                  'data-testid': 'confirm-type-input',
                }}
                sx={{ height: 40, fontSize: 14, borderRadius: `${radius.sm}px`, '@media (pointer: coarse)': { height: 44, fontSize: 16 } }}
              />
              {typed.length > 0 && !ok && (
                <Box id={`${inputId}-err`} sx={{ fontSize: 12, lineHeight: '16px', color: toneTokens.danger.fg }}>
                  {t('confirm.mismatch')}
                </Box>
              )}
            </Box>
          )}
        </Box>
      ) : null}
    </Modal>
  );
}

// ── useConfirm (DS) ─────────────────────────────────────────────────────────────────────────────
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const DsConfirmContext = createContext<ConfirmFn | null>(null);

/** Mount once (pages/_app.tsx). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(ok);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    if (resolver.current) resolver.current(false); // a second confirm cancels the first
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(opts);
      setOpen(true);
    });
  }, []);

  useEffect(() => () => resolver.current?.(false), []);

  return (
    <DsConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmDialog {...options} open={open} onConfirm={() => settle(true)} onCancel={() => settle(false)} />}
    </DsConfirmContext.Provider>
  );
}

/**
 * `const confirm = useConfirm(); if (!(await confirm({ title, tone: 'danger', typeToConfirm: shopName }))) return;`
 *
 * Uses the `ConfirmProvider` mounted in `_app`; without one (isolated renders) it falls back to `window.confirm`
 * (and `window.prompt` for `typeToConfirm`).
 */
export function useConfirm(): ConfirmFn {
  const ds = useContext(DsConfirmContext);
  return useCallback<ConfirmFn>(
    async (opts) => {
      if (ds) return ds(opts);
      if (typeof window === 'undefined') return false;
      const body = opts.body ?? opts.description;
      const text = [opts.title, typeof body === 'string' ? body : ''].filter(Boolean).join('\n\n');
      const ok = window.confirm(text);
      if (!ok || !opts.typeToConfirm) return ok;
      return (window.prompt(opts.typeToConfirm) || '').trim() === opts.typeToConfirm.trim();
    },
    [ds],
  );
}

export default ConfirmDialog;
