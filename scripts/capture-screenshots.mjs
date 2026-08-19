/**
 * Re-capture the client screenshots on /portfolio.
 *
 * Project URLs come from messages/en.json, so this stays in step with the
 * portfolio without a second list to maintain.
 *
 * Two things make this fiddly enough to be worth scripting rather than
 * remembering:
 *
 *  - Some client sites sit behind a Cloudflare challenge that never clears
 *    for a headless browser. It does clear for a headed one on a persistent
 *    profile, which is why this opens real windows.
 *  - Cookie banners and age gates otherwise fill the frame, so they get
 *    dismissed the way a visitor would before the shot.
 *
 * Usage:  node scripts/capture-screenshots.mjs [--only qianlima,berdirental]
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = 'public/screenshots';
const VARIANTS = [
  { kind: 'laptop', viewport: { width: 1440, height: 900 }, mobile: false, width: 1440 },
  { kind: 'mobile', viewport: { width: 390, height: 844 }, mobile: true, width: 585 },
];
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Age gate first, then cookie consent -- the gate usually blocks the banner.
const DISMISS = [
  /18\s*or\s*older|21\s*or\s*older|^i am \d|^(yes|enter)\b/i,
  /accept all|^accept|^allow|^agree|^got it|^ok\b|setuju/i,
];
const CHALLENGE = /one moment|just a moment|attention required|checking|verify/i;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const slugFor = (url) => new URL(url).hostname.replace(/^www\./, '').split('.')[0];

const projects = JSON.parse(fs.readFileSync('messages/en.json', 'utf8')).portfolio.projects;
const only = arg('only')?.split(',').map((s) => s.trim());
const targets = projects
  .map((p) => ({ slug: slugFor(p.url), url: p.url, title: p.title }))
  .filter((p) => !only || only.includes(p.slug));

if (!targets.length) {
  console.error('nothing to capture');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const results = [];
for (const { slug, url, title } of targets) {
  for (const v of VARIANTS) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'enz-shot-'));
    const ctx = await chromium.launchPersistentContext(profile, {
      headless: false, // the Cloudflare challenge rejects headless
      viewport: v.viewport,
      deviceScaleFactor: 2,
      isMobile: v.mobile,
      hasTouch: v.mobile,
      userAgent: v.mobile ? IPHONE_UA : undefined,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    let status = 'ok';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (let i = 0; i < 40 && CHALLENGE.test(await page.title()); i++) {
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(2500);

      for (const re of DISMISS) {
        for (let pass = 0; pass < 4; pass++) {
          let clicked = false;
          for (const el of await page.$$('button, a, input[type="submit"], [role="button"]')) {
            if (!(await el.isVisible().catch(() => false))) continue;
            const txt = ((await el.innerText().catch(() => '')) || '').trim();
            if (!txt || !re.test(txt)) continue;
            await el.click({ timeout: 3000 }).catch(() => {});
            clicked = true;
            await page.waitForTimeout(1500);
            break;
          }
          if (!clicked) break;
        }
      }

      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(700);

      const png = await page.screenshot();
      const file = `${OUT}/${slug}-${v.kind}.webp`;
      await sharp(png).resize({ width: v.width }).webp({ quality: 82, effort: 6 }).toFile(file);
      status = `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
    } catch (e) {
      status = `FAILED: ${e.message.split('\n')[0].slice(0, 60)}`;
    }
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
    results.push({ slug, kind: v.kind, status });
    console.log(`${slug}-${v.kind}`.padEnd(30), status);
  }
}

const failed = results.filter((r) => r.status.startsWith('FAILED'));
console.log(`\n${results.length - failed.length}/${results.length} captured`);
if (failed.length) {
  console.log('\nStill missing -- add or remove the slug in src/lib/screenshots.ts to match:');
  for (const f of failed) console.log(`  ${f.slug}-${f.kind}: ${f.status}`);
}
process.exit(failed.length ? 1 : 0);
