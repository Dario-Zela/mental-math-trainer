import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Smoke: one full keyboard-only session, localStorage persistence across
 * reload, and an axe scan of the three screens.
 *
 * The drill session runs off a challenge URL (10s, Zetamac ranges, pinned
 * seed) so the test finishes fast and deterministically — it exercises the
 * exact code path a shared link uses.
 */
const CHALLENGE = '#/drill?m=z&s=0000002a&b=7800000&t=10&w=0000';

function solve(prompt: string): number {
  const norm = prompt.replace('−', '-').replace('×', '*').replace('÷', '/');
  const m = norm.match(/^(\d+) ([-+*/]) (\d+)$/);
  if (!m) throw new Error(`unparseable prompt: ${prompt}`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    default: return a / b;
  }
}

async function runChallengeSession(page: Page): Promise<void> {
  await page.goto(`/mental-math-trainer/${CHALLENGE}`);
  await expect(page.locator('.prompt')).toBeVisible();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await page.locator('.results').isVisible().catch(() => false)) return;
    const prompt = (await page.locator('.prompt').textContent().catch(() => '')) ?? '';
    const text = prompt.trim();
    if (text.length === 0) continue;
    await page.keyboard.type(String(solve(text)), { delay: 20 });
    await page.waitForTimeout(60); // let auto-advance commit the next question
  }
  throw new Error('session never reached the results screen');
}

test('a full keyboard-only session: auto-advance, results, review pass', async ({ page }) => {
  await runChallengeSession(page);

  // scored at least a point and the summary grid rendered
  const score = Number(await page.locator('.results .score').textContent());
  expect(score).toBeGreaterThan(0);
  await expect(page.getByText('replay — no PBs or streaks')).toBeVisible();

  // review pass, driven by keyboard
  await page.keyboard.press('r');
  await expect(page.getByText(/Review pass · 1 \//)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/Review pass · 2 \//)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.results .score')).toBeVisible();
});

test('stats persist in localStorage across reload; IDB history accumulates', async ({ page }) => {
  await runChallengeSession(page);
  await page.keyboard.press('Escape'); // results → home
  await page.goto('/mental-math-trainer/#/stats');
  await expect(page.locator('.sessions-table tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.sessions-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.sessions-table .tag').filter({ hasText: 'replay' })).toBeVisible();
  // the per-question log landed in IndexedDB: all-time totals render non-zero
  await expect(page.getByText('Questions all-time')).toBeVisible();
  const count = Number(await page.locator('.result-grid .cell').first().locator('.num').textContent());
  expect(count).toBeGreaterThan(0);

  // reviews export: the CSV downloads and contains a per-question line
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mental-math-reviews-last1-/);
  const content = await readFile(await download.path(), 'utf8');
  expect(content.split('\n')[0]).toBe('round,started,mode,question,bucket,prompt,given,answer,verdict,ms,first_key_ms');
  expect(content).toContain('1,'); // at least one data row for round 1
  expect(content.split('\n').length).toBeGreaterThan(count); // every question exported
});

test('keyboard launch from home starts the benchmark sprint', async ({ page }) => {
  await page.goto('/mental-math-trainer/');
  // the number-key listener attaches in an effect after first paint — wait for
  // hydration before pressing, or the keystroke can vanish on slow CI runners
  await expect(page.locator('.mode-row').first()).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press('1');
  await expect(page.locator('.prompt')).toBeVisible();
  await expect(page.locator('.drill-status')).toContainText('Score');
  // Esc aborts with confirm and discards
  page.on('dialog', (d) => void d.accept());
  await page.keyboard.press('Escape');
  await expect(page.locator('.hero')).toBeVisible();
});

test('coach mode: a Learn practice drill pauses on the worked trick after a miss', async ({ page }) => {
  await page.goto('/mental-math-trainer/#/learn');
  await expect(page.locator('.learn-card').first()).toBeVisible();
  await page.locator('.learn-card').first().getByRole('button', { name: /Practice/ }).click();
  await expect(page.locator('.prompt')).toBeVisible();

  // deliberately wrong answer → the study pause shows numbered worked steps
  await page.keyboard.type('1', { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.reveal .steps li').first()).toBeVisible();
  await expect(page.getByText("✗ wrong — here's the fast way")).toBeVisible();

  // Enter resumes; 'h' surrenders the next question and shows its solution
  await page.keyboard.press('Enter');
  await expect(page.locator('.entry')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByText('⏭ revealed — scored as a skip')).toBeVisible();
  await expect(page.locator('.reveal .steps li').first()).toBeVisible();

  // Esc ends the focus session; review pass shows worked steps on every card
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('.results .score')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.locator('.review-steps .steps li').first()).toBeVisible();
});

test('blitz fast-restart: r discards the round and starts fresh', async ({ page }) => {
  await page.goto('/mental-math-trainer/');
  await expect(page.locator('.mode-row').first()).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press('6');
  await expect(page.locator('.prompt')).toBeVisible();

  // answer one question so the score is non-zero
  const prompt = (await page.locator('.prompt').textContent())!.trim();
  const m = prompt.replace('×', '*').match(/^(\d+) \* (\d+)$/) as RegExpMatchArray;
  await page.keyboard.type(String(Number(m[1]) * Number(m[2])), { delay: 20 });
  await expect(page.locator('.drill-status .num').first()).toHaveText('1');

  // r → fresh round: score resets, clock back at 1:00, no session was saved
  await page.keyboard.press('r');
  await expect(page.locator('.drill-status .num').first()).toHaveText('0');
  await expect(page.locator('.drill-status')).toContainText('1:00');
  page.on('dialog', (d) => void d.accept());
  await page.keyboard.press('Escape'); // abort out
  await page.goto('/mental-math-trainer/#/stats');
  await expect(page.getByText('No sessions yet — run a drill and your training curve starts here.')).toBeVisible();
});

test('chain blitz: the next prompt wraps the answer you just gave', async ({ page }) => {
  await page.goto('/mental-math-trainer/');
  await expect(page.locator('.mode-row').first()).toBeVisible();
  await page.selectOption('#blitz-pick', 'chain');
  await page.waitForTimeout(150);
  await page.keyboard.press('6');
  await expect(page.locator('.prompt')).toBeVisible();

  // q1 is a bare product; q2 must be (q1) − k
  const p1El = page.locator('.prompt');
  const p1 = (await p1El.textContent())!.replace('build on your last answer', '').trim();
  const m = p1.replace('×', '*').match(/^(\d+) \* (\d+)$/) as RegExpMatchArray;
  const v1 = Number(m[1]) * Number(m[2]);
  await page.keyboard.type(String(v1), { delay: 20 });
  await expect(p1El).toContainText(`(${p1})`);
  const p2 = (await p1El.textContent())!.replace('build on your last answer', '').trim();
  expect(p2.startsWith(`(${p1}) −`)).toBe(true);

  // answer q2 by manipulating v1, as intended
  const k = Number(p2.split('−').pop());
  await page.keyboard.type(String(v1 - k), { delay: 20 });
  await expect(p1El).toContainText('÷');
  page.on('dialog', (d) => void d.accept());
  await page.keyboard.press('Escape');
});

test('memorise mode: the shot clock catches stalls before AND during typing', async ({ page }) => {
  await page.goto('/mental-math-trainer/');
  await expect(page.locator('.mode-row').first()).toBeVisible();
  await page.locator('#memorise-toggle').check();
  await page.locator('#memorise-sec').fill('0.6');
  await page.locator('.hero h1').click(); // drop focus so number keys launch again
  await page.keyboard.press('5');
  await expect(page.locator('.prompt')).toBeVisible();

  // stall from the start — no keystroke within the window → reveal, scored as a skip
  await expect(page.getByText('⏱ shot clock — read it, say it, move on')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.reveal .steps li').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.entry')).toBeVisible();

  // mid-answer stall: one keystroke re-arms the clock but does not disarm it —
  // deriving behind a half-typed answer is still a freeze
  await page.keyboard.type('1');
  await expect(page.getByText('⏱ shot clock — read it, say it, move on')).toBeVisible({ timeout: 3000 });

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // focus drill: ends and saves
  await expect(page.locator('.results .score')).toBeVisible();
});

test.describe('accessibility', () => {
  const scan = async (page: Page) => {
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  };

  test('home screen has no serious axe violations', async ({ page }) => {
    await page.goto('/mental-math-trainer/');
    await scan(page);
  });

  test('stats screen (with demo data) has no serious axe violations', async ({ page }) => {
    await page.goto('/mental-math-trainer/#/stats');
    await page.getByRole('button', { name: 'Load demo data' }).click();
    await expect(page.locator('.heatmap')).toBeVisible();
    await scan(page);
  });

  test('settings screen has no serious axe violations', async ({ page }) => {
    await page.goto('/mental-math-trainer/#/settings');
    await scan(page);
  });

  test('learn screen has no serious axe violations', async ({ page }) => {
    await page.goto('/mental-math-trainer/#/learn');
    await expect(page.locator('.learn-card').first()).toBeVisible();
    await scan(page);
  });
});
