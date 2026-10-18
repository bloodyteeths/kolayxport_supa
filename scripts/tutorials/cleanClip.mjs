// Remove the voice model's edge artefacts from a narration clip, in place.
// Gemini TTS clips start with a ~10 ms click and end with a ~130 ms burst of loud static after a short pause;
// loudnorm then made the burst louder than the voice. We find the sound segments (10 ms frames, -45 dB) and
// drop a first segment shorter than 40 ms and a last segment shorter than 250 ms that follows a pause of at
// least 120 ms. Real words are never that short after a pause; the final word is part of the speech segment.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SR = 48000;
const FRAME = SR / 100; // 10 ms
const THRESH_DB = -45;

function decode(file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

export function segments(samples) {
  const on = [];
  for (let i = 0; i < samples.length; i += FRAME) {
    let sum = 0; const end = Math.min(samples.length, i + FRAME);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    on.push(20 * Math.log10(rms / 32768 + 1e-9) > THRESH_DB);
  }
  const segs = [];
  for (let i = 0; i < on.length;) {
    if (!on[i]) { i++; continue; }
    let j = i; while (j < on.length && on[j]) j++;
    const prev = segs[segs.length - 1];
    if (prev && (i - prev.to) < 12) prev.to = j; // merge gaps under 120 ms
    else segs.push({ from: i, to: j });
    i = j;
  }
  return segs.map((s) => ({ from: s.from / 100, to: s.to / 100 }));
}

/** Seconds [start, end] of the real speech, or null when nothing needs trimming. */
export function speechWindow(segs) {
  if (!segs.length) return null;
  let a = 0, b = segs.length - 1;
  if (b > a && segs[a].to - segs[a].from < 0.04) a++;
  if (b > a && segs[b].to - segs[b].from < 0.25 && segs[b].from - segs[b - 1].to >= 0.12) b--;
  if (a === 0 && b === segs.length - 1) return null;
  return { start: Math.max(0, segs[a].from - 0.03), end: segs[b].to + 0.08 };
}

/** Trim the artefacts in place. Returns true when the clip changed. */
export function cleanClip(file) {
  const win = speechWindow(segments(decode(file)));
  if (!win) return false;
  const tmp = file.replace(/\.wav$/, '.clean.wav');
  const len = win.end - win.start;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', win.start.toFixed(3), '-t', len.toFixed(3), '-i', file,
    '-af', `afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, len - 0.04).toFixed(3)}:d=0.04`, '-ar', String(SR), '-ac', '1', tmp]);
  fs.renameSync(tmp, file);
  return true;
}
