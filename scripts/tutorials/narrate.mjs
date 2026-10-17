// Step 1: Turkish voice-over per step with Gemini TTS, cached by text+voice (re-runs only redo changed lines).
//   GEMINI_API_KEY=... npm run tutorials -- <slug> --only=narrate
//
// Quota: the free Gemini tier allows only ~10 TTS requests per day per model. So uncached lines are voiced in
// batches: one request reads several lines as separate paragraphs with pauses between them, and the audio is
// split back into lines at the longest pauses. If a batch can't be split cleanly (wrong number of pauses, or a
// piece far longer/shorter than its text), its lines fall back to one request each. TTS_BATCH=0 turns batching off.
//
// Preview voice without any quota: TTS_ENGINE=say uses the macOS Turkish voice (Yelda). It is cached under its
// own key, so switching back to Gemini re-voices everything. Use it to check timing and visuals, never to publish.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { CONFIG, WORK, ensure, ffmpeg, durationSec, hash, loadTutorial } from './lib.mjs';
import { judgeTake, isPerfect, score, respell, writeReport } from './voiceQa.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENGINE = process.env.TTS_ENGINE === 'say' ? 'say' : 'gemini';
// Final quality (default with a Pro TTS model): one line per request, transcribe + judge every take, keep the best.
const FINAL = process.env.TTS_QUALITY === 'final' || /pro/.test(CONFIG.ttsModel);
const MAX_TAKES = Number(process.env.TTS_TAKES || 3);
const BATCH = !FINAL && process.env.TTS_BATCH !== '0';
const QA_ROWS = [];
/** Rough upper bound of one batch, in estimated seconds of speech (Gemini caps the length of one answer). */
const BATCH_SEC = Number(process.env.TTS_BATCH_SEC || 180);
const POLISH = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';

const words = (t) => t.split(/\s+/).filter(Boolean).length;
const estSec = (t) => words(t) * 0.62;
/** A take much longer than its text needs usually means extra words (e.g. the instruction read aloud) or long pauses. */
const maxSec = (t) => words(t) * 0.75 + 1.5;

function voiceKey(text) {
  return ENGINE === 'say' ? `say|Yelda|${text}` : `${CONFIG.ttsModel}|${CONFIG.voice}|${CONFIG.voiceStyle}|${text}`;
}

async function tts(ai, prompt) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: CONFIG.ttsModel,
        contents: [{ parts: [{ text: prompt }] }],
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.voice } } } },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('no audio in response');
      return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000) };
    } catch (e) {
      const msg = String(e.message || e);
      // A per-day quota will not come back by waiting a minute: stop and say so.
      if (/PerDay/.test(msg)) {
        const retry = /retry in ([0-9hms.]+)/i.exec(msg)?.[1];
        throw new Error(`Gemini TTS daily quota used up (${CONFIG.ttsModel}); cached lines are kept, re-run after the reset${retry ? ` (in ${retry})` : ''}.`);
      }
      if (attempt === 5 || !/429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|fetch failed/.test(msg)) throw e;
      const wait = 20000 * attempt;
      console.warn(`  TTS retry ${attempt} in ${wait / 1000}s: ${msg.slice(0, 120)}`);
      await sleep(wait);
    }
  }
}

function pcmToWav(pcm, rate, out, filter) {
  const raw = out.replace(/\.wav$/, '.pcm');
  fs.writeFileSync(raw, pcm);
  ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw, ...(filter ? ['-af', filter] : []), '-ar', '48000', out], { quiet: true });
  fs.unlinkSync(raw);
}

/** One line, one request (with retries for overlong takes). */
async function voiceOne(ai, text, file) {
  if (ENGINE === 'say') {
    const aiff = file.replace(/\.wav$/, '.aiff');
    execFileSync('say', ['-v', 'Yelda', '-r', '165', '-o', aiff, text]);
    ffmpeg(['-i', aiff, '-af', POLISH, '-ar', '48000', '-ac', '1', file], { quiet: true });
    fs.unlinkSync(aiff);
    return;
  }
  if (FINAL) return voiceFinal(ai, text, file);
  let best = null;
  for (let take = 1; take <= 3; take++) {
    const { pcm, rate } = await tts(ai, `${CONFIG.voiceStyle}\n\n"${text}"`);
    const out = file.replace(/\.wav$/, `.take${take}.wav`);
    pcmToWav(pcm, rate, out, POLISH);
    const d = durationSec(out);
    if (!best || d < best.d) { if (best) fs.unlinkSync(best.out); best = { out, d }; } else fs.unlinkSync(out);
    if (d <= maxSec(text)) break;
    console.warn(`  take ${take} is ${d.toFixed(1)}s for ${words(text)} words (max ${maxSec(text).toFixed(1)}s), retrying`);
  }
  fs.renameSync(best.out, file);
}

/** Final quality: up to MAX_TAKES takes, each transcribed and judged; mispronounced terms get respelled next take. */
async function voiceFinal(ai, text, file, meta = {}) {
  let best = null;
  let respellTerms = [];
  for (let take = 1; take <= MAX_TAKES; take++) {
    const spoken = respell(text, respellTerms);
    const { pcm, rate } = await tts(ai, `${CONFIG.voiceStyle}\n\n"${spoken}"`);
    const out = file.replace(/\.wav$/, `.take${take}.wav`);
    pcmToWav(pcm, rate, out, POLISH);
    const q = await judgeTake(ai, out, text);
    const tooLong = durationSec(out) > maxSec(text) + 1;
    if (tooLong) q.issues.push('take much longer than the text needs');
    console.log(`    take ${take}: words ${(q.similarity * 100).toFixed(0)}%, natural ${q.natural}/5${q.mispronounced.length ? `, mispronounced ${q.mispronounced.join(', ')}` : ''}${q.issues.length ? `, issues: ${q.issues.join('; ').slice(0, 120)}` : ''}`);
    if (!best || score(q) > score(best.q)) { if (best) fs.unlinkSync(best.out); best = { out, q, take }; } else fs.unlinkSync(out);
    if (isPerfect(q) && !tooLong) break;
    respellTerms = [...new Set([...respellTerms, ...q.mispronounced])];
  }
  fs.renameSync(best.out, file);
  fs.writeFileSync(file.replace(/\.wav$/, '.qa.json'), JSON.stringify({ text, takes: best.take, q: best.q }, null, 2));
  return best.q;
}

/** Silences in a wav as [{ start, end }] (seconds). */
function silences(file, minDur) {
  let log = '';
  try {
    log = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `silencedetect=noise=-40dB:d=${minDur}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }).toString();
  } catch (e) { log = String(e.stderr || ''); }
  const out = [];
  let start = null;
  for (const line of log.split('\n')) {
    const s = /silence_start: ([\d.]+)/.exec(line);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    if (e && start !== null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  return out;
}

/** Several lines in one request; split at the longest pauses. Returns false when the split looks wrong. */
async function voiceBatch(ai, items, dir) {
  const prompt = `${CONFIG.voiceStyle} There are ${items.length} separate paragraphs, each between quotation marks. ` +
    'Read them in order and pause for two full seconds after each paragraph.\n\n' +
    items.map((it) => `"${it.text}"`).join('\n\n');
  const { pcm, rate } = await tts(ai, prompt);
  const whole = path.join(dir, `batch-${hash(prompt)}.wav`);
  pcmToWav(pcm, rate, whole, null);
  const total = durationSec(whole);
  const gaps = silences(whole, 0.45).filter((g) => g.start > 0.3 && g.end < total - 0.3);
  const fail = (why) => { console.warn(`  batch split failed: ${why}; kept ${path.relative(WORK, whole)} for a look`); return false; };
  if (gaps.length < items.length - 1) return fail(`${gaps.length} pauses for ${items.length} lines`);
  const cuts = [...gaps].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, items.length - 1).sort((a, b) => a.start - b.start);
  const bounds = [0, ...cuts.map((g) => (g.start + g.end) / 2), total];
  const pieces = items.map((it, k) => ({ ...it, from: bounds[k], to: bounds[k + 1] }));
  for (const p of pieces) {
    const d = p.to - p.from;
    if (d < estSec(p.text) * 0.45 || d > maxSec(p.text) + 2.5) return fail(`"${p.text.slice(0, 40)}…" got ${d.toFixed(1)}s (expected ~${estSec(p.text).toFixed(1)}s)`);
  }
  for (const p of pieces) {
    ffmpeg(['-ss', p.from.toFixed(3), '-to', p.to.toFixed(3), '-i', whole, '-af', POLISH, '-ar', '48000', '-ac', '1', p.file], { quiet: true });
  }
  fs.unlinkSync(whole);
  return true;
}

function client() {
  if (ENGINE !== 'gemini') return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenAI({ apiKey });
}

function itemsOf(slug) {
  const dir = ensure(path.join(WORK, ENGINE === 'say' ? 'voice-preview' : 'voice'));
  return loadTutorial(slug).steps.map((step, i) => {
    const text = String(step.say || '').trim();
    return { slug, step: i, text, file: text ? path.join(dir, `${hash(voiceKey(text))}.wav`) : null };
  });
}

/** Voice every uncached line in `items`, batching lines (also across tutorials) to save requests. */
async function voicePending(ai, items) {
  const seen = new Set();
  const todo = items.filter((it) => it.file && !fs.existsSync(it.file) && !seen.has(it.file) && seen.add(it.file));
  if (!todo.length) return;
  const dir = path.dirname(todo[0].file);
  console.log(`  voicing ${todo.length} line(s) with ${ENGINE === 'say' ? 'macOS Yelda (PREVIEW ONLY)' : `${CONFIG.ttsModel}/${CONFIG.voice}`}`);
  const batches = [];
  for (const it of todo) {
    const last = batches.at(-1);
    if (BATCH && ENGINE === 'gemini' && last && last.reduce((a, x) => a + estSec(x.text), 0) + estSec(it.text) <= BATCH_SEC) last.push(it);
    else batches.push([it]);
  }
  for (const b of batches) {
    if (b.length > 1 && (await voiceBatch(ai, b, dir))) { console.log(`  batch of ${b.length} lines voiced`); continue; }
    for (const it of b) await voiceOne(ai, it.text, it.file);
  }
}

/** Before narrating several tutorials: voice all their missing lines together (fewer TTS requests). */
export async function prefetchVoices(slugs) {
  const ai = client();
  await voicePending(ai, slugs.flatMap(itemsOf));
}

export async function narrate(slug) {
  const items = itemsOf(slug);
  await voicePending(client(), items);
  const lines = items.map((it) => ({ step: it.step, file: it.file, duration: it.file ? durationSec(it.file) : 0, text: it.text }));
  if (FINAL) {
    for (const it of items) {
      const qa = it.file && it.file.replace(/\.wav$/, '.qa.json');
      if (qa && fs.existsSync(qa)) { const j = JSON.parse(fs.readFileSync(qa, 'utf8')); QA_ROWS.push({ slug, step: it.step, text: it.text, takes: j.takes, q: j.q }); }
    }
    writeReport(path.join(WORK, 'voice-qa.md'), QA_ROWS);
  }
  for (const l of lines) if (l.file && l.duration > maxSec(l.text) + 1) console.warn(`  ⚠ #${l.step + 1} is ${l.duration.toFixed(1)}s for ${words(l.text)} words; check it with verify-voice.mjs`);
  const out = path.join(ensure(path.join(WORK, slug)), 'narration.json');
  fs.writeFileSync(out, JSON.stringify(lines, null, 2));
  console.log(`✓ narration ${slug}: ${lines.reduce((a, l) => a + l.duration, 0).toFixed(1)}s${ENGINE === 'say' ? ' (PREVIEW voice)' : ''}`);
  return lines;
}
