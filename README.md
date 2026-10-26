# MTN Call Signature

Small Node.js application using the supplied MTN Ghana preproduction subscription API. Requires Node.js 20.12 or newer. No dependencies to install.

## Run

1. Set `MTN_API_KEY=your-real-api-key` in `.env` in this project directory. If `.env` is missing, copy `.env.example` to `.env` first. `.env` is ignored by Git.
2. Run `npm start`.
3. Open http://localhost:3000. The test number `233542659565` is prefilled. Click Submit to make a real preproduction API request.

Restart the server after changing `.env`. Environment variables already set by the hosting environment take precedence over `.env`. The key is used only by the server.

The server posts to `https://preprod-mtn-ghana.api.mtn.com/v2/customers/{phoneNumber}/subscriptions` using the four fields in the supplied curl. Defaults are `nodeId=211`, `subscriptionId=9921110005`, `registrationChannel=WEB`, and `subscriptionProviderId=SM6D`. Optional overrides are listed in `.env.example`. Confirm with MTN whether `subscriptionId` is the intended offer ID and whether this endpoint starts consent or subscribes directly.

## Callback

Callback route: http://localhost:3000/callback

Example: http://localhost:3000/callback?status=success&phoneNumber=233542659565

The route accepts GET and POST and displays all query values (including repeated names), the parsed POST body, and the raw body. HTML is escaped. Responses are not stored; a server-to-server POST is visible to its caller only. Reopening the URL does not retrieve an earlier callback.

For MTN to reach this route, deploy the app on a public HTTPS host and register `https://YOUR-HOST/callback` with MTN using its documented configuration process. A local URL cannot receive external MTN callbacks. The supplied request has no callback URL field, so this implementation does not invent one or assume MTN will invoke it. Obtain the callback setup instructions from MTN to finish that integration. Callback content is displayed for diagnostics and is not treated as authenticated proof of subscription.

## Verification

Run `npm test`. Tests use a mock MTN response and never call the live subscription API. The real API call requires your key and happens when you submit the form. This is a small test app; protect access before exposing the subscription action publicly.
# call-signature
