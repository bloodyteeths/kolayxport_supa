import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import ConfirmDialog, { type ConfirmOptions } from '@/components/ui/ConfirmDialog';

export type { ConfirmOptions } from '@/components/ui/ConfirmDialog';
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mount once (pages/_app.tsx). Renders a single ConfirmDialog and exposes
 * `confirm()` through useConfirm().
 */
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
    // A second confirm while one is open cancels the first.
    if (resolver.current) resolver.current(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(opts);
      setOpen(true);
    });
  }, []);

  // Never leave a caller awaiting forever.
  useEffect(() => () => resolver.current?.(false), []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmDialog
          {...options}
          open={open}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * const confirm = useConfirm();
 * if (!(await confirm({ title, items, destructive: true }))) return;
 *
 * Falls back to window.confirm if no ConfirmProvider is mounted.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useCallback<ConfirmFn>(
    async (opts) => {
      if (ctx) return ctx(opts);
      if (typeof window === 'undefined') return false;
      console.warn('[useConfirm] ConfirmProvider is not mounted; falling back to window.confirm');
      const text = [opts.title, typeof opts.description === 'string' ? opts.description : '']
        .filter(Boolean)
        .join('\n\n');
      const ok = window.confirm(text);
      if (!ok || !opts.typeToConfirm) return ok;
      return (window.prompt(opts.typeToConfirm) || '').trim() === opts.typeToConfirm.trim();
    },
    [ctx]
  );
}

export default useConfirm;
