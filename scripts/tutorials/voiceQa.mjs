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

const norm = (s) => s.toLocaleLowerCase('tr').replace(/kolay\s*e[kx]s?port/g, 'kolayxport').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

function lcsRatio(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n] / Math.max(m, n, 1);
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
export async function judgeTake(ai, wavFile, script) {
  const terms = termsIn(script);
  const audio = fs.readFileSync(wavFile).toString('base64');
  const [transcript, a, b] = await Promise.all([transcribe(ai, audio), listen(ai, audio, script, terms), listen(ai, audio, script, terms)]);
  const list = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
  const mis = list(a.mispronounced).filter((t) => terms.includes(t) && list(b.mispronounced).includes(t));
  const both = list(a.issues).length && list(b.issues).length ? [...list(a.issues), ...list(b.issues)] : [];
  const similarity = lcsRatio(norm(script), norm(transcript));
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
