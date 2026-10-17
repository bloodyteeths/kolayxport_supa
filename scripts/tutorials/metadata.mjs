// Step 4: YouTube upload metadata + the written guide page for the site, from the same tutorial YAML.
//   node scripts/tutorials/metadata.mjs <slug>
// Writes public/media/tutorials/<slug>.youtube.txt and content/tr/guides/<slug>.md (keeps a youtubeId already set).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { OUT, WORK, ROOT, STEPS_IMG, ensure, loadTutorial } from './lib.mjs';

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function metadata(slug) {
  const t = loadTutorial(slug);
  const chaptersFile = path.join(WORK, slug, 'chapters.json');
  const chapters = fs.existsSync(chaptersFile) ? JSON.parse(fs.readFileSync(chaptersFile, 'utf8')) : [];
  const siteUrl = `https://kolayxport.com/nasil-kullanirim/${slug}`;

  // YouTube: chapters must start at 0:00 and be ≥10s apart.
  const yt = [{ title: 'Giriş', at: 0 }, ...chapters].filter((c, i, arr) => i === 0 || c.at - arr[i - 1].at >= 10);
  ensure(OUT);
  fs.writeFileSync(path.join(OUT, `${slug}.youtube.txt`), [
    `TITLE: ${t.youtubeTitle || `${t.title} | KolayXport`}`.slice(0, 107),
    '',
    'DESCRIPTION:',
    t.description,
    '',
    `Adım adım yazılı rehber: ${siteUrl}?utm_source=youtube&utm_medium=video&utm_campaign=tutorials&utm_content=${slug}`,
    `14 gün ücretsiz deneyin (kredi kartı gerekmez): https://kolayxport.com/login?mode=signup&utm_source=youtube&utm_medium=video&utm_campaign=tutorials&utm_content=${slug}`,
    '',
    'Bölümler:',
    ...yt.map((c) => `${mmss(c.at)} ${c.title}`),
    '',
    '"Etsy" terimi Etsy, Inc.\'in ticari markasıdır. Bu uygulama Etsy API\'sini kullanır ancak Etsy, Inc. tarafından onaylanmamıştır.',
    '',
    `TAGS: ${(t.tags || []).concat(['KolayXport', 'e-ihracat', 'mikro ihracat']).join(', ')}`,
    `PLAYLIST: KolayXport Nasıl Kullanılır`,
    `CAPTIONS: ${slug}.tr.vtt (Türkçe)`,
    `THUMBNAIL: ${slug}.jpg`,
    `VERTICAL CUT (Shorts/Reels/TikTok): ${slug}-vertical.mp4`,
  ].join('\n'));

  // Guide page
  const guideFile = path.join(ROOT, 'content/tr/guides', `${slug}.md`);
  let existing = {};
  if (fs.existsSync(guideFile)) {
    const m = fs.readFileSync(guideFile, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (m) existing = yaml.load(m[1]) || {};
  }
  const imgDir = path.join(STEPS_IMG, slug);
  const imgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((f) => f.endsWith('.webp')).sort() : [];
  let n = 0;
  const steps = t.steps.filter((s) => s.title).map((s) => {
    const img = imgs[n++];
    return { name: s.title, text: String(s.guide || s.say).trim(), ...(img ? { image: `media/guides/${slug}/${img}` } : {}) };
  });
  const totalSec = chapters.length ? Math.ceil((chapters.at(-1).at + 15)) : null;
  const meta = {
    title: `${t.title} | KolayXport`.slice(0, 60),
    description: t.description.slice(0, 155),
    h1: t.title,
    keyword: t.keyword || '',
    updated: new Date().toISOString().slice(0, 10),
    inventoryRefs: t.inventoryRefs || [],
    draft: false,
    order: t.order ?? 99,
    duration: t.duration || (totalSec ? `PT${Math.floor(totalSec / 60)}M${totalSec % 60}S` : 'PT2M'),
    video: { file: slug, youtubeId: existing?.video?.youtubeId || '', ...(existing?.video?.uploadDate ? { uploadDate: existing.video.uploadDate } : {}) },
    steps,
    ...(t.faq ? { faq: t.faq } : {}),
  };
  const body = t.body ? `\n${t.body.trim()}\n` : '\n';
  ensure(path.dirname(guideFile));
  fs.writeFileSync(guideFile, `---\n${yaml.dump(meta, { lineWidth: 120 })}---\n${body}`);
  console.log(`✓ metadata ${slug}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) metadata(process.argv[2]);
