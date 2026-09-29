import assert from 'node:assert/strict';
import worker from './worker-alpha.mjs';

const apiCalls = [];
const assets = {
  fetch: async () => new Response('asset not found', { status: 404 })
};
const shopApi = {
  fetch: async (request) => {
    apiCalls.push(request);
    return new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' }
    });
  }
};
const env = { ASSETS: assets, SHOP_API: shopApi };

for (const path of [
  '/api/lemon-checkout',
  '/api/create-checkout-session',
  '/api/order-downloads',
  '/api/vip-download',
  '/api/auth/magic-link',
  '/api/crate/sync',
  '/api/admin/sync-catalog',
  '/api/download/token'
]) {
  const response = await worker.fetch(new Request('https://alpha.sephmartin.com' + path), env);
  assert.equal(response.status, 409, path + ' must be blocked');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
}

for (const method of ['POST', 'PUT', 'DELETE']) {
  const response = await worker.fetch(new Request('https://alpha.sephmartin.com/api/analytics-event', {
    method,
    body: '{}'
  }), env);
  assert.equal(response.status, 409, method + ' API mutation must be blocked');
}
assert.equal(apiCalls.length, 0, 'blocked actions must not reach the shop API');

const catalog = await worker.fetch(new Request('https://alpha.sephmartin.com/api/catalog', {
  headers: { cookie: 'session=must-not-forward', authorization: 'Bearer must-not-forward' }
}), env);
assert.equal(catalog.status, 200);
assert.equal(new URL(apiCalls[0].url).hostname, 'demo.sephmartin.com');
assert.equal(apiCalls[0].headers.get('origin'), 'https://demo.sephmartin.com');
assert.equal(apiCalls[0].headers.has('cookie'), false);
assert.equal(apiCalls[0].headers.has('authorization'), false);
assert.match(catalog.headers.get('x-robots-tag') || '', /noindex/);

const originalFetch = globalThis.fetch;
const fallbackRequests = [];
globalThis.fetch = async (request) => {
  fallbackRequests.push(request);
  return new Response('{"ok":true}');
};
try {
  const curation = await worker.fetch(new Request('https://alpha.sephmartin.com/shop/catalog-curation.json', {
    headers: {
      accept: 'application/json',
      cookie: 'session=must-not-forward',
      authorization: 'Bearer must-not-forward',
      origin: 'https://alpha.sephmartin.com'
    }
  }), env);
  assert.equal(curation.status, 200);
  assert.equal(new URL(fallbackRequests[0].url).hostname, 'demo.sephmartin.com', 'curation must match the live demo data');
  assert.equal(fallbackRequests[0].headers.get('cookie'), null, 'fallback must not forward cookies');
  assert.equal(fallbackRequests[0].headers.get('authorization'), null, 'fallback must not forward authorization');
  assert.equal(fallbackRequests[0].headers.get('origin'), null, 'fallback must not forward the Alpha origin');
  const bestSellers = await worker.fetch(new Request('https://alpha.sephmartin.com/data/bandcamp-sales-summary.json'), env);
  assert.equal(bestSellers.status, 200);
  assert.equal(new URL(fallbackRequests[1].url).hostname, 'sephmartin.com', 'public best-seller summary must use canonical data');
  const productPage = await worker.fetch(new Request('https://alpha.sephmartin.com/album/second-chance'), env);
  assert.equal(productPage.status, 404, 'unknown pages must not fall through to live purchase pages');
  assert.equal(fallbackRequests.length, 2, 'only allowlisted public data may use origin fallbacks');
} finally {
  globalThis.fetch = originalFetch;
}

const robots = await worker.fetch(new Request('https://alpha.sephmartin.com/robots.txt'), env);
assert.equal(robots.status, 200);
assert.match(await robots.text(), /Allow: \/\n/);
const sitemap = await worker.fetch(new Request('https://alpha.sephmartin.com/sitemap.xml'), env);
assert.equal(sitemap.status, 404);

console.log('Alpha Worker safety checks passed.');
