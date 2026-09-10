import { chromium } from 'playwright';

const OUT = process.env.OUT_DIR ?? '/tmp';
const errors = [];

// Headless Chromium needs SwiftShader to have a WebGL context at all.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  return { width: c.width, height: c.height, hasContext: Boolean(gl) };
});
console.log('canvas:', JSON.stringify(canvas));

// NB: a WebGL canvas clears its drawing buffer after compositing, so reading it
// back with createImageBitmap/getImageData returns blank. page.screenshot()
// captures the composited page and is the only honest check that it drew.

await page.screenshot({ path: `${OUT}/01-aiming.png` });

const box = await page.locator('canvas').boundingBox();
const aimAt = async (x, y) => page.mouse.move(box.x + x, box.y + y);

// --- aim, charge, kick -----------------------------------------------------
await aimAt(430, 300);
await page.waitForTimeout(200);
const meterHiddenBefore = await page.locator('.power-meter').isHidden();

await page.mouse.down();
await page.waitForTimeout(320);
const meterVisible = await page.locator('.power-meter').isVisible();
const fillTransform = await page.locator('.power-meter__fill').evaluate((el) => el.style.transform);
await page.screenshot({ path: `${OUT}/02-charging.png` });
await page.mouse.up();

console.log(`power meter: hidden before=${meterHiddenBefore} visible while held=${meterVisible} fill=${fillTransform}`);

await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-in-flight.png` });

// Wait for the outcome banner.
await page.waitForSelector('.banner:not([hidden])', { timeout: 6000 });
const outcome = await page.locator('.banner').textContent();
console.log('first kick outcome:', outcome);
await page.screenshot({ path: `${OUT}/04-outcome.png` });

// --- play out the remaining four kicks -------------------------------------
const outcomes = [outcome];
for (let i = 0; i < 4; i++) {
  await page.waitForSelector('.banner', { state: 'hidden', timeout: 8000 });
  await aimAt(430 + i * 90, 260 + i * 25);
  await page.mouse.down();
  await page.waitForTimeout(250 + i * 90);
  await page.mouse.up();
  await page.waitForSelector('.banner:not([hidden])', { timeout: 8000 });
  outcomes.push(await page.locator('.banner').textContent());
}
console.log('round outcomes:', outcomes.join(' | '));

const score = await page.locator('.score__count').textContent();
const pips = await page.locator('.pip').count();
const filledPips = await page.locator('.pip--goal, .pip--missed').count();
console.log(`scoreboard: "${score}"  pips=${pips} filled=${filledPips}`);

// --- result screen ---------------------------------------------------------
await page.waitForSelector('.result:not([hidden])', { timeout: 8000 });
const heading = await page.locator('.result__heading').textContent();
const detail = await page.locator('.result__detail').textContent();
console.log(`result screen: "${heading}" / "${detail}"`);
await page.screenshot({ path: `${OUT}/05-result.png` });

// --- restart ---------------------------------------------------------------
await page.locator('.result__button').click();
await page.waitForTimeout(400);
const afterRestart = await page.locator('.score__count').textContent();
const filledAfter = await page.locator('.pip--goal, .pip--missed').count();
console.log(`after restart: score="${afterRestart}" filled pips=${filledAfter}`);

// --- other HUD affordances -------------------------------------------------
await page.keyboard.press('KeyD');
await page.keyboard.press('KeyD');
const curveActive = await page.locator('.curve').evaluate((el) => el.className);
const knob = await page.locator('.curve__knob').evaluate((el) => el.style.left);
console.log(`curve: class="${curveActive}" knob=${knob}`);

await page.keyboard.press('Backquote');
const debugVisible = await page.locator('.debug').isVisible();
await page.keyboard.press('KeyM');
await page.waitForTimeout(100);
const toast = await page.locator('.toast').count();
console.log(`debug panel visible=${debugVisible}  mute toast rendered=${toast > 0}`);

await page.locator('.colophon').click();
await page.waitForTimeout(200);
const aboutVisible = await page.locator('.about').isVisible();
console.log('colophon modal opens:', aboutVisible);
await page.screenshot({ path: `${OUT}/06-about.png` });

// --- localStorage best score ----------------------------------------------
const best = await page.evaluate(() => localStorage.getItem('penalty-shootout:best-score'));
console.log('localStorage best score:', best);

console.log('\nconsole errors:', errors.length === 0 ? 'none' : errors);
await browser.close();
