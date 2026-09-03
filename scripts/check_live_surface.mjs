#!/usr/bin/env node

const base = (process.argv[2] || 'https://demo.sephmartin.com').replace(/\/$/, '');
const required = [
  'src="/crate/webmcp.js',
  'id="agent-mode-hud"',
  'id="agent-mode-cover"',
  'id="agent-mode-play-btn"',
  'id="agent-orb-disco-toggle"',
  'id="agent-orb-prev-btn"',
  'id="agent-orb-next-btn"',
  'id="buy-btn"',
  'id="demo-checkout-confirm"',
  'id="demo-completion-modal"'
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function get(path) {
  const response = await fetch(`${base}${path}`);
  const body = await response.text();
  return { response, body };
}

const page = await get('/');
assert(page.response.ok, `/ returned ${page.response.status}`);
assert((page.response.headers.get('content-type') || '').includes('text/html'), '/ is not HTML');
for (const marker of required) assert(page.body.includes(marker), `missing live marker: ${marker}`);
assert(page.body.includes('sephmartin.theme.v2'), 'theme preference key is missing');
assert(!page.body.includes('mobile-agent-sound-toggle'), 'removed mobile sound control is still present');

const [adapter, styles, catalog] = await Promise.all([
  get('/crate/webmcp.js?v=20260831-webmcp-m77'),
  get('/crate/style.css?v=20260831-webmcp-m77'),
  get('/shop/catalog-curation.json')
]);
assert(adapter.response.ok, `WebMCP adapter returned ${adapter.response.status}`);
assert(adapter.body.includes("name: 'start_curator_session'"), 'session tool is missing');
assert(adapter.body.includes("name: 'add_to_crate'"), 'add-to-crate tool is missing');
assert(adapter.body.includes("name: 'complete_purchase'"), 'demo purchase tool is missing');
assert(adapter.body.includes("name: 'download_release'"), 'demo download-boundary tool is missing');
assert(adapter.body.includes('Browser autoplay policy is strict') && adapter.body.includes('trusted user gesture'), 'play_track does not explain the browser user-gesture policy');
assert(adapter.body.includes('PLAYBACK_BLOCKED') && adapter.body.includes('requires_user_gesture:true') && adapter.body.includes('never claim playback started'), 'play_track does not expose the actionable blocked-audio contract');
assert(styles.response.ok, `styles returned ${styles.response.status}`);
assert(catalog.response.ok, `catalog curation returned ${catalog.response.status}`);

console.log(JSON.stringify({
  ok: true,
  base,
  page_status: page.response.status,
  webmcp_status: adapter.response.status,
  styles_status: styles.response.status,
  catalog_curation_status: catalog.response.status
}, null, 2));
