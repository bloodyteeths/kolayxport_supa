// Step 3: assemble the final videos with ffmpeg.
//   node scripts/tutorials/compose.mjs <slug>
// Outputs (public/media/tutorials/): <slug>.mp4 (16:9, 1080p), <slug>-vertical.mp4 (9:16 for Reels/Shorts/TikTok,
// captions burned in), <slug>.tr.vtt (subtitles), <slug>.jpg (poster).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { CONFIG, OUT, WORK, ROOT, ensure, ffmpeg, loadTutorial, chromePath, fontFaceCss, fmtVttTime } from './lib.mjs';

const INTRO = 2.6;
const OUTRO = 3.2;
// Vertical (9:16) layout: crop width of the recording, where the video sits, where captions start.
const V_CROP_W = 1280;
const V_VIDEO_Y = 520;                                  // 1280×1080 → 1080×911, so the video ends at y≈1431
const V_CAPTION_Y = 1460;
const C = { ink: '#0E1A2B', paper: '#FAF7F0', accent: '#2B45E0', soft: '#8EA0FF' };

const logo = (dark) => fs.readFileSync(path.join(ROOT, 'public/brand', dark ? 'kolayxport-logo-dark.svg' : 'kolayxport-logo.svg'), 'utf8');

function card({ w, h, eyebrow, title, sub, dark = true }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${fontFaceCss()}
*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;background:${dark ? C.ink : C.paper};color:${dark ? C.paper : C.ink};font-family:Instrument,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 ${Math.round(w * 0.08)}px;position:relative;overflow:hidden;
background-image:repeating-linear-gradient(0deg,transparent 0 47px,rgba(250,247,240,.05) 47px 48px)}
.ring{position:absolute;right:-${Math.round(w * .08)}px;top:-${Math.round(w * .08)}px;width:${Math.round(w * .4)}px;height:${Math.round(w * .4)}px;border-radius:50%;border:3px dashed rgba(142,160,255,.35)}
.logo svg{height:${Math.round(h * .07)}px;width:auto}
.eyebrow{margin-top:${Math.round(h * .06)}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${C.soft};font-size:${Math.round(h * .028)}px}
h1{font-family:Fraunces;font-variation-settings:'opsz' 96,'SOFT' 100;font-weight:600;font-size:${Math.round(h * (w > h ? .085 : .05))}px;line-height:1.05;letter-spacing:-.02em;margin-top:${Math.round(h * .02)}px;max-width:${Math.round(w * .84)}px}
.sub{margin-top:${Math.round(h * .03)}px;font-size:${Math.round(h * .03)}px;opacity:.8;max-width:${Math.round(w * .8)}px;line-height:1.35}
</style></head><body><div class="ring"></div><div class="logo">${logo(dark)}</div>
${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</body></html>`;
}

function captionHtml(text, w) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()}
*{margin:0}body{width:${w}px;background:transparent;font-family:Instrument,sans-serif;display:flex;justify-content:center}
p{max-width:${w - 120}px;background:rgba(14,26,43,.92);color:#FAF7F0;font-size:40px;line-height:1.28;font-weight:600;padding:20px 28px;border-radius:24px;text-align:center}
</style></head><body><p>${text}</p></body></html>`;
}

async function renderPng(browser, html, w, h, out, transparent = false) {
  // Captions (h = 0) are cropped to the <p>; give them a tall viewport so the element is fully on screen.
  const page = await browser.newPage({ viewport: { width: w, height: h || 800 } });
  const tmp = path.join(WORK, `tmp-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + encodeURI(tmp));
  await page.evaluate(() => document.fonts.ready);
  if (h) await page.screenshot({ path: out, omitBackground: transparent });
  else await page.locator('p').screenshot({ path: out, omitBackground: true });
  fs.unlinkSync(tmp);
  await page.close();
}

export async function compose(slug) {
  const t = loadTutorial(slug);
  const work = path.join(WORK, slug);
  const tl = JSON.parse(fs.readFileSync(path.join(work, 'timeline.json'), 'utf8'));
  const narration = JSON.parse(fs.readFileSync(path.join(work, 'narration.json'), 'utf8'));
  ensure(OUT);
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--allow-file-access-from-files'] });
  const intro = path.join(work, 'intro.png'), outro = path.join(work, 'outro.png');
  const introV = path.join(work, 'intro-v.png'), outroV = path.join(work, 'outro-v.png'), frameV = path.join(work, 'frame-v.png');
  await renderPng(browser, card({ w: 1920, h: 1080, eyebrow: 'Nasıl kullanılır', title: t.title }), 1920, 1080, intro);
  await renderPng(browser, card({ w: 1920, h: 1080, eyebrow: '14 gün ücretsiz · Kredi kartı gerekmez', title: 'kolayxport.com', sub: t.outro || 'Yurt dışına satışın tek paneli.' }), 1920, 1080, outro);
  await renderPng(browser, card({ w: 1080, h: 1920, eyebrow: 'Nasıl kullanılır', title: t.title }), 1080, 1920, introV);
  await renderPng(browser, card({ w: 1080, h: 1920, eyebrow: '14 gün ücretsiz', title: 'kolayxport.com', sub: t.outro || 'Yurt dışına satışın tek paneli.' }), 1080, 1920, outroV);
  await renderPng(browser, `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()}*{margin:0}body{width:1080px;height:1920px;background:${C.ink};background-image:repeating-linear-gradient(0deg,transparent 0 47px,rgba(250,247,240,.05) 47px 48px);font-family:Instrument,sans-serif;color:${C.paper}}
.top{position:absolute;top:110px;left:70px;right:70px}.top svg{height:60px;width:auto}h1{font-family:Fraunces;font-variation-settings:'opsz' 96,'SOFT' 100;font-weight:600;font-size:64px;line-height:1.08;margin-top:40px;letter-spacing:-.02em}</style></head>
<body><div class="top">${logo(true)}<h1>${t.title}</h1></div></body></html>`, 1080, 1920, frameV);
  const caps = [];
  for (const [i, n] of narration.entries()) {
    if (!n.text) continue;
    const file = path.join(work, `cap-${i}.png`);
    await renderPng(browser, captionHtml(n.text, 1080), 1080, 0, file, true);
    caps.push({ file, start: INTRO + tl.steps[i].voiceStart, end: INTRO + tl.steps[i].end });
  }
  await browser.close();

  const mainDur = tl.steps.at(-1).end + 0.6;
  const total = INTRO + mainDur + OUTRO;

  // Narration track: each line at its recorded step start (+ intro).
  const voiced = narration.filter((n) => n.file);
  const audioIn = voiced.flatMap((n) => ['-i', n.file]);
  const delays = voiced.map((n, k) => `[${k}:a]adelay=${Math.round((INTRO + tl.steps[n.step].voiceStart) * 1000)}:all=1[a${k}]`).join(';');
  const mix = `${delays};${voiced.map((_, k) => `[a${k}]`).join('')}amix=inputs=${voiced.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)}[aout]`;
  const voice = path.join(work, 'voice.m4a');
  ffmpeg([...audioIn, '-filter_complex', mix, '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', voice], { quiet: true });

  // 16:9
  const main169 = path.join(OUT, `${slug}.mp4`);
  ffmpeg([
    '-loop', '1', '-t', String(INTRO), '-i', intro,
    '-ss', tl.trimStart.toFixed(3), '-t', mainDur.toFixed(3), '-i', tl.raw,
    '-loop', '1', '-t', String(OUTRO), '-i', outro,
    '-i', voice,
    '-filter_complex',
    `[0:v]scale=1920:1080,fps=30,format=yuv420p,fade=t=out:st=${INTRO - 0.4}:d=0.4[i];` +
    `[1:v]scale=1920:1080,fps=30,format=yuv420p[m];` +
    `[2:v]scale=1920:1080,fps=30,format=yuv420p,fade=t=in:st=0:d=0.4[o];` +
    `[i][m][o]concat=n=3:v=1:a=0[v]`,
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-movflags', '+faststart', '-c:a', 'copy', '-shortest', main169,
  ]);

  // 9:16: brand frame for the whole duration, the 16:9 recording in the middle (after the intro),
  // captions burned in below it, intro/outro cards on top at the ends.
  const vertical = path.join(OUT, `${slug}-vertical.mp4`);
  const capInputs = caps.flatMap((c) => ['-i', c.file]);
  const capBase = 4;
  // The whole 1920×1080 frame scaled to phone width is unreadable, so the vertical cut follows the action:
  // per step, a 1280×1080 window centred on where the cursor ends up in that step (timeline focus.x), scaled
  // to 1080 wide (1080×911). `t` in the crop expression is the recording's own time after the -ss trim.
  const cropX = (fx) => Math.round(Math.min(Math.max(fx - V_CROP_W / 2, 0), 1920 - V_CROP_W));
  const xs = tl.steps.map((st) => ({ at: st.start, x: cropX(st.focus?.x ?? 960) }));
  let xExpr = String(xs.at(-1).x);
  for (let k = xs.length - 2; k >= 0; k--) xExpr = `if(lt(t\\,${xs[k + 1].at.toFixed(2)})\\,${xs[k].x}\\,${xExpr})`;
  let chain = `[1:v]fps=30,crop=${V_CROP_W}:1080:x='${xExpr}':y=0,scale=1080:-2,setpts=PTS-STARTPTS+${INTRO}/TB[vid];[0:v]fps=30[bg];[bg][vid]overlay=0:${V_VIDEO_Y}:eof_action=pass[b0]`;
  caps.forEach((c, k) => {
    chain += `;[b${k}][${capBase + k}:v]overlay=(W-w)/2:${V_CAPTION_Y}:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[b${k + 1}]`;
  });
  chain += `;[b${caps.length}][2:v]overlay=0:0:enable='lt(t,${INTRO})'[x1];[x1][3:v]overlay=0:0:enable='gte(t,${(INTRO + mainDur).toFixed(2)})',format=yuv420p[v]`;
  ffmpeg([
    '-loop', '1', '-t', total.toFixed(2), '-i', frameV,
    '-ss', tl.trimStart.toFixed(3), '-t', mainDur.toFixed(3), '-i', tl.raw,
    '-loop', '1', '-t', total.toFixed(2), '-i', introV,
    '-loop', '1', '-t', total.toFixed(2), '-i', outroV,
    ...capInputs,
    '-i', voice,
    '-filter_complex', chain,
    '-map', '[v]', '-map', `${capBase + caps.length}:a`, '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', '-c:a', 'copy', vertical,
  ]);

  // Subtitles + poster
  const vtt = ['WEBVTT', ''];
  for (const c of caps) {
    const i = Number(path.basename(c.file).match(/cap-(\d+)/)[1]);
    vtt.push(`${fmtVttTime(c.start)} --> ${fmtVttTime(c.end)}`, narration[i].text, '');
  }
  fs.writeFileSync(path.join(OUT, `${slug}.tr.vtt`), vtt.join('\n'));
  ffmpeg(['-ss', (INTRO + mainDur / 2).toFixed(2), '-i', main169, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${slug}.jpg`)], { quiet: true });
  fs.writeFileSync(path.join(work, 'chapters.json'), JSON.stringify(t.steps.map((s, i) => ({ title: s.title, at: INTRO + tl.steps[i].start })).filter((c) => c.title), null, 2));
  console.log(`✓ composed ${slug}: ${total.toFixed(1)}s → ${path.relative(ROOT, main169)}, ${path.relative(ROOT, vertical)}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  compose(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });
}
