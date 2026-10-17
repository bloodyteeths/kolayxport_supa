// Listen-check without listening: transcribe each narration line with a Gemini text model and compare it with
// the script. Flags lines with missing or extra words (e.g. the TTS read its delivery instruction aloud).
//   GEMINI_API_KEY=... node scripts/tutorials/verify-voice.mjs <slug> [<slug>…]      (or: all)
// Needs narration.json from the narrate step. Uses gemini-2.5-flash (a separate quota from TTS).
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { WORK, allSlugs } from './lib.mjs';

const MODEL = process.env.STT_MODEL || 'gemini-2.5-flash';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Compare loosely: lower case, Turkish letters folded, no punctuation; "KolayXport" may come back as "Kolay Export".
const norm = (s) => s.toLocaleLowerCase('tr').replace(/kolay\s*e?xport/g, 'kolayxport').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

function similarity(a, b) {
  // Word-level LCS ratio against the longer of the two.
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n] / Math.max(m, n, 1);
}

async function transcribe(ai, file) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents: [{ parts: [
          { inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(file).toString('base64') } },
          { text: 'Transcribe this Turkish speech verbatim. Output only the words that are spoken.' },
        ] }],
      });
      return String(r.text || '').trim();
    } catch (e) {
      if (attempt === 4 || !/429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(String(e.message))) throw e;
      await sleep(15000 * attempt);
    }
  }
}

const args = process.argv.slice(2);
const slugs = args.includes('all') || !args.length ? allSlugs() : args;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let bad = 0;
for (const slug of slugs) {
  const file = path.join(WORK, slug, 'narration.json');
  if (!fs.existsSync(file)) { console.log(`- ${slug}: no narration.json`); continue; }
  for (const l of JSON.parse(fs.readFileSync(file, 'utf8')).filter((x) => x.file)) {
    const heard = await transcribe(ai, l.file);
    const score = similarity(norm(l.text), norm(heard));
    const ok = score >= 0.8;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${slug} #${l.step + 1} ${l.duration.toFixed(1)}s ${(score * 100).toFixed(0)}%${ok ? '' : `\n    script: ${l.text}\n    heard:  ${heard}\n    file:   ${path.relative(process.cwd(), l.file)}`}`);
    await sleep(6500); // free tier: 10 requests per minute
  }
}
if (bad) { console.error(`\n${bad} line(s) differ from the script. Delete their wav in .cache/tutorials/voice/ and re-narrate.`); process.exit(1); }
console.log('\nAll lines match the script.');
