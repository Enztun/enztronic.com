/**
 * WCAG contrast audit against real rendered pixels.
 *
 * Computed-style checks cannot see a gradient, an image, or a translucent
 * layer -- they walk up looking for a `backgroundColor` and report whatever
 * they find, which is how a navy-on-navy footer and a heading rule that
 * outranked `text-white` both survived review. This shoots each page twice,
 * once normally and once with the glyphs made transparent, and diffs the two.
 * The pixels that differ are exactly the text, so the background can be
 * sampled at precisely the points the text sits on.
 *
 * Usage:  node scripts/audit-contrast.mjs [--base http://localhost:3000]
 * Exits non-zero when something fails, so CI can gate on it.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const PAGES = ['/en', '/en/about', '/en/services', '/en/portfolio', '/en/contact', '/en/blog'];
const THEMES = ['dark', 'light'];

/**
 * Known failures we have decided to keep. Without this the audit is red
 * forever and stops being a signal.
 */
const ACCEPTED = [
  { match: /WhatsApp/i, reason: "WhatsApp's own brand green; kept deliberately" },
];

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Collect every text box with its resolved colour, in page coordinates. */
const COLLECT = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  // Painted, not parsed: oklab() and color-mix() survive this, string parsing
  // silently mangles them.
  const resolve = (s) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = '#000';
    g.fillStyle = s;
    g.clearRect(0, 0, 1, 1);
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    return a > 0
      ? [Math.min(255, d[0] / a), Math.min(255, d[1] / a), Math.min(255, d[2] / a)]
      : [0, 0, 0];
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const txt = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (!txt) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    out.push({
      txt: txt.slice(0, 44),
      fg: resolve(cs.color),
      px: Math.round(px),
      need: px >= 24 || (bold && px >= 18.66) ? 3 : 4.5,
      cls: (el.className.toString?.() || '').slice(0, 52),
      x: Math.round(r.x + scrollX),
      y: Math.round(r.y + scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return out;
};

const browser = await chromium.launch();
let failures = 0;
let accepted = 0;

for (const theme of THEMES) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('enztronic-site-theme', t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  console.log(`\n===== ${theme.toUpperCase()} =====`);

  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, 0));
    const items = await page.evaluate(COLLECT);

    const withText = PNG.sync.read(await page.screenshot({ fullPage: true }));
    await page.addStyleTag({
      content:
        '*, *::before, *::after { color: transparent !important; text-decoration-color: transparent !important; }',
    });
    await page.waitForTimeout(150);
    const bg = PNG.sync.read(await page.screenshot({ fullPage: true }));

    const idx = (x, y) => (bg.width * y + x) << 2;
    const bad = [];
    for (const it of items) {
      const Lfg = lum(...it.fg);
      let worst = Infinity;
      let covered = 0;
      const x1 = Math.min(bg.width - 1, it.x + it.w);
      const y1 = Math.min(bg.height - 1, it.y + it.h);
      for (let y = Math.max(0, it.y); y < y1; y++) {
        for (let x = Math.max(0, it.x); x < x1; x++) {
          const i = idx(x, y);
          const diff =
            Math.abs(bg.data[i] - withText.data[i]) +
            Math.abs(bg.data[i + 1] - withText.data[i + 1]) +
            Math.abs(bg.data[i + 2] - withText.data[i + 2]);
          if (diff < 90) continue; // background, or antialiasing only
          covered++;
          const c = ratio(Lfg, lum(bg.data[i], bg.data[i + 1], bg.data[i + 2]));
          if (c < worst) worst = c;
        }
      }
      if (covered < 4) continue;
      if (worst < it.need) bad.push({ ...it, ratio: +worst.toFixed(2) });
    }

    const real = bad.filter((b) => !ACCEPTED.some((a) => a.match.test(b.txt)));
    accepted += bad.length - real.length;
    failures += real.length;
    console.log(`${path.padEnd(16)} ${real.length ? `${real.length} FAIL` : 'ok'}`);
    for (const f of real) {
      console.log(`    ${String(f.ratio).padEnd(6)} need ${f.need} | ${f.px}px | ${JSON.stringify(f.txt)} | ${f.cls}`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${failures} failure(s), ${accepted} accepted exception(s)`);
process.exit(failures > 0 ? 1 : 0);
