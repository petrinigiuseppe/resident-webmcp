const DEMO_API_ORIGIN = 'https://demo.sephmartin.com';
const CANONICAL_SITE_ORIGIN = 'https://sephmartin.com';
const ROBOTS_POLICY = 'noindex, nofollow, noarchive, nosnippet';
const CANONICAL_DATA_PATHS = new Set([
  '/shop/catalog-curation.json',
  '/data/bandcamp-sales-summary.json'
]);

function responseWithAlphaHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', ROBOTS_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function blockedAction() {
  return responseWithAlphaHeaders(new Response(JSON.stringify({
    ok: false,
    error: 'Alpha is a no-payment simulator; live checkout, account changes, and downloads are disabled.'
  }), {
    status: 409,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  }));
}

function normalizedPath(pathname) {
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

function isPrivateOrMutatingApiPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  return segments.some((segment) => segment === 'auth'
      || segment === 'admin'
      || segment.includes('checkout')
      || segment.includes('download'))
    || pathname === '/api/crate/sync'
    || pathname.startsWith('/api/crate/sync/');
}

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);
    const path = normalizedPath(incomingUrl.pathname);

    if (path === '/robots.txt') {
      return responseWithAlphaHeaders(new Response('User-agent: *\nAllow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      }));
    }
    if (path === '/sitemap.xml') {
      return responseWithAlphaHeaders(new Response('Not found', { status: 404 }));
    }

    if (path === '/api' || path.startsWith('/api/')) {
      if (isPrivateOrMutatingApiPath(path)
        || !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
        return blockedAction();
      }

      const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, DEMO_API_ORIGIN);
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete('cookie');
      upstreamHeaders.delete('authorization');
      upstreamHeaders.set('origin', DEMO_API_ORIGIN);
      upstreamHeaders.set('referer', new URL(incomingUrl.pathname, DEMO_API_ORIGIN).toString());
      const upstreamRequest = new Request(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: request.redirect
      });
      return responseWithAlphaHeaders(await env.SHOP_API.fetch(upstreamRequest));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      return responseWithAlphaHeaders(assetResponse);
    }

    if (!CANONICAL_DATA_PATHS.has(path)) {
      return responseWithAlphaHeaders(new Response('Not found', { status: 404 }));
    }

    const dataOrigin = path === '/shop/catalog-curation.json'
      ? DEMO_API_ORIGIN
      : CANONICAL_SITE_ORIGIN;
    const dataUrl = new URL(incomingUrl.pathname + incomingUrl.search, dataOrigin);
    const dataHeaders = new Headers();
    const accept = request.headers.get('accept');
    if (accept) dataHeaders.set('accept', accept);
    const dataRequest = new Request(dataUrl, {
      method: request.method,
      headers: dataHeaders,
      redirect: 'follow'
    });
    return responseWithAlphaHeaders(await fetch(dataRequest));
  }
};
