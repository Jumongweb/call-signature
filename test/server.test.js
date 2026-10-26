import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

async function withApp(options, run) {
  const server = createApp({ logger: () => {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function consent(base, body) {
  return fetch(`${base}/api/consent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('page serves the test number and scripts without exposing credentials', async () => {
  await withApp({ env: { MTN_API_KEY: 'secret-test-key' } }, async base => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /MTN Call Signature/);
    assert.match(html, /233542659565/);
    assert.ok(!html.includes('secret-test-key'));
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
  });
});

test('builds the documented staging consent URL without making any outbound API call', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async (...args) => {
    const target = String(args[0]);
    if (!target.startsWith('http://127.0.0.1:')) {
      outboundCalls++;
      throw new Error('Unexpected outbound MTN request');
    }
    return originalFetch(...args);
  };
  try {
    await withApp({ env: { MTN_REDIRECT_URL: 'https://example.com/callback?source=call&test=1' } }, async base => {
      const res = await consent(base, { phoneNumber: '+233 54 265 9565' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.offerId, '9931110005');
      const url = new URL(body.consentUrl);
      assert.equal(url.origin, 'https://sitcg.mtn.com.gh');
      assert.equal(url.pathname, '/Portal');
      assert.deepEqual([...url.searchParams], [
        ['OfferCode', '9931110005'],
        ['mobileNumber', '233542659565'],
        ['redirectUrl', 'https://example.com/callback?source=call&test=1'],
      ]);
      assert.equal(outboundCalls, 0);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('supports production with a configured offer and callback', async () => {
  await withApp({ env: {
    MTN_CONSENT_ENV: 'production', MTN_OFFER_ID: 'custom-offer',
    MTN_REDIRECT_URL: 'https://example.com/callback',
  } }, async base => {
    const res = await consent(base, { phoneNumber: '233542659565' });
    assert.equal(res.status, 200);
    const body = await res.json();
    const url = new URL(body.consentUrl);
    assert.equal(url.origin, 'https://cg.mtn.com.gh');
    assert.equal(url.searchParams.get('OfferCode'), 'custom-offer');
    assert.equal(url.searchParams.get('redirectUrl'), 'https://example.com/callback');
  });
});

test('uses a local callback by default', async () => {
  await withApp({ env: { PORT: '4000' } }, async base => {
    const res = await consent(base, { phoneNumber: '233542659565' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).callbackUrl, 'http://localhost:4000/callback');
  });
});

test('rejects invalid gateway and callback configuration', async () => {
  for (const env of [
    { MTN_CONSENT_ENV: 'invalid' },
    { MTN_CONSENT_ENV: 'constructor' },
    { RENDER: 'true' },
    { NODE_ENV: 'production', MTN_REDIRECT_URL: 'http://localhost:3000/callback' },
    { MTN_REDIRECT_URL: 'javascript:alert(1)' },
    { MTN_REDIRECT_URL: 'http://example.com/callback' },
    { MTN_REDIRECT_URL: 'https://user:password@example.com/callback' },
    { MTN_REDIRECT_URL: 'https://example.com/callback#fragment' },
  ]) {
    await withApp({ env }, async base => {
      assert.equal((await consent(base, { phoneNumber: '233542659565' })).status, 503);
    });
  }
});

test('diagnostic logs identify requests without logging credentials or callback values', async () => {
  const lines = [];
  await withApp({
    logger: line => lines.push(line),
    env: {
      MTN_API_KEY: 'private-api-key', MTN_REDIRECT_URL: 'https://example.com/callback?token=private-token',
    },
  }, async base => {
    const res = await consent(base, { phoneNumber: '233542659565' });
    const data = await res.json();
    assert.equal(data.requestId, res.headers.get('X-Request-Id'));
    const prepared = lines.map(line => JSON.parse(line)).find(line => line.event === 'consent_prepared');
    assert.equal(prepared.requestId, data.requestId);
    assert.equal(prepared.callbackUrl, 'https://example.com/callback');
    assert.equal(prepared.environment, 'staging');
    const cb = await fetch(`${base}/callback?token=private-token`, {
      method: 'POST', body: 'private-body',
    });
    const cbHtml = await cb.text();
    assert.ok(cbHtml.includes(cb.headers.get('X-Request-Id')));
    const callback = lines.map(line => JSON.parse(line)).find(line => line.event === 'callback_received');
    assert.deepEqual(callback.queryParameterNames, ['token']);
    assert.equal(callback.bodyBytes, 12);
    const logged = lines.join('\n');
    for (const value of ['private-api-key', 'private-token', 'private-body', '233542659565']) {
      assert.ok(!logged.includes(value));
    }
    const bad = await consent(base, { phoneNumber: 'bad' });
    assert.equal(bad.status, 400);
    const completed = lines.map(line => JSON.parse(line)).find(line => line.requestId === bad.headers.get('X-Request-Id'));
    assert.equal(completed.status, 400);
  });
});

test('rejects invalid phone numbers and malformed JSON', async () => {
  await withApp({ env: {} }, async base => {
    assert.equal((await consent(base, { phoneNumber: '123' })).status, 400);
    assert.equal((await consent(base, null)).status, 400);
    const malformed = await fetch(`${base}/api/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
  });
});

test('callback preserves repeated query parameters and escapes HTML', async () => {
  await withApp({}, async base => {
    const res = await fetch(`${base}/callback?status=pending&status=success&unsafe=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /pending/);
    assert.match(html, /success/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes('<script>alert'));
  });
});

test('callback displays JSON, form values, and raw POST bodies', async () => {
  await withApp({}, async base => {
    for (const [type, body, expected] of [
      ['application/json', '{"status":"accepted","nested":{"id":42}}', 'accepted'],
      ['application/x-www-form-urlencoded', 'status=yes&status=no', 'yes'],
      ['text/plain', 'callback raw data', 'callback raw data'],
    ]) {
      const res = await fetch(`${base}/callback?transactionId=123`, {
        method: 'POST', headers: { 'Content-Type': type }, body,
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /transactionId/);
      assert.ok(html.includes(expected));
      assert.match(html, /rawBody/);
    }
  });
});

test('rejects oversized callbacks and cross-origin consent requests', async () => {
  await withApp({}, async base => {
    const large = await fetch(`${base}/callback`, { method: 'POST', body: 'x'.repeat(65537) });
    assert.equal(large.status, 413);
    const crossOrigin = await fetch(`${base}/api/consent`, {
      method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '233542659565' }),
    });
    assert.equal(crossOrigin.status, 403);
  });
});
