// Final-quality voice-over: pronunciation guide, per-take transcription + judging, best-take selection.
// Used by narrate.mjs when TTS_QUALITY=final (the default with the Pro TTS model).
import fs from 'node:fs';
import path from 'node:path';

/**
 * How brand and trade terms must sound in Turkish narration. `say` is the respelling sent to TTS only when a
 * take got the term wrong (subtitles always keep the real spelling).
 */
export const PRONUNCIATION = {
  KolayXport: { sound: 'ko-LAY eks-port (Kolay + export)', say: 'Kolay Eksport' },
  eBay: { sound: 'i-bey', say: 'iibey' },
  Etsy: { sound: 'et-si', say: 'Etsi' },
  FedEx: { sound: 'fed-eks', say: 'Fedeks' },
  UPS: { sound: 'yu-pi-es (letters, English)', say: 'Yu Pi Es' },
  DHL: { sound: 'de-ha-le (Turkish letters)', say: 'De Ha Le' },
  ETGB: { sound: 'e-te-ge-be (Turkish letters)', say: 'E Te Ge Be' },
  'e-Arşiv': { sound: 'e-arşiv', say: 'e arşiv' },
  'e-Fatura': { sound: 'e-fatura', say: 'e fatura' },
  Paraşüt: { sound: 'pa-ra-şüt', say: 'Paraşüt' },
  Trendyol: { sound: 'trend-yol', say: 'Trendyol' },
  Shopify: { sound: 'şo-pi-fay', say: 'Şopifay' },
  Wix: { sound: 'viks', say: 'Viks' },
  Amazon: { sound: 'a-ma-zon', say: 'Amazon' },
  Chrome: { sound: 'krom', say: 'Krom' },
  SKU: { sound: 'es-ka-u (Turkish letters) or "stok kodu"', say: 'stok kodu' },
  CSV: { sound: 'ce-se-ve (Turkish letters)', say: 'Ce Se Ve' },
  GTİP: { sound: 'ge-ti-pe or "gitip"', say: 'GTİP' },
  SEO: { sound: 'se-o', say: 'Se O' },
  Pro: { sound: 'pro', say: 'Pro' },
};

export function termsIn(text) {
  return Object.keys(PRONUNCIATION).filter((t) => new RegExp(`(^|[^\\p{L}])${t}($|[^\\p{L}])`, 'u').test(text));
}

/** TTS text with the given terms respelled (only terms a previous take got wrong). */
export function respell(text, terms) {
  let out = text;
  for (const t of terms) out = out.split(t).join(PRONUNCIATION[t].say);
  return out;
}

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
/** 0–9999 as Turkish words, so "13" in a transcript matches "on üç" in the script. */
function numTr(n) {
  if (n === 0) return 'sıfır';
  const th = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return [th ? (th === 1 ? 'bin' : `${ONES[th]} bin`) : '', h ? (h === 1 ? 'yüz' : `${ONES[h]} yüz`) : '', TENS[t], ONES[o]].filter(Boolean).join(' ');
}

/**
 * Comparable letters only: lowercase, numbers spelled out, %10 = "yüzde on", no accents, no spaces or
 * punctuation. Comparing letters instead of words means spelling variants of the same sound
 * ("filtresiyle" / "filtresi ile", "pazaryeri" / "pazar yeri") don't count as errors, while a wrong or
 * missing word ("H'de" for "Etsy'de") still does.
 */
const norm = (s) => s.toLocaleLowerCase('tr')
  .replace(/%\s*(\d+)/g, (_, d) => `yüzde ${d}`)
  .replace(/\d{1,4}/g, (d) => ` ${numTr(Number(d))} `)
  .replace(/kolay\s*e[kx]s?port/g, 'kolayxport')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
  .replace(/[^a-z]/g, '');

function lcsRatio(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[n] / Math.max(m, n, 1);
}

/** Brand terms in the script whose letters don't appear in the transcript (garbled or dropped). */
export function missingTerms(script, transcript) {
  const t = norm(transcript);
  return termsIn(script).filter((term) => !t.includes(norm(term)) && !t.includes(norm(PRONUNCIATION[term].say)));
}

/** Similarity of a transcript to the script, also accepting the respelled text that was actually sent to TTS. */
export function wordMatch(script, transcript, spoken = script) {
  const t = norm(transcript);
  return Math.max(lcsRatio(norm(script), t), spoken === script ? 0 : lcsRatio(norm(spoken), t));
}

/**
 * Transcribe + judge one take with a Gemini audio-understanding model.
 * Returns { transcript, similarity, mispronounced: [term], issues: [text], natural: 1-5 }.
 */
async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= 5 || !/429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|JSON/.test(String(e.message || e))) throw e;
      await new Promise((r) => setTimeout(r, 6000 * attempt));
    }
  }
}

/** Verbatim transcript from the dedicated transcription model (deterministic word check). */
async function transcribe(ai, audio) {
  const model = process.env.STT_MODEL || 'gemini-3.5-transcribe';
  return withRetry(async () => {
    const r = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }, { text: 'Transcribe this Turkish audio verbatim. Output only the words that are spoken, nothing else.' }] }],
      config: { temperature: 0 },
    });
    // The transcription model returns its words in an `audioTranscription` part, not as text.
    const parts = r.candidates?.[0]?.content?.parts || [];
    const fromParts = parts.map((p) => p.text || p.audioTranscription?.text || (typeof p.audioTranscription === 'string' ? p.audioTranscription : '')).join(' ');
    return String(fromParts || r.text || '').replace(/\s+/g, ' ').trim();
  });
}

/** Pronunciation + naturalness opinion from an audio-understanding model. */
async function listen(ai, audio, script, terms) {
  const model = process.env.JUDGE_MODEL || 'gemini-flash-latest';
  const guide = terms.map((t) => `- ${t}: ${PRONUNCIATION[t].sound}`).join('\n') || '(none)';
  const prompt = `You are a strict Turkish voice-over director. Listen carefully to the audio.
Script: """${script}"""
Expected pronunciation:
${guide}
Judge ONLY what you actually hear. Return JSON only:
{"mispronounced": ["<term from the list pronounced wrongly>"], "issues": ["<audible problem: wrong stress, unnatural pause, robotic intonation, English accent on Turkish words>"], "natural": <1-5>}`;
  return withRetry(async () => {
    const r = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }, { text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    });
    return JSON.parse(r.text || '{}');
  });
}

/**
 * Transcribe + judge one take. Words come from the transcription model; pronunciation/naturalness from two
 * independent listens — a term counts as mispronounced or an issue counts only when BOTH listens report it
 * (one listen alone was seen re-scoring identical audio differently).
 */
export async function judgeTake(ai, wavFile, script, spoken = script) {
  const terms = termsIn(script);
  const audio = fs.readFileSync(wavFile).toString('base64');
  const [transcript, a, b] = await Promise.all([transcribe(ai, audio), listen(ai, audio, script, terms), listen(ai, audio, script, terms)]);
  const list = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
  const mis = list(a.mispronounced).filter((t) => terms.includes(t) && list(b.mispronounced).includes(t));
  const both = list(a.issues).length && list(b.issues).length ? [...list(a.issues), ...list(b.issues)] : [];
  const similarity = wordMatch(script, transcript, spoken);
  if (similarity < 0.97) both.unshift(`words: ${(similarity * 100).toFixed(0)}% match (heard: "${transcript.slice(0, 160)}")`);
  return { transcript, similarity, mispronounced: mis, issues: both, natural: Math.min(Number(a.natural) || 0, Number(b.natural) || 0) };
}

/** A take is final when every word is there, every term sounds right and it sounds natural. */
export function isPerfect(q) {
  return q.similarity >= 0.97 && q.mispronounced.length === 0 && q.natural >= 4 && q.issues.length === 0;
}

export function score(q) {
  return q.similarity * 10 + q.natural - q.mispronounced.length * 2 - q.issues.length * 0.5;
}

export function writeReport(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const md = ['# Voice-over QA report', '', `Generated ${new Date().toISOString()}. Every line was transcribed and judged by Gemini; ✅ = all words present, every brand term pronounced as specified, natural ≥ 4/5, no issues.`, '',
    '| Tutorial | # | Takes | Words | Natural | Terms | Issues | Line |', '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.slug} | ${r.step + 1} | ${r.takes} | ${(r.q.similarity * 100).toFixed(0)}% | ${r.q.natural}/5 | ${r.q.mispronounced.join(', ') || '—'} | ${r.q.issues.join('; ').replace(/\|/g, '/') || '—'} | ${isPerfect(r.q) ? '✅' : '⚠️'} ${r.text.replace(/\|/g, '/').slice(0, 80)} |`)];
  fs.writeFileSync(file, md.join('\n') + '\n');
}
