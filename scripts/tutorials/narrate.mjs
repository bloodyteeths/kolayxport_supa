// Step 1: Turkish voice-over per step with Gemini TTS, cached by text+voice (re-runs only redo changed lines).
//   GEMINI_API_KEY=... node scripts/tutorials/narrate.mjs <slug>
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { CONFIG, WORK, ensure, ffmpeg, durationSec, hash, loadTutorial } from './lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tts(ai, text) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: CONFIG.ttsModel,
        contents: [{ parts: [{ text: `${CONFIG.voiceStyle}\n\n${text}` }] }],
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.voice } } } },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('no audio in response');
      return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000) };
    } catch (e) {
      const msg = String(e.message || e);
      if (attempt === 5 || !/429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|fetch failed/.test(msg)) throw e;
      const wait = 15000 * attempt;
      console.warn(`  TTS retry ${attempt} in ${wait / 1000}s: ${msg.slice(0, 120)}`);
      await sleep(wait);
    }
  }
}

export async function narrate(slug) {
  const t = loadTutorial(slug);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });
  const dir = ensure(path.join(WORK, 'voice'));
  const lines = [];
  for (const [i, step] of t.steps.entries()) {
    const text = String(step.say || '').trim();
    if (!text) { lines.push({ step: i, file: null, duration: 0, text: '' }); continue; }
    const file = path.join(dir, `${hash(`${CONFIG.ttsModel}|${CONFIG.voice}|${CONFIG.voiceStyle}|${text}`)}.wav`);
    if (!fs.existsSync(file)) {
      console.log(`  voice ${slug} #${i + 1}: ${text.slice(0, 60)}…`);
      const { pcm, rate } = await tts(ai, text);
      const raw = file.replace(/\.wav$/, '.pcm');
      fs.writeFileSync(raw, pcm);
      ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', file], { quiet: true });
      fs.unlinkSync(raw);
    }
    lines.push({ step: i, file, duration: durationSec(file), text });
  }
  const out = path.join(ensure(path.join(WORK, slug)), 'narration.json');
  fs.writeFileSync(out, JSON.stringify(lines, null, 2));
  console.log(`✓ narration ${slug}: ${lines.reduce((a, l) => a + l.duration, 0).toFixed(1)}s`);
  return lines;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  narrate(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });
}
