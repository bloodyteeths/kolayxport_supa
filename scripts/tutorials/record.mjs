// Step 2: drive the app on the seeded demo account and record 1080p video, timed to the narration.
//   node scripts/tutorials/record.mjs <slug>      (needs narration.json from narrate.mjs and the app running)
// Demo login: DEMO_EMAIL / DEMO_PASSWORD (defaults in scripts/demo/README.md). Never a real customer account.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { CONFIG, WORK, STEPS_IMG, ensure, loadTutorial, chromePath } from './lib.mjs';
import { installMocks } from './mocks.mjs';

const CURSOR_SCRIPT = `
(() => {
  if (window.__kxCursor) return; window.__kxCursor = true;
  const style = document.createElement('style');
  style.textContent = '#kx-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(43,69,224,.25);border:2px solid #2F5BFF;z-index:2147483647;pointer-events:none;transition:transform .12s ease;box-shadow:0 0 0 6px rgba(43,69,224,.10)}' +
    '#kx-cursor.down{transform:scale(.7)}.kx-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #2F5BFF;z-index:2147483646;pointer-events:none;animation:kxr .6s ease-out forwards}@keyframes kxr{to{transform:scale(4);opacity:0}}' +
    'html.kx-zoom{transition:transform .7s cubic-bezier(.2,.7,.2,1)}' +
    '[data-nextjs-toast],nextjs-portal,#__next-build-watcher,[data-sonner-toaster]{display:none!important}' +
    '*,*::before,*::after{caret-color:transparent!important}';
  style.id = 'kx-rec-style';
  const c = document.createElement('div'); c.id = 'kx-cursor';
  // Init scripts run before <html> exists, and a hydration re-render can drop what we add. Re-attach the
  // style and the cursor whenever they go missing; this also keeps the Next dev overlay hidden.
  try { const p = JSON.parse(sessionStorage.getItem('kx-cursor') || 'null'); if (p) { c.style.left = p.x + 'px'; c.style.top = p.y + 'px'; } } catch (e) {}
  const ensure = () => {
    const root = document.head || document.documentElement;
    if (root && !document.getElementById('kx-rec-style')) root.appendChild(style);
    if (document.body && !document.getElementById('kx-cursor')) document.body.appendChild(c);
  };
  ensure();
  document.addEventListener('DOMContentLoaded', ensure);
  setInterval(ensure, 200);
  document.addEventListener('mousemove', (e) => {
    c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
    try { sessionStorage.setItem('kx-cursor', JSON.stringify({ x: e.clientX, y: e.clientY })); } catch (err) {}
  }, true);
  document.addEventListener('mousedown', (e) => {
    c.classList.add('down');
    const r = document.createElement('div'); r.className = 'kx-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  document.addEventListener('mouseup', () => c.classList.remove('down'), true);
})();`;

async function locate(page, sel) {
  if (!sel) throw new Error('empty selector');
  if (typeof sel === 'string') return page.getByText(sel).first();
  if (sel.selector) return page.locator(sel.selector).first();
  if (sel.testid) return page.getByTestId(sel.testid).first();
  if (sel.role) return page.getByRole(sel.role, { name: sel.name, exact: !!sel.exact }).first();
  if (sel.label) return page.getByLabel(sel.label, { exact: !!sel.exact }).first();
  if (sel.placeholder) return page.getByPlaceholder(sel.placeholder).first();
  if (sel.text) return page.getByText(sel.text, { exact: !!sel.exact }).first();
  throw new Error(`unknown selector ${JSON.stringify(sel)}`);
}

const state = { x: CONFIG.width / 2, y: CONFIG.height / 2 };

async function moveTo(page, loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 15000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error('element has no box');
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 24);
  await page.mouse.move(x, y, { steps: 28 });
  state.x = x; state.y = y;
  await page.waitForTimeout(180);
  return { x, y };
}

async function zoom(page, target) {
  if (!target) {
    if (!state.zoomed) return;
    await page.evaluate(() => { const h = document.documentElement; h.style.transform = ''; });
    state.zoomed = false;
    await page.waitForTimeout(750); // let the zoom-out finish before measuring anything again
    return;
  }
  const loc = await locate(page, target);
  const box = await loc.boundingBox();
  if (!box) return;
  const scale = target.scale || 1.5;
  // Scale around an origin chosen so the zoomed element ends up fully on screen: an element near an edge
  // (a drawer button, a panel) is pulled inwards instead of being pushed off the frame. The origin stays
  // inside the viewport, so the scaled page always covers the whole frame.
  const axis = (start, size, view) => {
    const c = start + size / 2;
    const half = Math.min((size * scale) / 2 + 24, view / 2);
    const target = Math.min(Math.max(c, half), view - half);
    const o = (target - scale * c) / (1 - scale);
    return Math.min(Math.max(o, 0), view);
  };
  const ox = axis(box.x, box.width, CONFIG.width), oy = axis(box.y, box.height, CONFIG.height);
  await page.evaluate(({ ox, oy, scale }) => {
    const h = document.documentElement; h.classList.add('kx-zoom');
    h.style.transformOrigin = `${ox}px ${oy + window.scrollY}px`; h.style.transform = `scale(${scale})`;
  }, { ox, oy, scale });
  state.zoomed = true;
  await page.waitForTimeout(750);
}

async function act(page, a) {
  const [kind, arg] = Object.entries(a)[0];
  switch (kind) {
    case 'goto': await gotoSettled(page, arg); break;
    case 'click': { const l = await locate(page, arg); await moveTo(page, l); await l.click({ timeout: 15000, force: !!arg.force }); break; }
    // Checkboxes that only appear on row hover (opacity 0): move there, then click without the actionability wait.
    case 'check': { const l = await locate(page, arg); await moveTo(page, l); await l.click({ timeout: 15000, force: true }); break; }
    // Bring an element into view (smoothly, inside whatever scrolls) without clicking it.
    case 'scrollTo': {
      const l = await locate(page, arg);
      await l.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), arg.block || 'center');
      await page.waitForTimeout(900);
      break;
    }
    case 'blur': await page.evaluate(() => document.activeElement?.blur?.()); break;
    case 'hover': { const l = await locate(page, arg); await moveTo(page, l); break; }
    case 'fill': {
      const l = await locate(page, arg); await moveTo(page, l); await l.click();
      await l.fill(''); await page.keyboard.type(String(arg.value ?? ''), { delay: 45 }); break;
    }
    case 'press': await page.keyboard.press(String(arg)); break;
    case 'scroll': await page.mouse.wheel(0, Number(arg)); await page.waitForTimeout(500); break;
    case 'wait': await page.waitForTimeout(Number(arg)); break;
    case 'waitFor': await (await locate(page, arg)).waitFor({ state: 'visible', timeout: 30000 }); break;
    default: throw new Error(`unknown action ${kind}`);
  }
}

async function gotoSettled(page, url) {
  await page.goto(CONFIG.baseUrl + url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  // Pages keep polling (nav counts, notifications), so "networkidle" is best effort only.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
}

async function login(browser) {
  const email = process.env.DEMO_EMAIL || 'demo@kolayxport.test';
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error('DEMO_PASSWORD is not set (see scripts/demo/README.md)');
  const ctx = await browser.newContext({ viewport: { width: CONFIG.width, height: CONFIG.height } });
  await ctx.addInitScript(() => {
    localStorage.setItem('kolayxport_locale', 'tr');
    localStorage.setItem('kx-consent', JSON.stringify({ analytics: false, marketing: false, at: new Date().toISOString(), v: 1 }));
  });
  await installMocks(ctx, {});
  const page = await ctx.newPage();
  await gotoSettled(page, '/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/(app|ayarlar)/, { timeout: 120000 });
  const storage = await ctx.storageState();
  await ctx.close();
  return storage;
}

export async function record(slug) {
  const t = loadTutorial(slug);
  Object.assign(state, { x: CONFIG.width / 2, y: CONFIG.height / 2, zoomed: false });
  const work = ensure(path.join(WORK, slug));
  // TUTORIAL_DRY=1: check the steps and selectors fast, with a 1 s hold per step and no narration needed.
  // Nothing is written except .cache/tutorials/<slug>/dry-run.webm (no guide screenshots, no timeline).
  const dry = !!process.env.TUTORIAL_DRY;
  const narration = dry ? t.steps.map(() => ({ duration: 1 })) : JSON.parse(fs.readFileSync(path.join(work, 'narration.json'), 'utf8'));
  const browser = await chromium.launch({ executablePath: chromePath() });
  const storageState = await login(browser);
  const videoDir = ensure(path.join(work, dry ? 'raw-dry' : 'raw'));
  for (const f of fs.readdirSync(videoDir)) fs.unlinkSync(path.join(videoDir, f));
  const ctx = await browser.newContext({ viewport: { width: CONFIG.width, height: CONFIG.height }, storageState, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', recordVideo: { dir: videoDir, size: { width: CONFIG.width, height: CONFIG.height } } });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const mockReport = await installMocks(ctx, t);
  const opened = Date.now();
  const page = await ctx.newPage();
  // Warm-up (not part of the video): load the start page, let data settle.
  await gotoSettled(page, t.startUrl || '/app');
  if (t.ready) await (await locate(page, t.ready)).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(t.settleMs || 2500);
  await page.mouse.move(state.x, state.y);
  const t0 = Date.now();
  const timeline = [];
  const imgDir = dry ? null : ensure(path.join(STEPS_IMG, slug));
  if (imgDir) for (const f of fs.readdirSync(imgDir).filter((x) => x.endsWith('.webp'))) fs.unlinkSync(path.join(imgDir, f));
  let shotNo = 0;

  for (const [i, step] of t.steps.entries()) {
    const start = Date.now();
    await zoom(page, null);
    try {
      for (const a of step.do || []) await act(page, a);
      if (step.zoom) await zoom(page, step.zoom);
    } catch (e) {
      const shot = path.join(work, 'failed-step.png');
      await page.screenshot({ path: shot }).catch(() => undefined);
      console.error(`✗ ${slug} step ${i + 1} failed (screenshot: ${path.relative(process.cwd(), shot)}): ${e.message.split('\n')[0]}`);
      await ctx.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw e;
    }
    if (step.title && imgDir) {
      shotNo += 1;
      const png = await page.screenshot({ type: 'png' });
      await sharp(png).resize(1440).webp({ quality: 80 }).toFile(path.join(imgDir, `${String(shotNo).padStart(2, '0')}.webp`));
    }
    const voice = narration[i]?.duration || 0;
    const elapsed = (Date.now() - start) / 1000;
    const hold = Math.max(0, voice + CONFIG.gapMs / 1000 + (step.holdMs || 0) / 1000 - elapsed);
    await page.waitForTimeout(hold * 1000);
    timeline.push({ step: i, start: (start - t0) / 1000, end: (Date.now() - t0) / 1000, voiceStart: (start - t0) / 1000, focus: { x: state.x, y: state.y } });
  }
  await zoom(page, null);
  await page.waitForTimeout(800);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const raw = await video.path();
  if (dry) {
    fs.renameSync(raw, path.join(work, 'dry-run.webm'));
    console.log(`✓ dry run ${slug}: all ${t.steps.length} steps passed (.cache/tutorials/${slug}/dry-run.webm)`);
    return;
  }
  fs.writeFileSync(path.join(work, 'timeline.json'), JSON.stringify({ trimStart: (t0 - opened) / 1000, end: (Date.now() - opened) / 1000, raw, steps: timeline }, null, 2));
  if (mockReport.mocked.size) console.log(`  mocked: ${[...mockReport.mocked].map(([g, n]) => `${g} ×${n}`).join(', ')}`);
  if (mockReport.blocked.size) console.log(`  blocked external hosts: ${[...mockReport.blocked].join(', ')}`);
  console.log(`✓ recorded ${slug}: ${timeline.at(-1)?.end.toFixed(1)}s`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  record(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });
}
