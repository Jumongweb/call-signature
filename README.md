# MTN Call Signature

Small Node.js application for MTN Ghana Call Signature consent. Requires Node.js 20.12 or newer. No dependencies to install.

## Run locally

1. Copy `.env.example` to `.env` if needed.
2. Run `npm start`.
3. Open http://localhost:3000. The test number `233542659565` is prefilled. Submit opens MTN’s interactive consent portal in the same browser tab.

No API key is required by the consent URL documented in the supplied screenshot. Any existing `MTN_API_KEY` is ignored. There is no subscription API call.

Restart after changing `.env`. Hosting environment variables take precedence over `.env`.

## Configuration and deployment

Set these variables in `.env` locally or in your host’s Environment settings:

```dotenv
MTN_OFFER_ID=9931110005
MTN_CONSENT_ENV=staging
MTN_REDIRECT_URL=https://YOUR-HOST/callback
```

Use your actual public HTTPS host for deployment. Local development defaults to `http://localhost:3000/callback` (or the configured `PORT`). MTN may require the return URL to be registered or allowlisted; confirm its requirements with your contact.

`MTN_CONSENT_ENV=staging` selects `https://sitcg.mtn.com.gh/Portal`. Use `production` to select `https://cg.mtn.com.gh/Portal`. Confirm the offer’s target environment with MTN before switching.

The server builds a URL with exactly these documented, case-sensitive query parameters:

- `OfferCode`: `9931110005`
- `mobileNumber`: the entered Ghana phone number
- `redirectUrl`: the configured callback URL

The browser navigates to MTN to complete consent. The non-header-enrichment flow uses HTTPS, as specified in the screenshot. The server does not fetch the portal, collect consent itself, or call `/subscriptions`.

On Render, use a Node Web Service with build command `npm install` and start command `npm start`. Let the host provide `PORT`. Set the three variables above, especially `MTN_REDIRECT_URL`, before testing the deployed flow.

## Callback

Example: http://localhost:3000/callback?status=success&phoneNumber=233542659565

The route accepts GET and POST and displays all query values (including repeated names), the parsed POST body, and the raw body. HTML is escaped. It echoes whichever parameters MTN sends without assuming their names or treating the redirect as authenticated proof of activation.

Responses are not stored; reopening the URL does not retrieve an earlier callback. The screenshot does not define callback parameter names or guarantee that a local return URL is accepted. A full live test requires completing MTN’s portal and observing the browser return.

## Verification

Run `npm test`. Tests verify the documented consent URL, offer code, staging/production selection, callback encoding, input validation, and callback viewer. They do not contact MTN or complete a live consent flow.

## Debug a deployed attempt

1. Push these changes and deploy that commit. In Render's Environment settings, check `MTN_CONSENT_ENV`, `MTN_OFFER_ID`, and `MTN_REDIRECT_URL`. Local `.env` changes do not update Render's environment settings.
2. Open the service's **Logs** screen for the current time, rather than only the historical deployment log. At startup, `consent_configuration` shows the effective gateway, offer code, and callback origin/path. `configuration_error` means the settings need correction. Hosted requests reject localhost callbacks.
3. In your browser's developer tools, open Network, enable Preserve log, and select **All** so you can see page navigations as well as fetch requests. Also enable Preserve log in Console if you want the request ID to remain after navigating to MTN.
4. Submit the test number once. In Network, inspect `/api/consent`: HTTP 200 means our server prepared a URL. Copy its `requestId`, `consentUrl`, and `callbackUrl`. Find the matching `consent_prepared` and `request_completed` events in Render Logs. No outbound MTN request is made by Render.
5. Inspect the subsequent `/Portal` navigation and redirects under the MTN domain. Check the final URL, any transaction ID, and responses for failed document or fetch requests. Even HTTP 200 on an MTN page can contain an application error. Errors inside MTN's portal will appear in the browser or MTN's own logs, not our Render logs.
6. When the browser returns to `/callback`, `callback_received` records a separate request ID, query parameter names, and body size. The page displays the actual received parameters. A manual visit produces the same event and does not confirm consent. Request IDs are local diagnostics and are not sent as additional parameters to MTN, so use timestamps to compare the two legs.
7. If MTN fails, give its support contact the exact test time/timezone, MTN transaction ID, gateway environment, offer, test number, and callback URL. Ask them to check offer configuration, test-number eligibility, and callback registration. Avoid changing several settings at once or switching to production without confirmation.

Logs omit API keys, full phone numbers, callback query values, and callback bodies. The browser's `consentUrl` still contains the phone number; share diagnostic captures only with the intended recipient. Logs are diagnostic metadata, not a callback archive.
