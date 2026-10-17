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
  return Object.keys(PRONUNCIATION).filter((t) => new RegExp(`(^|[^\\p{L}])${t.replace(/[-]/g, '\\-')}($|[^\\p{L}])`, 'u').test(text));
}

/** TTS text with the given terms respelled (only terms a previous take got wrong). */
export function respell(text, terms) {
  let out = text;
  for (const t of terms) out = out.replace(new RegExp(t.replace(/[-]/g, '\\-'), 'g'), PRONUNCIATION[t].say);
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
export async function judgeTake(ai, wavFile, script, model = process.env.STT_MODEL || 'gemini-2.5-flash') {
  const terms = termsIn(script);
  const guide = terms.map((t) => `- ${t}: ${PRONUNCIATION[t].sound}`).join('\n') || '(none)';
  const prompt = `You are a strict Turkish voice-over director. Listen to the audio.
Script (Turkish): """${script}"""
Expected pronunciation of these terms:
${guide}
Return JSON only:
{"transcript": "<exact words you hear, Turkish spelling>",
 "mispronounced": ["<term from the list that was pronounced wrongly>"],
 "issues": ["<any other problem: missing/extra/garbled words, wrong stress, unnatural pause, robotic intonation, English accent on Turkish words, instruction read aloud>"],
 "natural": <1-5, 5 = sounds like a natural native Turkish narrator>}`;
  const audio = fs.readFileSync(wavFile).toString('base64');
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }, { text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      const j = JSON.parse(r.text || '{}');
      const transcript = String(j.transcript || '');
      return {
        transcript,
        similarity: lcsRatio(norm(script), norm(transcript)),
        mispronounced: (Array.isArray(j.mispronounced) ? j.mispronounced : []).filter((t) => terms.includes(t)),
        issues: Array.isArray(j.issues) ? j.issues.map(String).filter(Boolean) : [],
        natural: Number(j.natural) || 0,
      };
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 8000 * attempt));
    }
  }
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
