#!/usr/bin/env node
/* Headless verification for the ListingLens hybrid build.
 *
 * Serves this folder on http://127.0.0.1:8000, drives
 * chrome-headless-shell over CDP, and checks:
 *   1. The page loads; the Firebase CDN modules load (or the failure is
 *      reported honestly instead of silently).
 *   2. With placeholder config: hybrid status says "not configured", the
 *      hybrid checkbox is disabled, and Optimize still works via the
 *      rules engine (sample product 40 -> 95, rules-engine badge).
 *   3. The firebase-ai.js internals behave: parseListingJson accepts valid
 *      JSON, rejects garbage, tops up short bullet lists from the rules
 *      fallback; normalizeSource maps ON_DEVICE/IN_CLOUD (either case);
 *      buildHybridPrompt includes the keywords.
 *
 * What this CANNOT test (no real Firebase project, no Gemini Nano in
 * headless Chrome): the live on-device/cloud round-trip. That needs a
 * real project config + desktop Chrome — see FIREBASE_SETUP.md step 6.
 *
 * Usage: node test/test-hybrid.mjs [--port 8000]
 * Exit code 0 = all checks passed, 1 = a check failed.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = process.env.TEST_APP_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 8000);
const CHROME = process.env.CHROME_BIN ||
  path.join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

/* ---- launch server + chrome ---- */
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: APP_DIR, stdio: 'ignore' });
const profile = '/tmp/listinglens-hybrid-chrome-profile';
const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  // The sandbox routes outbound traffic through an egress proxy; Chrome
  // does not pick up the shell's proxy env vars, so pass it explicitly.
  // --ignore-certificate-errors is test-only: the proxy MITMs TLS.
  '--proxy-server=http://hatch-egress-proxy:3128', '--ignore-certificate-errors',
  `--remote-debugging-port=9222`, `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

async function waitForDebugger() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

let msgId = 0;
const pending = new Map();
let ws;
const consoleErrors = [];
const failedRequests = [];
const firebaseResponses = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
  return r.result ? r.result.value : undefined;
}

let exitCode = 1;
try {
  await waitForDebugger();
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res2, rej) => { ws.onopen = res2; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result || {}); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Network.loadingFailed') {
      failedRequests.push(msg.params.errorText + ' ' + (msg.params.canceled ? '(canceled)' : ''));
    }
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url;
      if (url.includes('gstatic.com/firebasejs')) {
        firebaseResponses.push(msg.params.response.status + ' ' + url.split('/').slice(-1)[0]);
      }
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(6000);

  // 1. Module loaded? (CDN reachable from the browser?)
  const hybridType = await evaluate(`typeof window.ListingLensHybrid`);
  check('hybrid module loaded (Firebase CDN reachable)', hybridType === 'object', 'typeof ListingLensHybrid = ' + hybridType);
  console.log('  firebase CDN responses: ' + (firebaseResponses.join(', ') || '(none seen)'));

  // 2. Placeholder config -> not configured, checkbox disabled.
  const status = await evaluate(`window.ListingLensHybrid ? window.ListingLensHybrid.getStatus() : null`);
  check('placeholder config reports not-configured', status && status.state === 'not-configured', JSON.stringify(status));
  const hybridStatusText = await evaluate(`document.getElementById('hybrid-status').textContent`);
  check('status line explains rules engine is running', /not configured/i.test(hybridStatusText || ''), hybridStatusText);
  const boxDisabled = await evaluate(`document.getElementById('in-use-hybrid').disabled`);
  check('hybrid checkbox disabled while unconfigured', boxDisabled === true, 'disabled=' + boxDisabled);

  // 3. Sample + Optimize still works via the rules engine.
  await evaluate(`document.getElementById('btn-sample').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('btn-optimize').click()`);
  let outputVisible = false;
  for (let i = 0; i < 20; i++) {
    outputVisible = await evaluate(`!document.getElementById('output-card').hidden`);
    if (outputVisible) break;
    await sleep(500);
  }
  check('output card appears after Optimize', outputVisible === true);
  const before = await evaluate(`document.getElementById('score-before').textContent`);
  const after = await evaluate(`document.getElementById('score-after').textContent`);
  check('sample scores 40 -> 95', before === '40' && after === '95', 'before=' + before + ' after=' + after);
  const badge = await evaluate(`document.getElementById('path-badge').textContent`);
  const badgeClass = await evaluate(`document.getElementById('path-badge').className`);
  check('badge shows rules-engine fallback', /Rules engine/.test(badge || ''), badge + ' [' + badgeClass + ']');
  const note = await evaluate(`document.getElementById('engine-note').textContent`);
  check('engine note mentions rules engine', /rules engine/i.test(note || ''), note);
  const enTitle = await evaluate(`document.getElementById('en-title').textContent`);
  check('EN title rendered', typeof enTitle === 'string' && enTitle.indexOf('Insulated Water Bottle') === 0, (enTitle || '').slice(0, 60));

  // 4. Internals unit checks (run in the real browser context).
  const internals = await evaluate(`(function () {
    const H = window.ListingLensHybrid._internals;
    const out = {};
    out.normDevice = H.normalizeSource('ON_DEVICE');
    out.normDeviceLower = H.normalizeSource('on_device');
    out.normCloud = H.normalizeSource('IN_CLOUD');
    out.normUnknown = H.normalizeSource('SOMETHING_ELSE');
    const good = H.parseListingJson(JSON.stringify({
      title: 'Test Title Here', bullets: ['A: one', 'B: two', 'C: three', 'D: four', 'E: five'],
      description: 'Desc here.', titleCN: '测试标题', bulletsCN: ['一', '二', '三', '四', '五'], descriptionCN: '中文描述。'
    }), null);
    out.goodTitle = good && good.en.title;
    out.goodBullets = good && good.en.bullets.length;
    out.garbage = H.parseListingJson('not json at all', null);
    out.noTitle = H.parseListingJson(JSON.stringify({ bullets: ['a', 'b', 'c', 'd', 'e'], description: 'x' }), null);
    const fb = { en: { title: 'FB', bullets: ['F1', 'F2', 'F3', 'F4', 'F5'], description: 'fd' }, cn: { title: '回', bullets: ['回1', '回2', '回3', '回4', '回5'], description: '回描' } };
    const short = H.parseListingJson(JSON.stringify({
      title: 'Short Bullets', bullets: ['A: one', 'B: two', 'C: three'],
      description: 'Desc.', titleCN: '短', bulletsCN: ['一', '二', '三'], descriptionCN: '描。'
    }), fb);
    out.shortToppedUp = short && short.en.bullets.length + '/' + short.en.bullets.join('|');
    out.shortCn = short && short.cn.bullets.length;
    const p = H.buildHybridPrompt({ title: 'Bottle', bullets: ['Keeps cold'], description: 'Steel bottle.' }, ['insulated water bottle']);
    out.promptHasKeywords = p.indexOf('insulated water bottle') >= 0;
    out.promptHasTitle = p.indexOf('Bottle') >= 0;
    return out;
  })()`);
  check('normalizeSource maps ON_DEVICE/on_device', internals.normDevice === 'on-device' && internals.normDeviceLower === 'on-device', JSON.stringify(internals));
  check('normalizeSource maps IN_CLOUD, unknown stays unknown', internals.normCloud === 'cloud' && internals.normUnknown === 'unknown');
  check('parseListingJson accepts valid JSON', internals.goodTitle === 'Test Title Here' && internals.goodBullets === 5);
  check('parseListingJson rejects garbage and missing title', internals.garbage === null && internals.noTitle === null);
  check('parseListingJson tops up short bullets from rules fallback', internals.shortToppedUp === '5/A: one|B: two|C: three|F4|F5' && internals.shortCn === 5, JSON.stringify(internals.shortToppedUp));
  check('buildHybridPrompt includes keywords and title', internals.promptHasKeywords === true && internals.promptHasTitle === true);

  // Console errors / failed requests (informational, but fail on page errors).
  const pageErrors = consoleErrors.filter((m) => !/Firebase|App Check|LanguageModel/i.test(m));
  check('no page console errors (excluding Firebase init noise)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  if (consoleErrors.length) console.log('  all console errors: ' + JSON.stringify(consoleErrors.slice(0, 5)));
  if (failedRequests.length) console.log('  failed requests: ' + JSON.stringify(failedRequests.slice(0, 5)));

  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (e) {
  console.log('ERROR  ' + (e && e.message ? e.message : e));
  exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(exitCode);
}
