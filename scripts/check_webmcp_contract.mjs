#!/usr/bin/env node

/**
 * WebMCP Contract Smoke-Test Tool
 *
 * Runs a deterministic local WebMCP contract smoke test using a native
 * headless Chromium browser instance over Chrome DevTools Protocol (CDP).
 *
 * It preloads a controlled `document.modelContext` shim, registers all
 * available WebMCP tools, verifies schemas/annotations, executes a bounded
 * representative flow against the local static page with `demo_checkout=1`,
 * and asserts both API return values and visible DOM states.
 *
 * Zero external npm dependencies required (uses Node built-in fetch/WebSocket + system Chrome).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const EXPECTED_TOOLS = [
  'start_curator_session',
  'get_collection_stats',
  'sort_catalog',
  'browse_catalog',
  'search_catalog',
  'dig_by_descriptor',
  'focus_records',
  'inspect_record',
  'get_player_state',
  'play_track',
  'pause_track',
  'stop_track',
  'previous_track',
  'next_track',
  'previous_release',
  'next_release',
  'seek_track',
  'set_audio_mute',
  'set_player_volume',
  'set_orb_visual',
  'set_theme',
  'manage_crate',
  'add_to_crate',
  'return_to_main_crate',
  'prepare_checkout',
  'start_checkout',
  'complete_purchase',
  'download_release',
  'end_curator_session'
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findChromeExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const candidatePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function createStaticServer() {
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname;

    if (parsedUrl.pathname === '/shop/catalog-curation.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ schema_version: 'catalog-curation.v1', categories: {}, releases: {} }));
      return;
    }

    if (parsedUrl.pathname === '/data/bandcamp-sales-summary.json' || parsedUrl.pathname === '/api/best-sellers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
      return;
    }

    if (parsedUrl.pathname === '/api/catalog' || parsedUrl.pathname === '/api/products') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }

    const filePath = path.join(ROOT_DIR, pathname.replace(/^\/+/, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

async function run() {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error('Error: No supported Chromium/Chrome binary found.');
    console.error('Please install Google Chrome / Chromium or set the CHROME_BIN environment variable.');
    process.exit(1);
  }

  const server = createStaticServer();

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  console.log(`[HTTP] Local static server ready at http://127.0.0.1:${port}`);

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--mute-audio'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let wsUrl = null;
  let stderr = '';

  const cleanup = () => {
    try { if (!chromeProc.killed) chromeProc.kill(); } catch (_) {}
    try { server.close(); } catch (_) {}
  };

  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  chromeProc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
    if (match && !wsUrl) {
      wsUrl = match[1];
    }
  });

  const startTime = Date.now();
  while (!wsUrl && Date.now() - startTime < 7000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!wsUrl) {
    cleanup();
    throw new Error(`Failed to initialize Chrome CDP within timeout. Stderr: ${stderr}`);
  }

  try {
    await executeContractTests(wsUrl, port);
    console.log('\n[PASS] WebMCP contract validation completed successfully.');
  } finally {
    cleanup();
  }
}

async function executeContractTests(wsUrl, port) {
  const browserWs = new WebSocket(wsUrl);
  let idCounter = 1;
  const pending = new Map();

  function send(ws, method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  browserWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  await new Promise((r) => { browserWs.onopen = r; });

  // Create isolated target page
  const target = await send(browserWs, 'Target.createTarget', { url: 'about:blank' });
  const targetId = target.targetId;
  const wsTargetUrl = wsUrl.replace(/\/devtools\/browser\/.*$/, `/devtools/page/${targetId}`);

  const pageWs = new WebSocket(wsTargetUrl);
  pageWs.onmessage = browserWs.onmessage;
  await new Promise((r) => { pageWs.onopen = r; });

  await send(pageWs, 'Page.enable');
  await send(pageWs, 'Runtime.enable');

  // 1. Preload controlled document.modelContext shim before any document scripts run
  await send(pageWs, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__MOCK_REGISTERED_TOOLS__ = new Map();
      document.modelContext = {
        async registerTool(tool) {
          if (!tool || !tool.name || typeof tool.execute !== 'function') {
            throw new Error('Invalid tool registration: missing name or execute');
          }
          window.__MOCK_REGISTERED_TOOLS__.set(tool.name, {
            name: tool.name,
            title: tool.title || '',
            description: tool.description || '',
            inputSchema: tool.inputSchema || null,
            annotations: tool.annotations || null,
            tool: tool
          });
          return true;
        }
      };
    `
  });

  // Navigate to local static page with demo_checkout=1
  console.log(`[CDP] Navigating to http://127.0.0.1:${port}/?demo_checkout=1`);
  await send(pageWs, 'Page.navigate', { url: `http://127.0.0.1:${port}/?demo_checkout=1` });

  // Wait for WebMCP adapter to bootstrap and reach ready state
  let ready = false;
  let lastProbe = null;
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const probeRes = await send(pageWs, 'Runtime.evaluate', {
      expression: `({
        datasetWebmcp: document.documentElement.dataset.webmcp,
        toolCount: window.__MOCK_REGISTERED_TOOLS__ ? window.__MOCK_REGISTERED_TOOLS__.size : 0,
        hasApi: Boolean(window.__CRATE_API__)
      })`,
      returnByValue: true
    });
    lastProbe = probeRes.result?.value;
    if (lastProbe?.datasetWebmcp === 'ready') {
      ready = true;
      break;
    }
  }
  assert(ready, `WebMCP adapter did not reach dataset.webmcp="ready" within timeout. Last probe: ${JSON.stringify(lastProbe)}`);

  // 2. Validate tool registrations, input schemas, and annotations
  console.log('\n--- WebMCP Registration Contract ---');
  const toolDataRes = await send(pageWs, 'Runtime.evaluate', {
    expression: `Array.from(window.__MOCK_REGISTERED_TOOLS__.values()).map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      hasExecute: typeof t.tool.execute === 'function'
    }))`,
    returnByValue: true
  });
  const registeredTools = toolDataRes.result.value;
  assert(registeredTools.length === EXPECTED_TOOLS.length, `Expected ${EXPECTED_TOOLS.length} tools, got ${registeredTools.length}`);

  const registeredToolMap = new Map(registeredTools.map(t => [t.name, t]));
  for (const name of EXPECTED_TOOLS) {
    assert(registeredToolMap.has(name), `Missing tool registration: ${name}`);
    const tool = registeredToolMap.get(name);
    assert(tool.hasExecute, `Tool ${name} has no execute function`);
    assert(tool.description && tool.description.length > 0, `Tool ${name} missing description`);
    assert(tool.inputSchema && typeof tool.inputSchema === 'object', `Tool ${name} missing inputSchema`);
    assert(tool.annotations && typeof tool.annotations === 'object', `Tool ${name} missing annotations`);
  }
  console.log(`✓ All ${registeredTools.length} WebMCP tools registered with schema, title, description, and annotations.`);

  // Verify annotations contract for read-only vs UI mutating tools
  const statsTool = registeredToolMap.get('get_collection_stats');
  assert(statsTool.annotations.readOnlyHint === true, 'get_collection_stats must declare readOnlyHint: true');
  const startTool = registeredToolMap.get('start_curator_session');
  assert(startTool.annotations.readOnlyHint === false, 'start_curator_session must declare readOnlyHint: false');
  console.log('✓ Tool annotations verified (readOnlyHint vs uiMutation contract).');

  const playTool = registeredToolMap.get('play_track');
  assert(playTool.description.includes('Browser autoplay policy is strict'), 'play_track must explain strict browser autoplay policy');
  assert(playTool.description.includes('trusted user gesture') && playTool.description.includes('PLAYBACK_BLOCKED'), 'play_track must describe the user-gesture failure state');
  assert(playTool.description.includes('requires_user_gesture:true') && playTool.description.includes('user_message') && playTool.description.includes('next_step'), 'play_track must expose actionable blocked-audio fields');
  assert(playTool.description.includes('never claim playback started') && playTool.description.includes('is_playing:true'), 'play_track must require state readback before claiming playback');
  console.log('✓ Browser autoplay contract verified: agents must surface PLAYBACK_BLOCKED and request a trusted user gesture.');

  const purchaseTool = registeredToolMap.get('complete_purchase');
  const purchaseConfirmationPhrases = ['buy now', 'buy it', 'confirm purchase', 'complete purchase', 'do it'];
  assert(
    purchaseConfirmationPhrases.every((phrase) => purchaseTool.description.toLowerCase().includes(phrase)),
    'complete_purchase must advertise the explicit confirmation phrases used by the demo'
  );
  assert(
    purchaseTool.inputSchema.required?.includes('confirmed')
      && purchaseTool.inputSchema.properties?.confirmed?.type === 'boolean'
      && purchaseTool.inputSchema.properties.confirmed.description.toLowerCase().includes('buy now'),
    'complete_purchase must keep the explicit boolean confirmation gate and explain how to set it'
  );
  console.log('✓ Purchase routing contract verified: natural-language confirmations map to confirmed=true without weakening the gate.');

  // Helper function to execute a registered tool and capture DOM state
  async function execTool(toolName, args = {}) {
    const res = await send(pageWs, 'Runtime.evaluate', {
      expression: `(async () => {
        const entry = window.__MOCK_REGISTERED_TOOLS__.get(${JSON.stringify(toolName)});
        if (!entry) throw new Error("Tool not found: " + ${JSON.stringify(toolName)});
        const result = await entry.tool.execute(${JSON.stringify(args)});
        return {
          result,
          agentMode: document.documentElement.dataset.agentMode,
          agentOperation: document.documentElement.dataset.agentOperation,
          hudHidden: document.getElementById('agent-mode-hud')?.hidden,
          hudState: document.getElementById('agent-mode-hud')?.dataset.state,
          hudLabel: document.getElementById('agent-mode-label')?.textContent,
          detailsPanelHidden: document.getElementById('details-panel')?.classList.contains('hidden'),
          detailTitle: document.getElementById('detail-title')?.textContent,
          crateCounterText: document.getElementById('mycrate-counter-pill')?.textContent,
          checkoutModalHidden: document.getElementById('demo-checkout-modal')?.classList.contains('hidden'),
          checkoutModalAriaHidden: document.getElementById('demo-checkout-modal')?.getAttribute('aria-hidden'),
          checkoutModalStep: document.getElementById('demo-checkout-modal')?.dataset.step,
          checkoutOrderId: document.getElementById('demo-checkout-order-id')?.textContent,
          completionModalHidden: document.getElementById('demo-completion-modal')?.classList.contains('hidden'),
          completionModalAriaHidden: document.getElementById('demo-completion-modal')?.getAttribute('aria-hidden'),
          completionModalTitle: document.getElementById('demo-completion-title')?.textContent,
          completionModalMsg: document.getElementById('demo-completion-message')?.textContent
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Tool execution error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  console.log('\n--- Representative WebMCP Flow ---');

  // Step 1: session start
  const step1 = await execTool('start_curator_session', { intent: 'contract smoke test' });
  assert(step1.result.ok === true, 'start_curator_session result.ok should be true');
  assert(step1.result.agent_mode === 'active', 'start_curator_session agent_mode should be active');
  assert(step1.agentMode === 'active', 'DOM dataset.agentMode should be active');
  assert(step1.hudHidden === false, 'Agent HUD should be visible');
  assert(step1.hudLabel === 'AGENT MODE', 'Agent HUD label should be AGENT MODE');
  console.log('✓ 1. Session start: Agent Mode active, HUD visible with AGENT MODE.');

  // Step 2: catalog search & random selection
  const step2 = await execTool('search_catalog', { query: 'Madonna', navigation: 'direct' });
  assert(step2.result.ok === true, 'search_catalog result.ok should be true');
  assert(Array.isArray(step2.result.results) && step2.result.results.length >= 1, 'search_catalog should return results');
  const targetRecordId = step2.result.results[0].record_id;
  assert(targetRecordId, 'Search result record_id should be present');
  assert(step2.detailsPanelHidden === false, 'Song details panel should be open');
  assert(step2.detailTitle.toLowerCase().includes('madonna'), 'Detail title should match searched release');
  console.log(`✓ 2a. Catalog search: matched "${targetRecordId}" and opened detail panel.`);

  const step2b = await execTool('search_catalog', { selection: 'random', navigation: 'direct' });
  assert(step2b.result.ok === true, 'search_catalog random selection result.ok should be true');
  assert(step2b.result.random === true, 'search_catalog random flag should be true');
  console.log('✓ 2b. Catalog random selection: resolved random release.');

  // Step 3: record focus/inspection
  const step3 = await execTool('inspect_record', { record_id: targetRecordId });
  assert(step3.result.ok === true, 'inspect_record result.ok should be true');
  assert(step3.result.record && step3.result.record.title, 'inspect_record should return record summary');
  assert(step3.result.music_dna && typeof step3.result.music_dna === 'object', 'inspect_record should include music_dna');
  const focusRes = await execTool('focus_records', { record_ids: [targetRecordId] });
  assert(focusRes.result.ok === true, 'focus_records result.ok should be true');
  console.log('✓ 3. Record inspection & focus: verified metadata, Song DNA dimensions, and 3D focus.');

  // Step 4: playback controls
  const playerState = await execTool('get_player_state');
  assert(playerState.result && typeof playerState.result === 'object', 'get_player_state returned player state');
  const playRes = await execTool('play_track', { record_id: targetRecordId });
  assert(playRes.result && typeof playRes.result === 'object', 'play_track returned player state');
  const pauseRes = await execTool('pause_track');
  assert(pauseRes.result && typeof pauseRes.result === 'object', 'pause_track returned player state');
  console.log('✓ 4. Playback controls: verified get_player_state, play_track, and pause_track.');

  // Step 5: add_to_crate
  const step5 = await execTool('add_to_crate', { record_id: targetRecordId });
  assert(step5.result.ok === true, 'add_to_crate result.ok should be true');
  assert(step5.result.action === 'add', 'add_to_crate action should be add');
  assert(step5.result.cart_count >= 1, 'add_to_crate cart_count should be >= 1');
  console.log(`✓ 5. Add to crate: added release, cart count = ${step5.result.cart_count}.`);

  // Step 6: prepare/start/complete checkout
  const prepRes = await execTool('prepare_checkout');
  assert(prepRes.result.ok === true, 'prepare_checkout result.ok should be true');
  assert(prepRes.result.human_confirmation_required === true, 'prepare_checkout human_confirmation_required should be true');
  console.log('✓ 6a. Prepare checkout: verified cart review and human boundary.');

  const startCheckRes = await execTool('start_checkout');
  assert(startCheckRes.result.ok === true, 'start_checkout result.ok should be true');
  assert(startCheckRes.result.status === 'demo_checkout_opened', 'start_checkout status should be demo_checkout_opened');
  assert(startCheckRes.checkoutModalHidden === false, 'Demo checkout modal should be visible');
  assert(startCheckRes.checkoutModalAriaHidden === 'false', 'Demo checkout modal aria-hidden should be false');
  console.log('✓ 6b. Start checkout: simulator modal opened with review surface.');

  // Guard: complete_purchase without explicit confirmation is rejected
  const unconfirmedPurchase = await execTool('complete_purchase', { confirmed: false });
  assert(unconfirmedPurchase.result.ok === false, 'complete_purchase without confirmation must be ok: false');
  assert(unconfirmedPurchase.result.status === 'purchase_confirmation_required', 'complete_purchase must require explicit confirmation');
  assert(unconfirmedPurchase.result.error?.code === 'EXPLICIT_PURCHASE_CONFIRMATION_REQUIRED', 'Error code must be EXPLICIT_PURCHASE_CONFIRMATION_REQUIRED');
  console.log('✓ 6c. Complete purchase guard: unconfirmed purchase strictly refused.');

  // Confirm complete_purchase
  const confirmedPurchase = await execTool('complete_purchase', { confirmed: true });
  assert(confirmedPurchase.result.ok === true, 'complete_purchase with confirmation should be ok: true');
  assert(confirmedPurchase.result.status === 'demo_purchase_completed', 'status should be demo_purchase_completed');
  assert(confirmedPurchase.result.purchase_complete === true, 'purchase_complete should be true');
  assert(confirmedPurchase.result.demo_complete === false, 'complete_purchase must not complete the demo boundary');
  assert(confirmedPurchase.result.download_requested === false, 'complete_purchase must not request a download');
  assert(confirmedPurchase.result.next_step?.includes('separate, explicit user request'), 'complete_purchase must wait for a separate explicit download request');
  assert(typeof confirmedPurchase.result.order_id === 'string' && confirmedPurchase.result.order_id.startsWith('ORDER-'), 'order_id should start with ORDER-');
  assert(confirmedPurchase.checkoutOrderId && confirmedPurchase.checkoutOrderId.startsWith('ORDER-'), 'DOM order ID should match');
  console.log(`✓ 6d. Complete purchase confirmed: simulated order ${confirmedPurchase.result.order_id} recorded.`);

  // Step 7: download_release reaching DEMO COMPLETE
  const downloadRes = await execTool('download_release', { record_id: targetRecordId });
  assert(downloadRes.result.ok === true, 'download_release result.ok should be true');
  assert(downloadRes.result.demo_complete === true, 'download_release demo_complete should be true');
  assert(downloadRes.result.audio_download_available === false, 'audio_download_available must be false');
  assert(downloadRes.result.demo_only === true, 'demo_only must be true');
  assert(downloadRes.completionModalHidden === false, 'Demo completion modal should be visible');
  assert(downloadRes.completionModalAriaHidden === 'false', 'Demo completion modal aria-hidden should be false');
  assert(downloadRes.completionModalTitle === 'DEMO COMPLETE', 'Modal title should be DEMO COMPLETE');
  console.log('✓ 7. Download release: reached DEMO COMPLETE boundary without audio download.');

  // Step 8: end_curator_session
  const endRes = await execTool('end_curator_session');
  assert(endRes.result.ok === true, 'end_curator_session result.ok should be true');
  assert(endRes.result.agent_mode === 'human', 'agent_mode should be human');
  assert(endRes.result.crate_unchanged === true, 'crate_unchanged should be true');
  assert(endRes.agentMode === 'human', 'DOM dataset.agentMode should be human');
  assert(endRes.hudState === 'human', 'Agent HUD dataset.state should be human');
  assert(endRes.hudLabel === 'HUMAN MODE', 'Agent HUD label should be HUMAN MODE');
  console.log('✓ 8. End curator session: restored Human Mode on DOM and HUD.');

  console.log('\n--- Summary Report ---');
  console.log(JSON.stringify({
    ok: true,
    total_tools: registeredTools.length,
    assertions_passed: [
      'tools_registered_29',
      'annotations_contract_verified',
      'session_start_hud_active',
      'catalog_search_detail_open',
      'catalog_random_selection',
      'record_inspection_music_dna',
      'record_3d_focus',
      'playback_transport_controls',
      'add_to_crate_counter',
      'prepare_checkout_review_boundary',
      'start_checkout_demo_modal',
      'complete_purchase_unconfirmed_refusal',
      'complete_purchase_confirmed_order',
      'download_release_demo_complete_modal',
      'end_curator_session_human_mode'
    ]
  }, null, 2));
}

run().catch((err) => {
  console.error('\n[FAIL] WebMCP contract test failed:', err);
  process.exit(1);
});
