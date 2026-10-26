import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

async function withApp(options, run) {
  const server = createApp(options);
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

test('submits the exact supplied MTN request with the selected phone number', async () => {
  let calls = 0;
  await withApp({
    env: { MTN_API_KEY: 'secret-test-key' },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://preprod-mtn-ghana.api.mtn.com/v2/customers/233542659565/subscriptions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-api-key'], 'secret-test-key');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(JSON.parse(options.body), {
        nodeId: '211', subscriptionId: '9921110005',
        registrationChannel: 'WEB', subscriptionProviderId: 'SM6D',
      });
      return new Response(JSON.stringify({ status: 'pending' }), { status: 202 });
    },
  }, async base => {
    const res = await consent(base, { phoneNumber: '+233 54 265 9565' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.upstreamStatus, 202);
    assert.deepEqual(body.response, { status: 'pending' });
    assert.equal(calls, 1);
  });
});

test('rejects bad input and missing configuration before calling MTN', async () => {
  await withApp({ env: {}, fetchImpl: () => assert.fail('must not call MTN') }, async base => {
    assert.equal((await consent(base, { phoneNumber: '123' })).status, 400);
    assert.equal((await consent(base, null)).status, 400);
    const missing = await consent(base, { phoneNumber: '233542659565' });
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /MTN_API_KEY/);
    const malformed = await fetch(`${base}/api/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
  });
});

test('returns MTN failures and redacts an echoed API key', async () => {
  await withApp({
    env: { MTN_API_KEY: 'secret-test-key' },
    fetchImpl: async () => new Response('Rejected secret-test-key', { status: 401 }),
  }, async base => {
    const res = await consent(base, { phoneNumber: '233542659565' });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.upstreamStatus, 401);
    assert.equal(body.response, 'Rejected [REDACTED]');
  });
});

test('handles network failures and timeouts', async () => {
  for (const [name, expected] of [['TypeError', 502], ['TimeoutError', 504]]) {
    await withApp({
      env: { MTN_API_KEY: 'secret-test-key' },
      fetchImpl: async () => { throw Object.assign(new Error('private upstream details'), { name }); },
    }, async base => {
      const res = await consent(base, { phoneNumber: '233542659565' });
      assert.equal(res.status, expected);
      assert.ok(!(await res.text()).includes('private upstream details'));
    });
  }
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

test('rejects oversized callbacks and cross-origin subscription requests', async () => {
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
