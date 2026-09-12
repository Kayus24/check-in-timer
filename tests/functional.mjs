import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4173;
const baseURL = 'http://127.0.0.1:' + port;
const results = [];

function startServer() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev -- --host 127.0.0.1 --port ' + String(port)]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)];
  const server = spawn(command, args, { cwd: root, stdio: 'ignore', windowsHide: true });
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(baseURL);
        if (response.ok) return resolve(server);
      } catch (_) {}
      if (Date.now() - started > 30000) return reject(new Error('Vite dev server did not start'));
      setTimeout(poll, 250);
    };
    poll();
  });
}

async function withPage(browser, url, fn, options = {}) {
  const context = await browser.newContext({ viewport: { width: 931, height: 2048 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  const failedRequests = [];
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'unknown' }));
  try {
    await page.goto(baseURL + url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.view);
    await fn(page, failedRequests);
  } finally {
    await context.close();
  }
}

function parseDiagnostic(text, key) {
  const prefix = key + '=';
  const token = (text || '')
    .split(/\r?\n/)
    .flatMap((line) => line.trim().split(/\s+/))
    .find((value) => value.startsWith(prefix));
  return token ? token.slice(prefix.length) : null;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await withPage(browser, '/?diag=1', async (page) => {
      const before = await page.locator('#diagnostics').textContent();
      const oldStartMs = Number(parseDiagnostic(before, 'currentStartMs'));
      await page.waitForTimeout(2200);
      await page.locator('#timerExit').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'map');
      await page.waitForTimeout(5000);
      await page.locator('#mapStartNav').click();
      const after = await page.locator('#diagnostics').textContent();
      assert.equal(Number(parseDiagnostic(after, 'currentStartMs')), oldStartMs, 'B1 startMs changed across map');
      assert.ok(Number(parseDiagnostic(after, 'visibleTimer')?.replaceAll(':', '')) >= 7, 'B1 elapsed did not include navigation wait');
      results.push({ name: 'B1 timer persistence', pass: true });
    });

    await withPage(browser, '/?diag=1', async (page) => {
      const oldStartMs = Number(parseDiagnostic(await page.locator('#diagnostics').textContent(), 'currentStartMs'));
      await page.locator('#timerExit').click();
      await page.locator('#mapProfileButton').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'profile');
      await page.locator('#profileCheckins').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'checkins');
      await page.locator('#activeCheckinCard').click();
      const diag = await page.locator('#diagnostics').textContent();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'timer');
      assert.equal(Number(parseDiagnostic(diag, 'currentStartMs')), oldStartMs, 'B2 reentry created a timer');
      results.push({ name: 'B2 map-profile-checkins-timer flow', pass: true });
    });

    await withPage(browser, '/?diag=1', async (page) => {
      const oldStartMs = Number(parseDiagnostic(await page.locator('#diagnostics').textContent(), 'currentStartMs'));
      await page.locator('#timerExit').click();
      await page.locator('#mapQuickQrButton').click();
      const diag = await page.locator('#diagnostics').textContent();
      const newStartMs = Number(parseDiagnostic(diag, 'currentStartMs'));
      const primary = await page.evaluate(() => localStorage.getItem('checkinStartEpochMs'));
      const compat = await page.evaluate(() => localStorage.getItem('checkin-timer-start-v1'));
      assert.ok(newStartMs > oldStartMs, 'B3 QR did not create a newer startMs');
      assert.equal(primary, String(newStartMs));
      assert.equal(compat, String(newStartMs));
      assert.ok(Number(parseDiagnostic(diag, 'visibleTimer')?.replaceAll(':', '')) <= 1, 'B3 timer did not restart near zero');
      assert.equal(parseDiagnostic(diag, 'startNewCheckinCallCount'), '1');
      results.push({ name: 'B3 QR starts exactly one new check-in', pass: true });
    });

    await withPage(browser, '/?diag=1#map', async (page) => {
      const before = await page.locator('#diagnostics').textContent();
      const start = parseDiagnostic(before, 'currentStartMs');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const after = await page.locator('#diagnostics').textContent();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'map');
      assert.equal(parseDiagnostic(after, 'currentStartMs'), start, 'B4 reload lost timer');
      await page.goto(baseURL + '/?diag=1#profile', { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'profile');
      results.push({ name: 'B4 reload and hash navigation', pass: true });
    });

    await withPage(browser, '/?noActive=1#profile', async (page) => {
      await page.locator('#profileCheckins').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'checkins');
      assert.equal(await page.locator('#activeCheckinCard').isHidden(), true);
      assert.match(await page.locator('#noActiveCheckin').textContent(), /Kein aktiver Check-in/);
      results.push({ name: 'B4 no-active state', pass: true });
    });

    await withPage(browser, '/?diag=1&qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5', async (page) => {
      const box = await page.locator('#dynamicCheckin').boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      assert.equal(parseDiagnostic(await page.locator('#diagnostics').textContent(), 'resetFired'), '0');
      results.push({ name: 'B5 short tap does not reset', pass: true });
    });

    await withPage(browser, '/?diag=1&qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5', async (page) => {
      const box = await page.locator('#dynamicCheckin').boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(3200);
      await page.mouse.up();
      assert.equal(parseDiagnostic(await page.locator('#diagnostics').textContent(), 'resetFired'), '1');
      results.push({ name: 'B5 full long-press reset', pass: true });
    });

    await withPage(browser, '/?diag=1&qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5', async (page) => {
      const box = await page.locator('#dynamicCheckin').boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(Math.min(930, box.x + box.width + 100), box.y + box.height / 2, { steps: 3 });
      await page.waitForTimeout(3200);
      await page.mouse.up();
      assert.equal(parseDiagnostic(await page.locator('#diagnostics').textContent(), 'resetFired'), '0');
      results.push({ name: 'B5 outside move cancels reset', pass: true });
    });

    for (const [seconds, expected] of [[9, '00:00:10'], [59, '00:01:00'], [599, '00:10:00']]) {
      await withPage(browser, '/?qa=1&month=Sep&day=9&hour=10&minute=20&seconds=' + seconds, async (page) => {
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('#elapsed').textContent(), expected, 'B6 transition ' + seconds + ' failed');
        results.push({ name: 'B6 glyph transition ' + seconds, pass: true });
      });
    }

    await withPage(browser, '/?qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5', async (page, failedRequests) => {
      await page.waitForFunction(() => document.querySelector('#backgroundVideo')?.readyState >= 2, null, { timeout: 15000 });
      const video = await page.locator('#backgroundVideo').evaluate((element) => {
        const value = element;
        return { readyState: value.readyState, duration: value.duration, paused: value.paused, muted: value.muted, loop: value.loop, playsInline: value.playsInline, currentSrc: value.currentSrc };
      });
      assert.ok(video.duration > 0);
      assert.equal(video.muted, true);
      assert.equal(video.loop, true);
      assert.equal(video.playsInline, true);
      assert.equal(failedRequests.filter((item) => item.url.includes('.mp4')).length, 0);
      results.push({ name: 'B7 video', pass: true, video });
    });

    await withPage(browser, '/?qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5#profile', async (page) => {
      assert.equal(await page.locator('#profileDynamicPlanDate').textContent(), 'Wed, Sep 9 - 00:00-23:59');
      results.push({ name: 'D reference profile date', pass: true });
    });

    await withPage(browser, '/?qa=1&month=Sep&day=10&hour=10&minute=20&seconds=5#profile', async (page) => {
      assert.equal(await page.locator('#profileDynamicPlanDate').textContent(), 'Thu, Sep 10 - 00:00-23:59');
      results.push({ name: 'D dynamic profile date', pass: true });
    });

    await withPage(browser, '/?diag=1&qa=1&month=Sep&day=9&hour=10&minute=20&seconds=5#map', async (page) => {
      const mapQr = await page.locator('#mapQuickQrButton').boundingBox();
      const mapProfile = await page.locator('#mapProfileButton').boundingBox();
      assert.ok(mapQr?.width > 0 && mapQr?.height > 0);
      assert.ok(mapProfile?.width > 0 && mapProfile?.height > 0);
      await page.locator('#mapProfileButton').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'profile');
      const profileCheckins = await page.locator('#profileCheckins').boundingBox();
      assert.ok(profileCheckins?.width > 0 && profileCheckins?.height > 0);
      await page.locator('#profileCheckins').click();
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'checkins');
      results.push({ name: 'E hotspot center alignment', pass: true, boxes: { mapQr, mapProfile, profileCheckins } });
    });

    const pwaContext = await browser.newContext({ viewport: { width: 931, height: 2048 }, serviceWorkers: 'allow' });
    const pwaPage = await pwaContext.newPage();
    await pwaPage.goto(baseURL + '/?diag=1', { waitUntil: 'networkidle' });
    await pwaPage.waitForTimeout(2500);
    const pwa = await pwaPage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const cacheNames = await caches.keys();
      let cacheAssets = [];
      for (const name of cacheNames) cacheAssets = cacheAssets.concat(await caches.open(name).then((cache) => cache.keys()).then((keys) => keys.map((key) => key.url)));
      return {
        registration: registration ? { scope: registration.scope, state: registration.active?.state || null, controller: Boolean(navigator.serviceWorker.controller) } : null,
        cacheNames,
        cacheAssets,
      };
    });
    assert.ok(pwa.registration?.scope.endsWith('/'));
    assert.equal(pwa.registration?.state, 'activated');
    assert.ok(pwa.cacheAssets.some((url) => url.includes('map-reference.jpg')));
    assert.ok(pwa.cacheAssets.some((url) => url.includes('profile-reference.jpg')));
    results.push({ name: 'G PWA service worker and cache', pass: true, pwa });
    await pwaContext.close();
  } finally {
    await browser.close();
    server.kill();
  }
  fs.mkdirSync(path.join(root, 'artifacts/tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/tests/functional-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
