import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:4173/mental-math-trainer/');
await page.waitForSelector('.mode-row');
await page.locator('#coach-toggle').click();
await page.locator('#memorise-toggle').click();
await page.locator('.mode-row', { hasText: 'Focus drill' }).click();
await page.waitForSelector('.prompt');

// scenario A: wrong answer → coach reveal → Enter → stall on next question
await page.keyboard.type('1', { delay: 30 });
await page.keyboard.press('Enter');
await page.waitForSelector('.reveal');
console.log('A1: coach reveal after wrong answer: OK');
await page.keyboard.press('Enter');
await page.waitForSelector('.entry');
const a = await page.waitForSelector('.reveal', { timeout: 4000 }).then(() => true).catch(() => false);
console.log('A2: shot clock after coach reveal →', a);

// scenario B: correct answer → stall on next
if (a) {
  await page.keyboard.press('Enter');
  await page.waitForSelector('.entry');
  const t = (await page.locator('.prompt').textContent()).replace(/[a-z ]+$/,'').trim();
  const m = t.replace('×','*').match(/(\d+) [*+−] (\d+)/);
  // answer correctly whatever the op is
  const val = t.includes('+') ? Number(m[1])+Number(m[2]) : t.includes('−') ? m[1]-m[2] : m[1]*m[2];
  await page.keyboard.type(String(val), { delay: 30 });
  if (await page.locator('.entry').isVisible().catch(()=>false)) await page.keyboard.press('Enter').catch(()=>{});
  await page.waitForTimeout(300);
  const b = await page.waitForSelector('.reveal', { timeout: 4000 }).then(() => true).catch(() => false);
  console.log('B: shot clock after correct answer →', b);
}
await browser.close();
