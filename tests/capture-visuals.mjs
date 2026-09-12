import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4174;
const baseURL = 'http://127.0.0.1:' + port;
const visualDir = path.join(root, 'artifacts/visual');
const testDir = path.join(root, 'artifacts/tests');
const referencePaths = {
  map: path.join(root, 'public/resources/map-reference.jpg'),
  profile: path.join(root, 'public/resources/profile-reference.jpg'),
};

function readImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const value = buffer[0] === 0xff && buffer[1] === 0xd8
    ? jpeg.decode(buffer, { useTArray: true })
    : PNG.sync.read(buffer);
  return { width: value.width, height: value.height, data: value.data };
}

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
        if ((await fetch(baseURL)).ok) return resolve(server);
      } catch (_) {}
      if (Date.now() - started > 30000) return reject(new Error('Vite dev server did not start'));
      setTimeout(poll, 250);
    };
    poll();
  });
}

function compare(reference, actual) {
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new Error('Dimension mismatch: reference ' + reference.width + 'x' + reference.height + ', actual ' + actual.width + 'x' + actual.height);
  }
  let diffPixels = 0;
  let sumAbs = 0;
  let sumSquared = 0;
  let sumRef = 0;
  let sumActual = 0;
  let sumRefSq = 0;
  let sumActualSq = 0;
  let sumProduct = 0;
  const count = reference.width * reference.height;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const r = reference.data[offset] * 0.2126 + reference.data[offset + 1] * 0.7152 + reference.data[offset + 2] * 0.0722;
    const a = actual.data[offset] * 0.2126 + actual.data[offset + 1] * 0.7152 + actual.data[offset + 2] * 0.0722;
    const delta = Math.abs(r - a);
    sumAbs += delta;
    sumSquared += delta * delta;
    sumRef += r;
    sumActual += a;
    sumRefSq += r * r;
    sumActualSq += a * a;
    sumProduct += r * a;
    if (Math.max(
      Math.abs(reference.data[offset] - actual.data[offset]),
      Math.abs(reference.data[offset + 1] - actual.data[offset + 1]),
      Math.abs(reference.data[offset + 2] - actual.data[offset + 2]),
    ) > 10) diffPixels += 1;
  }
  const meanRef = sumRef / count;
  const meanActual = sumActual / count;
  const varianceRef = sumRefSq / count - meanRef * meanRef;
  const varianceActual = sumActualSq / count - meanActual * meanActual;
  const covariance = sumProduct / count - meanRef * meanActual;
  const c1 = 6.5025;
  const c2 = 58.5225;
  const ssim = ((2 * meanRef * meanActual + c1) * (2 * covariance + c2)) /
    ((meanRef * meanRef + meanActual * meanActual + c1) * (varianceRef + varianceActual + c2));
  return {
    width: reference.width,
    height: reference.height,
    mae: sumAbs / count,
    rmse: Math.sqrt(sumSquared / count),
    ssim,
    diffPixels,
    diffPercent: diffPixels / count * 100,
  };
}

function writeDiff(reference, actual, filePath) {
  const diff = new PNG({ width: actual.width, height: actual.height });
  const count = actual.width * actual.height;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const delta = Math.max(
      Math.abs(reference.data[offset] - actual.data[offset]),
      Math.abs(reference.data[offset + 1] - actual.data[offset + 1]),
      Math.abs(reference.data[offset + 2] - actual.data[offset + 2]),
    );
    diff.data[offset] = delta > 10 ? 255 : 0;
    diff.data[offset + 1] = delta > 10 ? Math.max(0, 255 - delta * 5) : 0;
    diff.data[offset + 2] = 0;
    diff.data[offset + 3] = delta > 10 ? 255 : 0;
  }
  fs.writeFileSync(filePath, PNG.sync.write(diff));
}

function compareDynamicMask(reference, actual, box) {
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new Error('Dynamic screenshot dimension mismatch');
  }
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(actual.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(actual.height, Math.ceil(box.y + box.height));
  let changedPixels = 0;
  let changedOutsideMask = 0;
  for (let y = 0; y < actual.height; y += 1) {
    for (let x = 0; x < actual.width; x += 1) {
      const offset = (y * actual.width + x) * 4;
      const delta = Math.max(
        Math.abs(reference.data[offset] - actual.data[offset]),
        Math.abs(reference.data[offset + 1] - actual.data[offset + 1]),
        Math.abs(reference.data[offset + 2] - actual.data[offset + 2]),
      );
      if (delta <= 10) continue;
      changedPixels += 1;
      if (x < left || x >= right || y < top || y >= bottom) changedOutsideMask += 1;
    }
  }
  const totalPixels = actual.width * actual.height;
  return {
    mask: { left, top, right, bottom, width: right - left, height: bottom - top },
    changedPixels,
    changedOutsideMask,
    changedPercent: changedPixels / totalPixels * 100,
    changedOutsideMaskPercent: changedOutsideMask / totalPixels * 100,
    pass: changedOutsideMask === 0,
  };
}

async function main() {
  fs.mkdirSync(visualDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });
  const missing = Object.entries(referencePaths)
    .filter((entry) => !fs.existsSync(entry[1]))
    .map((entry) => entry[0]);
  if (missing.length) {
    const result = {
      pass: false,
      reason: 'required reference images unavailable',
      missing,
      expectedDimensions: '931x2048',
      paths: referencePaths,
    };
    fs.writeFileSync(path.join(testDir, 'visual-metrics.json'), JSON.stringify(result, null, 2) + '\n');
    throw new Error(JSON.stringify(result));
  }
  const reference = { map: readImage(referencePaths.map), profile: readImage(referencePaths.profile) };
  for (const view of ['map', 'profile']) {
    if (reference[view].width !== 931 || reference[view].height !== 2048) {
      throw new Error(view + ' reference must be 931x2048, got ' + reference[view].width + 'x' + reference[view].height);
    }
  }

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const metrics = {};
  try {
    const context = await browser.newContext({ viewport: { width: 931, height: 2048 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const view of ['map', 'profile']) {
      const fragment = view === 'map' ? '#map' : '#profile';
      const url = '/?qa=1&month=Sep&day=9&hour=10&minute=20&seconds=0' + fragment;
      await page.goto(baseURL + url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((expected) => document.body.dataset.view === expected, view);
      await page.waitForFunction((selector) => document.querySelector(selector)?.complete, view === 'map' ? '#mapReferenceImage' : '#profileReferenceImage');
      await page.waitForTimeout(500);
      const actualPath = path.join(visualDir, view + '-actual.png');
      const diffPath = path.join(visualDir, view + '-diff.png');
      await page.screenshot({ path: actualPath, animations: 'disabled' });
      const actual = readImage(actualPath);
      const result = compare(reference[view], actual);
      writeDiff(reference[view], actual, diffPath);
      metrics[view] = { reference: referencePaths[view], actual: actualPath, diff: diffPath, ...result };
    }
    await context.close();

    const dynamicContext = await browser.newContext({ viewport: { width: 931, height: 2048 }, deviceScaleFactor: 1 });
    const dynamicPage = await dynamicContext.newPage();
    await dynamicPage.goto(baseURL + '/?qa=1&month=Sep&day=10&hour=10&minute=20&seconds=0#profile', { waitUntil: 'domcontentloaded' });
    await dynamicPage.waitForFunction(() => document.body.dataset.view === 'profile');
    await dynamicPage.waitForTimeout(500);
    const dynamicPath = path.join(visualDir, 'profile-dynamic-thu.png');
    const dynamicDiffPath = path.join(visualDir, 'profile-dynamic-diff.png');
    await dynamicPage.screenshot({ path: dynamicPath, animations: 'disabled' });
    const dateText = await dynamicPage.locator('#profileDynamicPlanDate').textContent();
    const dateBox = await dynamicPage.locator('#profileDynamicPlanDate').boundingBox();
    const dynamic = readImage(dynamicPath);
    writeDiff(readImage(path.join(visualDir, 'profile-actual.png')), dynamic, dynamicDiffPath);
    const maskResult = compareDynamicMask(readImage(path.join(visualDir, 'profile-actual.png')), dynamic, dateBox);
    metrics.dynamicDate = { dateText, dateBox, actual: dynamicPath, diff: dynamicDiffPath, expectedReference: 'Wed, Sep 9 - 00:00-23:59', expectedDynamic: 'Thu, Sep 10 - 00:00-23:59', ...maskResult };
    await dynamicContext.close();

    const crossViewport = [];
    for (const deviceScaleFactor of [1, 1.25, 2]) {
      for (const size of [[390, 844], [931, 2048]]) {
        const width = size[0];
        const height = size[1];
        const crossContext = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
        const crossPage = await crossContext.newPage();
        await crossPage.goto(baseURL + '/?qa=1&month=Sep&day=9&hour=10&minute=20&seconds=0#map', { waitUntil: 'domcontentloaded' });
        await crossPage.waitForFunction(() => document.body.dataset.view === 'map');
        const data = await crossPage.evaluate(() => {
          const image = document.querySelector('#mapReferenceImage');
          const buttons = ['#mapQuickQrButton', '#mapProfileButton'].map((selector) => ({
            selector,
            rect: document.querySelector(selector)?.getBoundingClientRect().toJSON(),
          }));
          return {
            innerWidth,
            innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            image: image ? { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } : null,
            buttons,
          };
        });
        crossViewport.push({
          deviceScaleFactor,
          width,
          height,
          pass: data.scrollWidth <= width && data.scrollHeight <= height && data.buttons.every((item) => item.rect?.width > 0 && item.rect?.height > 0),
          data,
        });
        await crossContext.close();
      }
    }
    metrics.crossViewport = crossViewport;
  } finally {
    await browser.close();
    server.kill();
  }
  metrics.pass = Boolean(
    metrics.map.ssim >= 0.995 &&
    metrics.map.diffPercent <= 0.5 &&
    metrics.profile.ssim >= 0.995 &&
    metrics.profile.diffPercent <= 0.5 &&
    metrics.dynamicDate.dateText === metrics.dynamicDate.expectedDynamic &&
    metrics.dynamicDate.pass &&
    metrics.crossViewport.every((item) => item.pass),
  );
  fs.writeFileSync(path.join(testDir, 'visual-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
