import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

const MAX_BODY = 64 * 1024;
const CONSENT_PORTALS = {
  staging: 'https://sitcg.mtn.com.gh/Portal',
  production: 'https://cg.mtn.com.gh/Portal',
};
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function consentConfig(env) {
  const environment = env.MTN_CONSENT_ENV?.trim() || 'production';
  if (!Object.hasOwn(CONSENT_PORTALS, environment)) {
    throw Object.assign(new Error('Set MTN_CONSENT_ENV to staging or production.'), { status: 503 });
  }
  let callback;
  try {
    callback = new URL(env.MTN_REDIRECT_URL?.trim() || `http://localhost:${env.PORT || 3000}/callback`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
    if ((callback.protocol !== 'https:' && !(local && callback.protocol === 'http:')) || callback.username || callback.password || callback.hash) {
      throw new Error('Invalid callback URL');
    }
    if (local && (env.RENDER === 'true' || env.NODE_ENV === 'production')) {
      throw new Error('Public callback required');
    }
  } catch {
    throw Object.assign(new Error('Set MTN_REDIRECT_URL to your public HTTPS callback URL. Local HTTP is allowed only for local development.'), { status: 503 });
  }
  return { environment, gateway: CONSENT_PORTALS[environment], callback, offerId: env.MTN_OFFER_ID?.trim() || '9931110005' };
}

function logEvent(logger, event, details) {
  logger(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw) {
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function callbackPage(data) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MTN Call Signature — Callback</title><link rel="stylesheet" href="/style.css"></head><body><main class="card wide"><div class="brand">MTN</div><p class="eyebrow">CALL SIGNATURE</p><h1>Callback received</h1><p>All query parameters and the request body received at this URL are shown below.</p><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre><a href="/">Back to Call Signature</a></main></body></html>`;
}

export function createApp({ env = process.env, logger = line => console.info(line) } = {}) {
  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader('X-Request-Id', requestId);
    const path = new URL(req.url, 'http://localhost').pathname;
    const diagnosticRequest = ['/api/consent', '/callback'].includes(path);
    if (diagnosticRequest) res.on('finish', () => logEvent(logger, 'request_completed', {
      requestId, method: req.method, path, status: res.statusCode, durationMs: Date.now() - startedAt,
    }));
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/callback' && ['GET', 'POST'].includes(req.method)) {
        const rawBody = req.method === 'POST' ? await readBody(req) : '';
        const contentType = req.headers['content-type'] || '';
        let body = rawBody || null;
        if (rawBody && contentType.includes('application/json')) {
          try { body = JSON.parse(rawBody); } catch { /* Echo malformed payloads verbatim. */ }
        } else if (rawBody && contentType.includes('application/x-www-form-urlencoded')) {
          body = [...new URLSearchParams(rawBody)].map(([name, value]) => ({ name, value }));
        }
        logEvent(logger, 'callback_received', {
          requestId, method: req.method,
          queryParameterNames: [...url.searchParams.keys()],
          bodyBytes: Buffer.byteLength(rawBody), contentType: contentType || null,
          // The caller might be a manual visitor. This event is not proof of consent.
        });
        return send(res, 200, callbackPage({
          requestId,
          receivedAt: new Date().toISOString(), method: req.method,
          query: [...url.searchParams].map(([name, value]) => ({ name, value })),
          contentType: contentType || null, body, rawBody,
        }), 'text/html; charset=utf-8');
      }

      if (url.pathname === '/api/consent' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
          return send(res, 403, { error: 'Cross-origin requests are not allowed.' });
        }
        if (!req.headers['content-type']?.includes('application/json')) {
          return send(res, 415, { error: 'Use application/json.' });
        }
        const input = parseJson(await readBody(req));
        const phoneNumber = typeof input?.phoneNumber === 'string' ? input.phoneNumber.trim().replace(/[\s()+-]/g, '') : '';
        if (!/^233\d{9}$/.test(phoneNumber)) {
          return send(res, 400, { error: 'Enter a Ghana phone number in international format, e.g. 233542659565.' });
        }
        const { gateway, callback, offerId, environment } = consentConfig(env);
        const consentUrl = new URL(gateway);
        consentUrl.searchParams.set('OfferCode', offerId);
        consentUrl.searchParams.set('mobileNumber', phoneNumber);
        consentUrl.searchParams.set('redirectUrl', callback.href);
        // MTN hosts the interactive consent flow. Navigate the browser there;
        // do not POST a subscription or fetch the portal from this server.
        logEvent(logger, 'consent_prepared', {
          requestId, environment, gateway, offerId,
          phoneNumber: `${phoneNumber.slice(0, 3)}*****${phoneNumber.slice(-4)}`,
          callbackUrl: `${callback.origin}${callback.pathname}`,
        });
        return send(res, 200, { ok: true, requestId, consentUrl: consentUrl.href, offerId, phoneNumber, callbackUrl: callback.href });
      }

      if (req.method === 'GET' && publicFiles.has(url.pathname)) {
        const [file, type] = publicFiles.get(url.pathname);
        return send(res, 200, await readFile(new URL(`./public/${file}`, import.meta.url)), type);
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (error) {
      logEvent(logger, 'request_error', { requestId, path, status: error.status || 500, errorType: error.name });
      return send(res, error.status || 500, { requestId, error: error.status ? error.message : 'An unexpected server error occurred.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`MTN Call Signature listening on port ${port}`);
    try {
      const { environment, gateway, offerId, callback } = consentConfig(process.env);
      logEvent(console.info, 'consent_configuration', {
        environment, gateway, offerId, callbackUrl: `${callback.origin}${callback.pathname}`,
      });
    } catch (error) {
      logEvent(console.error, 'configuration_error', { error: error.message });
    }
  });
}
