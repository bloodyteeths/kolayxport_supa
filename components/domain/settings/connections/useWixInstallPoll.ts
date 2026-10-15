/**
 * Wix install polling, moved verbatim from the legacy components/settings/ConnectionsPanel.tsx
 * (WIX_POLL_MS, WIX_POLL_MAX, the inFlight guard, server-time `since`, the false→true auto-stop effect).
 * Only changes: `react-hot-toast` → DS `useToast()`, and an `elapsedSec` counter for
 * "Waiting for Wix… 0:42" (settings §4.2).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
// @ts-ignore -- axios ships its own types in some installs; same import as the legacy panel
import axios from 'axios';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ds/feedback';
import type { WixPollState } from './connectionView';

export const WIX_POLL_MS = 3000;
export const WIX_POLL_MAX = 100; // ~5 min: install + permission consent takes a while

export interface WixInstallPoll {
  state: WixPollState;
  /** Seconds since the current poll started (0 when idle). */
  elapsedSec: number;
  /** Opens the Wix install in a new tab and starts polling. */
  connect: () => Promise<void>;
  /** Restarts polling with the last `since` ("Check again"). */
  checkAgain: () => void;
}

export function useWixInstallPoll(opts: { connected: boolean; onConnected: () => void }): WixInstallPoll {
  const t = useTranslations('settings');
  const toast = useToast();
  const { connected, onConnected } = opts;
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const [wixPoll, setWixPoll] = useState<WixPollState>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const wixSinceRef = useRef<string | null>(null);
  const wixTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWixPoll = useCallback(() => {
    if (wixTimerRef.current) clearInterval(wixTimerRef.current);
    wixTimerRef.current = null;
  }, []);
  useEffect(() => stopWixPoll, [stopWixPoll]); // never leak the interval past unmount

  // If Wix becomes connected some other way (e.g. SWR revalidates on focus after the install finished in the
  // other tab), stop polling and clear the waiting / "didn't finish" box. Keyed on the boolean, and only on a
  // false -> true transition so adding a second site while already connected keeps its poll running.
  const prevWixConnectedRef = useRef(connected);
  useEffect(() => {
    const was = prevWixConnectedRef.current;
    prevWixConnectedRef.current = connected;
    if (!was && connected) {
      stopWixPoll();
      setWixPoll('idle');
    }
  }, [connected, stopWixPoll]);

  // 1s clock for the elapsed counter, only while polling.
  useEffect(() => {
    if (wixPoll !== 'polling') return undefined;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [wixPoll]);

  const startWixPoll = useCallback((since: string | null) => {
    stopWixPoll();
    setWixPoll('polling');
    setStartedAt(Date.now());
    let attempts = 0;
    let inFlight = false;
    const timer = setInterval(async () => {
      // Skip a tick while the previous check is still pending (no overlapping requests / duplicate toasts).
      if (inFlight) return;
      inFlight = true;
      attempts++;
      try {
        // 200 once a Wix site was stored/updated for this user at or after `since`, else 404.
        await axios.post('/api/integrations/wix/callback', { since });
        if (wixTimerRef.current !== timer) return; // poll was stopped/restarted meanwhile
        stopWixPoll();
        setWixPoll('idle');
        toast.success(t('wixConnectedSuccess'));
        onConnectedRef.current();
      } catch (e: unknown) {
        if (wixTimerRef.current !== timer) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401 || attempts >= WIX_POLL_MAX) {
          stopWixPoll();
          setWixPoll('timedOut');
        }
      } finally {
        inFlight = false;
      }
    }, WIX_POLL_MS);
    wixTimerRef.current = timer;
  }, [stopWixPoll, t, toast]);

  const connect = useCallback(async () => {
    try {
      const res = await axios.get('/api/integrations/wix/connect');
      window.open(res.data.installUrl, '_blank');
      toast.info(t('wixInstallOpened'));
      // `since` is server time; only a connection saved after this install started counts.
      wixSinceRef.current = res.data.since || null;
      startWixPoll(wixSinceRef.current);
    } catch {
      toast.error(t('wixConnectFailed'), { persist: false });
    }
  }, [startWixPoll, t, toast]);

  const checkAgain = useCallback(() => startWixPoll(wixSinceRef.current), [startWixPoll]);

  void nowTick; // re-render trigger for the counter
  const elapsedSec = wixPoll === 'polling' && startedAt !== null ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

  return { state: wixPoll, elapsedSec, connect, checkAgain };
}

/** 42 → "0:42", 125 → "2:05". */
export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
