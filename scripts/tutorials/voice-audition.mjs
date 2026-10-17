// Voice audition: the same Turkish line read by several Gemini voices, so a human picks the narrator by ear.
//   GEMINI_API_KEY=<billed key> node scripts/tutorials/voice-audition.mjs
// Writes .cache/tutorials/audition/<voice>.mp3. Then set TTS_VOICE=<name> (lib.mjs default) and render.
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { CONFIG, WORK, ensure, ffmpeg } from './lib.mjs';

const VOICES = (process.env.VOICES || 'Kore,Leda,Aoede,Sulafat,Charon,Iapetus').split(',');
const LINE = process.env.LINE || "Merhaba! Bu videoda Etsy mağazanızı KolayXport'a bağlayacağız. Siparişleriniz, eBay ve Trendyol ilanlarınızla birlikte tek panelde olacak; FedEx ya da UPS etiketinizi ve ETGB dosyanızı da buradan hazırlayacaksınız.";
const MODEL = process.env.TTS_MODEL || 'gemini-2.5-pro-preview-tts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const dir = ensure(path.join(WORK, 'audition'));
for (const voice of VOICES) {
  const r = await ai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ text: `${CONFIG.voiceStyle}\n\n"${LINE}"` }] }],
    config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  });
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) { console.error('no audio for', voice); continue; }
  const raw = path.join(dir, `${voice}.pcm`);
  fs.writeFileSync(raw, Buffer.from(part.inlineData.data, 'base64'));
  ffmpeg(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-b:a', '128k', path.join(dir, `${voice}.mp3`)], { quiet: true });
  fs.unlinkSync(raw);
  console.log('✓', voice);
}
