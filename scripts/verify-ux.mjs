import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Real UI regressions with intercepted writes: never create leads or call an AI.
const base = process.env.BASE_URL ?? 'http://localhost:3100';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Run UX tests against a local server');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let passed = 0;
const check = (name) => { passed++; console.log(`PASS ${name}`); };

async function navigate(path) {
  const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert(response?.ok(), `${path}: HTTP ${response?.status()}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('main nav[aria-label="Main navigation"], main footer').count(), 0, 'Navigation and footer stay outside the main-content skip target');
  assert.equal(await page.locator('a[href="#"]').count(), 0, 'No placeholder links');
}

async function fits(label) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll('nav a,nav button')].filter((el) => el.checkVisibility())
      .filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > document.documentElement.clientWidth + 1; })
      .map((el) => el.textContent || el.getAttribute('aria-label')),
  }));
  assert(dimensions.scroll <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  assert.deepEqual(dimensions.controls, [], `${label}: navigation outside viewport`);
}

try {
  for (const locale of ['en', 'id', 'zh']) {
    await navigate(`/${locale}`);
    for (const width of [320, 375, 390, 768, 820, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(`${locale} home ${width}`);
    }
    assert(await page.locator('#services').count(), `${locale} services section missing`);
    check(`${locale} home + navigation fit at seven widths`);
    for (const path of ['/about', '/services', '/portfolio', '/contact', '/blog', '/portfolio/qianlima', '/guides/workflow-audit']) {
      await navigate(`/${locale}${path}`);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await fits(`${locale}${path} ${width}`);
      }
      check(`${locale}${path} mobile + desktop`);
    }
  }

  await page.goto(`${base}/en/this-page-does-not-exist`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'We couldn’t find that page' }).waitFor();
  assert(await page.getByRole('link', { name: 'Back to home' }).isVisible());
  check('Unknown links keep localized recovery navigation');
  await navigate('/en/contact');
  await page.getByRole('link', { name: 'Skip to main content' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
  await page.setViewportSize({ width: 390, height: 844 });
  // Menu and language controls have real expanded states and Escape recovery.
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.click();
  const language = page.getByRole('button', { name: /language/i }).filter({ visible: true });
  await language.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await page.getByRole('menu', { name: 'Choose a language' }).evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  assert(duration <= 0.01, 'Reduced motion disables disclosure movement');
  const english = page.getByRole('menuitemradio', { name: /English/ });
  const box = await english.boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= 390, 'Mobile language dropdown must fit');
  await page.keyboard.press('Escape');
  assert.equal(await english.count(), 0, 'Escape closes language dropdown');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('Mobile language menu positioning and Escape');

  let formRequest;
  let formAttempts = 0;
  await page.route('**/api/contact', async (route) => {
    formRequest = route.request().postDataJSON();
    formAttempts++;
    return route.fulfill(formAttempts === 1
      ? { status: 503, json: { error: 'Synthetic unavailable' } }
      : { json: { success: true } });
  });
  await page.evaluate(() => {
    window.uxEvents = [];
    window.addEventListener('enztronic:analytics', ({ detail }) => window.uxEvents.push(detail));
  });
  await page.locator('#contact-message').fill('Our test workflow needs a clearer handoff.');
  await page.locator('#contact-name').fill('Test Visitor');
  await page.locator('#contact-email').fill('visitor@example.com');
  const methods = page.locator('main [role="group"] button[aria-pressed]');
  await methods.nth(1).click();
  assert.equal(await page.locator('#contact-message').inputValue(), 'Our test workflow needs a clearer handoff.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('label').filter({ has: page.locator('input[type="radio"][value="automation"]') }).click();
  assert(await page.getByRole('radio', { name: 'AI Automation', exact: true }).isChecked());
  await page.locator('main').getByRole('button', { name: /continue/i }).click();
  assert.equal(await page.locator('#contact-name').inputValue(), 'Test Visitor');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  assert(await page.locator('main dl').getByText('visitor@example.com', { exact: true }).isVisible());
  await methods.first().click();
  assert.equal(await page.locator('#contact-name').inputValue(), 'Test Visitor');
  await page.locator('main button[type="submit"]').click();
  await page.locator('#contact-submit-error').waitFor();
  assert.equal(await page.locator('#contact-message').inputValue(), 'Our test workflow needs a clearer handoff.');
  await page.locator('main button[type="submit"]').click();
  await page.locator('main input#contact-name').waitFor({ state: 'detached' });
  assert.equal(formRequest.service, 'automation');
  assert.equal(formAttempts, 2);
  const events = await page.evaluate(() => window.uxEvents);
  assert(events.some((event) => event.name === 'contact_success'));
  assert(!JSON.stringify(events).includes('visitor@example.com'));
  assert(!JSON.stringify(events).includes('workflow needs'));
  check('Shared contact draft, guided review, failure retry, success and non-personal funnel events');

  let chatCount = 0;
  let failChat = true;
  let sentInquiry;
  await page.route('**/api/chat', async (route) => {
    chatCount++;
    const body = route.request().postDataJSON();
    assert(body.messages.length <= 24, 'Chat must never send excess history');
    if (failChat) return route.fulfill({ status: 503, json: { error: 'Test unavailable' } });
    return route.fulfill({ json: { reply: `Reply ${chatCount}`, ...(chatCount === 2 ? { inquiry: {
      name: 'Test Visitor', email: 'visitor@example.com', company: 'Example', service: 'automation',
      budget: '1k_5k', preferredTime: 'morning', country: 'Indonesia', message: 'Synthetic test enquiry',
    } } : {}) } });
  });
  await page.route('**/api/chat/confirm', async (route) => {
    sentInquiry = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: 'Type your message...' });
  const send = dialog.getByRole('button', { name: 'Send', exact: true });
  await input.fill('Please help with workflows');
  await send.click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await input.inputValue(), 'Please help with workflows', 'Failed chat preserves retry text');
  failChat = false;
  await send.click();
  await dialog.getByText('Reply 2', { exact: true }).waitFor();
  for (const label of ['Budget (USD)', 'Preferred time (Jakarta, UTC+7)', 'Country']) {
    assert(await dialog.getByText(label, { exact: true }).isVisible(), `${label} is reviewed`);
  }
  await dialog.getByRole('button', { name: 'Edit details' }).click();
  await dialog.getByLabel('Company', { exact: true }).fill('Edited company');
  await dialog.getByRole('button', { name: 'Review these details' }).click();
  await dialog.getByRole('button', { name: 'Send to Enztronic' }).click();
  await dialog.getByText(/Your enquiry has been sent/).waitFor();
  assert.equal(sentInquiry.company, 'Edited company', 'Edited enquiry reaches submit boundary');
  for (let turn = 1; turn < 12; turn++) {
    await input.fill(`Question ${turn}`);
    await send.click();
    await dialog.getByText(`Reply ${turn + 2}`, { exact: true }).waitFor();
  }
  assert(await input.isDisabled(), 'Conversation limit explains recovery instead of sending invalid request');
  await dialog.getByRole('button', { name: 'Start a new conversation' }).first().click();
  assert(await input.isEnabled(), 'New conversation recovers');
  await input.fill('Fresh question');
  await send.click();
  await dialog.getByText('Reply 14', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Open chat', exact: true }).evaluate((el) => el === document.activeElement), true);
  check('Chat error retry, editable complete enquiry, limit recovery, and focus');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`Verified ${passed} UX groups. All write requests were intercepted.`);
} finally {
  await browser.close();
}
