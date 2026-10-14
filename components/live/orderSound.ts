/**
 * New-order chime (owner W6-live). Synthesized with the Web Audio API, so no
 * audio asset ships.
 *
 *   new / test  two quick bright bell tones (E6 -> B6) with a natural decay
 *   cancelled   a softer, lower, descending pair (G5 -> D5), half volume
 *
 * Browsers refuse to start audio until the user interacts with the page.
 * armOrderSound() registers ONE capturing pointerdown/keydown/touchstart
 * listener that creates or resumes the AudioContext on every gesture (Safari
 * re-suspends it after backgrounding), and isSoundArmed() reports whether a
 * chime can play right now.
 *
 * Settings (per browser, every tab): localStorage
 *   kx_order_sound_muted   '1' muted / '0' (default unmuted)
 *   kx_order_sound_volume  0..1 (default 0.7)
 */

export const ORDER_SOUND_MUTED_KEY = 'kx_order_sound_muted';
export const ORDER_SOUND_VOLUME_KEY = 'kx_order_sound_volume';
const DEFAULT_VOLUME = 0.7;
const CHANGE_EVENT = 'kx:order-sound';

export type OrderSoundKind = 'new' | 'cancelled' | 'test';

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let armed = false;
let gestureListenerInstalled = false;
const listeners = new Set<() => void>();

function emitChange() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage: setting lives for this page only */
  }
}

let memMuted: boolean | null = null;
let memVolume: number | null = null;

export function isOrderSoundMuted(): boolean {
  const v = readStorage(ORDER_SOUND_MUTED_KEY);
  if (v === null) return memMuted ?? false;
  return v === '1' || v === 'true';
}

export function setOrderSoundMuted(muted: boolean): void {
  memMuted = muted;
  writeStorage(ORDER_SOUND_MUTED_KEY, muted ? '1' : '0');
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
  emitChange();
}

export function getOrderSoundVolume(): number {
  const raw = readStorage(ORDER_SOUND_VOLUME_KEY);
  const n = raw === null ? memVolume ?? DEFAULT_VOLUME : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, n));
}

export function setOrderSoundVolume(volume: number): void {
  const v = Math.min(1, Math.max(0, Number(volume) || 0));
  memVolume = v;
  writeStorage(ORDER_SOUND_VOLUME_KEY, String(v));
  emitChange();
}

function createContext(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (ctx && ctx.state !== 'closed') return ctx;
  const AC: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    ctx.onstatechange = () => {
      armed = ctx?.state === 'running';
      emitChange();
    };
    return ctx;
  } catch {
    return null;
  }
}

/** Create/resume the AudioContext. Only succeeds inside (or after) a user gesture. */
function ensureRunning(): Ctx | null {
  const c = createContext();
  if (!c) return null;
  if (c.state !== 'running') {
    c.resume()
      .then(() => {
        armed = c.state === 'running';
        emitChange();
      })
      .catch(() => {
        /* still blocked */
      });
  }
  armed = c.state === 'running';
  return c;
}

/** Register the one-time gesture hook. Idempotent; safe to call on every mount. */
export function armOrderSound(): void {
  if (typeof window === 'undefined' || gestureListenerInstalled) return;
  gestureListenerInstalled = true;
  const onGesture = () => {
    if (ctx && ctx.state === 'running') return;
    ensureRunning();
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', onGesture, opts);
  window.addEventListener('keydown', onGesture, opts);
  window.addEventListener('touchstart', onGesture, opts);
  window.addEventListener('storage', (e) => {
    if (e.key === ORDER_SOUND_MUTED_KEY || e.key === ORDER_SOUND_VOLUME_KEY) emitChange();
  });
}

export function isSoundArmed(): boolean {
  return Boolean(ctx && ctx.state === 'running' && armed);
}

/** For useSyncExternalStore: fires on mute/volume/armed changes (any tab). */
export function subscribeOrderSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** One bell strike: fundamental + a few partials, fast attack, exponential decay. */
function strike(c: Ctx, dest: AudioNode, t0: number, freq: number, dur: number, peak: number, partials: Array<[number, number]>) {
  for (const [ratio, amp] of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, t0);
    const p = Math.max(0.0002, peak * amp);
    const end = t0 + dur / (1 + (ratio - 1) * 0.6); // higher partials die faster
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(p, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(end + 0.05);
  }
}

const BRIGHT: Array<[number, number]> = [
  [1, 1],
  [2, 0.32],
  [3.01, 0.12],
  [4.18, 0.05],
];
const SOFT: Array<[number, number]> = [
  [1, 1],
  [2, 0.15],
];

/**
 * Play the chime. Returns false when it could not play (muted, not armed yet,
 * no Web Audio). `force` ignores the mute flag (test button).
 */
export function playOrderSound(kind: OrderSoundKind = 'new', opts: { force?: boolean; volume?: number } = {}): boolean {
  if (typeof window === 'undefined') return false;
  if (!opts.force && kind !== 'test' && isOrderSoundMuted()) return false;
  const c = ensureRunning();
  if (!c) return false;
  if (c.state !== 'running' && kind !== 'test') return false;
  const volume = opts.volume ?? getOrderSoundVolume();
  if (volume <= 0) return false;
  try {
    const master = c.createGain();
    const comp = c.createDynamicsCompressor();
    master.gain.value = Math.min(1, volume) * 0.55;
    master.connect(comp);
    comp.connect(c.destination);
    const t = c.currentTime + 0.02;
    if (kind === 'cancelled') {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(master);
      strike(c, lp, t, 783.99, 0.45, 0.5, SOFT); // G5
      strike(c, lp, t + 0.16, 587.33, 0.6, 0.45, SOFT); // D5
    } else {
      strike(c, master, t, 1318.51, 0.9, 0.9, BRIGHT); // E6
      strike(c, master, t + 0.12, 1975.53, 1.2, 0.8, BRIGHT); // B6
    }
    return true;
  } catch {
    return false;
  }
}
