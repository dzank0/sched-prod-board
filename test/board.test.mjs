// Board behaviour against a fake API, in a real browser. Run: node --test test/
// One test per acceptance line in issues/ plus R6 and the pinned hooks in plan.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { launch } from './pw.mjs';
import { startFakeApi } from './fake-api.mjs';
import { formatLocal } from '../app/time.js';

const root = new URL('..', import.meta.url).pathname;
const cleanup = [];
after(async () => { for (const f of cleanup) await f(); });

async function board(apiOpts = {}) {
  const api = await startFakeApi(apiOpts);
  const out = mkdtempSync(join(tmpdir(), 'board-'));
  execFileSync('node', ['scripts/build.mjs', '--dev', '--out', out], { cwd: root, env: { ...process.env, API: api.base, SESSION: 'test-session' } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = p === '/' ? 'index.html' : p.slice(1);
    let body;
    try { body = readFileSync(join(out, file)); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await launch();
  cleanup.push(async () => { await browser.close(); api.close(); server.closeAllConnections(); server.close(); rmSync(out, { recursive: true, force: true }); });
  return { api, browser, url: `http://127.0.0.1:${server.address().port}/` };
}

const ids = (page) => page.locator('[data-testid="incident-row"]').evaluateAll((els) => els.map((e) => e.dataset.id));

test('SCHED-4512: loader shows on open and is gone once incidents are on screen', async () => {
  const { browser, url } = await board({ firstDelayMs: 800 });
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="loader"]').waitFor({ state: 'visible', timeout: 500 });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  await page.waitForTimeout(2500); // a refresh must not bring it back
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
});

test('SCHED-4511 + 4513: a new incident shows at the top without a reload, newest first', async () => {
  const { browser, url } = await board({ addEveryMs: 1500 });
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  const before = await ids(page);
  await page.waitForTimeout(4500);
  const later = await ids(page);
  assert.ok(later.length > before.length, `${before} -> ${later}`);
  assert.ok(!before.includes(later[0]), 'top row is new');
  assert.deepEqual(later.slice(later.length - before.length), before, 'older rows keep their order below');
});

test('SCHED-4511: Ack on a row acks that incident with the latest cursor, and the mark survives refreshes', async () => {
  const { api, browser, url } = await board({ addEveryMs: 1500 });
  const page = await browser.newPage();
  await page.goto(url);
  const row = page.locator('[data-testid="incident-row"][data-id="INC-1001"]');
  await row.waitFor();
  await row.locator('[data-testid="ack"]').click();
  await row.locator('[data-testid="acked"]').waitFor();
  assert.equal(api.acks.length, 1);
  assert.equal(api.acks[0].id, 'INC-1001');
  assert.equal(api.acks[0].cursor, api.acks[0].latest, 'ack sent with the latest cursor');
  await page.waitForTimeout(4500); // two refreshes and new rows on top
  assert.equal(await row.locator('[data-testid="acked"]').count(), 1);
  assert.equal(await row.locator('[data-testid="ack"]').count(), 0);
  assert.equal(await page.locator('[data-testid="acked"]').count(), 1, 'no other row marked');
});

test('SCHED-4513: refresh every 2 s, never two requests at once', async () => {
  const { api, browser, url } = await board();
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  const start = api.calls.filter((c) => c.path.endsWith('/incidents')).length;
  await page.waitForTimeout(6100);
  const n = api.calls.filter((c) => c.path.endsWith('/incidents')).length - start;
  assert.ok(n >= 2 && n <= 4, `refreshes in 6.1 s: ${n}`);
  assert.ok(api.calls.every((c) => c.maxInFlight === 1), 'no overlapping requests');
  assert.ok(api.calls.slice(1).every((c) => c.since), 'refreshes send the cursor');
});

test('SCHED-4514: Auckland, Berlin and New York each see their own zone and order; datetime keeps UTC', async () => {
  const { browser, url } = await board();
  const cases = [
    { locale: 'en-NZ', timezoneId: 'Pacific/Auckland', date: '11/11/2026', hour: /^11\/11\/2026 (4:11 pm|16:11)$/ },
    { locale: 'de-DE', timezoneId: 'Europe/Berlin', date: '11/11/2026', hour: /^11\/11\/2026 04:11$/ },
    { locale: 'en-US', timezoneId: 'America/New_York', date: '11/10/2026', hour: /^11\/10\/2026 10:11 PM$/ },
  ];
  for (const c of cases) {
    const ctx = await browser.newContext({ locale: c.locale, timezoneId: c.timezoneId });
    const page = await ctx.newPage();
    await page.goto(url);
    const t = page.locator('[data-testid="incident-row"][data-id="INC-6567"] time');
    await t.waitFor();
    const text = await t.textContent();
    assert.ok(text.startsWith(c.date), `${c.locale}: ${text}`);
    assert.match(text, c.hour, `${c.locale}: ${text}`);
    assert.equal(await t.getAttribute('datetime'), '2026-11-11T03:11:00.000Z');
    await ctx.close();
  }
});

test('R5: EU locales put day before month even when the locale is year-first', () => {
  const iso = '2026-11-03T12:00:00.000Z';
  assert.ok(formatLocal(iso, 'sv-SE', 'Europe/Stockholm').startsWith('03/11/2026'));
  assert.ok(formatLocal(iso, 'hu-HU', 'Europe/Budapest').startsWith('03/11/2026'));
  assert.ok(formatLocal(iso, 'pl-PL', 'Europe/Warsaw').startsWith('03/11/2026'));
  assert.ok(formatLocal(iso, 'en-US', 'America/New_York').startsWith('11/03/2026'));
  assert.ok(formatLocal(iso, 'ja-JP', 'Asia/Tokyo').startsWith('2026/11/03'));
});

test('R6 + hooks: build sha in meta and footer, every pinned hook present, text is not HTML', async () => {
  const { browser, url } = await board();
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="incident-row"]').nth(1).waitFor();
  const meta = await page.locator('meta[name="build"]').getAttribute('content');
  assert.equal(meta, 'dev');
  assert.equal(await page.locator('[data-testid="build-sha"]').textContent(), meta);
  for (const h of ['board', 'incident-list', 'incident-row', 'ack', 'build-sha']) assert.ok(await page.locator(`[data-testid="${h}"]`).count() > 0, h);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.ok((await page.locator('[data-testid="incident-row"][data-id="INC-1002"] .what').textContent()).includes('<img'));
});

test('empty hook: no incidents shows the empty state, no loader, no rows', async () => {
  const { browser, url } = await board({ empty: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="empty"]').waitFor();
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  assert.equal(await page.locator('[data-testid="incident-row"]').count(), 0);
});
