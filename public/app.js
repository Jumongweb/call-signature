const form = document.querySelector('#consent-form');
const button = document.querySelector('#submit');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const response = document.querySelector('#response');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const phoneNumber = document.querySelector('#phone').value.trim().replace(/[\s()+-]/g, '');
  if (!/^233\d{9}$/.test(phoneNumber)) {
    status.textContent = 'Enter a valid Ghana number, e.g. 233542659565.';
    result.hidden = true;
    return;
  }
  button.disabled = true;
  button.textContent = 'Submitting…';
  status.textContent = 'Preparing MTN consent page…';
  result.hidden = true;
  try {
    const res = await fetch('/api/consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await res.json();
    console.info('Consent request', {
      requestId: data.requestId || res.headers.get('X-Request-Id'),
      status: res.status,
      message: res.ok ? 'Consent URL prepared; MTN consent is not yet confirmed.' : data.error,
    });
    if (res.ok && data.ok && data.consentUrl) {
      status.textContent = 'Opening MTN’s consent page…';
      window.location.assign(data.consentUrl);
      return;
    }
    status.textContent = data.error || 'Could not prepare the MTN consent page.';
    response.textContent = JSON.stringify(data, null, 2);
    result.hidden = false;
  } catch {
    status.textContent = 'Could not reach the server. Check your connection and try again.';
  } finally {
    button.disabled = false;
    button.textContent = 'Submit';
  }
});
