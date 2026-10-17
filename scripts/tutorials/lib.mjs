// Shared helpers for the tutorial video pipeline (see README.md in this folder).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

export const ROOT = process.cwd();
export const TUT_DIR = path.join(ROOT, 'scripts/tutorials/tutorials');
export const WORK = path.join(ROOT, '.cache/tutorials');           // intermediate files (gitignored)
export const OUT = path.join(ROOT, 'public/media/tutorials');      // final mp4/vtt/jpg (gitignored, uploaded to YouTube)
export const STEPS_IMG = path.join(ROOT, 'public/media/guides');   // per-step screenshots for the written guides (committed)

export const CONFIG = {
  ttsModel: process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts',
  // One consistent voice for every video. Change only with a full re-render.
  voice: process.env.TTS_VOICE || 'Kore',
  voiceStyle: 'Sakin, samimi ve net bir Türkçeyle, bir arkadaşa ekranı gösterir gibi konuş. Acele etme.',
  baseUrl: process.env.TUTORIAL_BASE_URL || 'http://localhost:3100',
  width: 1920,
  height: 1080,
  /** Pause after each narration line (ms). */
  gapMs: 350,
};

export function loadTutorial(slug) {
  const file = path.join(TUT_DIR, `${slug}.yaml`);
  const t = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!t?.slug || !Array.isArray(t.steps)) throw new Error(`${file}: needs slug and steps`);
  return t;
}

export function allSlugs() {
  return fs.readdirSync(TUT_DIR).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();
}

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
export const ensure = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };

export function ffmpeg(args, opts = {}) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: opts.quiet ? 'ignore' : 'inherit' });
}

export function durationSec(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim();
  return Number(out);
}

export function chromePath() {
  return process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
}

export function fontFaceCss() {
  const u = (f) => `"file://${encodeURI(path.join(ROOT, '.cache/fonts', f))}"`;
  return `@font-face{font-family:Fraunces;src:url(${u('Fraunces.ttf')});font-weight:100 900}
@font-face{font-family:Instrument;src:url(${u('InstrumentSans.ttf')});font-weight:400 700}`;
}

export function fmtVttTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
}
