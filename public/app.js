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
  status.textContent = 'Waiting for MTN…';
  result.hidden = true;
  try {
    const res = await fetch('/api/consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await res.json();
    status.textContent = data.ok
      ? 'MTN accepted the API request. Check the response for the consent or subscription status.'
      : data.error || `MTN returned HTTP ${data.upstreamStatus}. See the response below.`;
    response.textContent = JSON.stringify(data, null, 2);
    result.hidden = false;
  } catch {
    status.textContent = 'Could not reach the server. Check your connection and try again.';
  } finally {
    button.disabled = false;
    button.textContent = 'Submit';
  }
});
