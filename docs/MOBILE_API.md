# Crew Ask mobile API handoff

## Production endpoints

- API base URL: `https://crewdesk-six.vercel.app/api`
- Health check: `GET https://crewdesk-six.vercel.app/health`
- Client mobile app portal header: `X-Portal: client`
- Staff mobile app portal header: `X-Portal: staff`

Successful responses have this envelope:

```json
{ "data": {} }
```

Errors have this envelope:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Some fields are invalid.",
    "details": [{ "field": "contact", "message": "Required" }],
    "requestId": "server-request-id"
  }
}
```

## Authentication requirements

Crew Ask currently uses opaque server-side sessions in secure `HttpOnly` cookies. It does **not** return a JWT or bearer token. The mobile HTTP client must enable a persistent cookie jar and retain every `Set-Cookie` response.

For every request:

- Send `X-Portal: client` for the customer mobile app, or `X-Portal: staff` for an internal staff app.
- Send stored cookies back to the API.
- Send `Content-Type: application/json` when there is a JSON body.

Before any `POST` or `PATCH`:

1. Call `GET /auth/csrf` using the same cookie jar.
2. Keep `data.csrfToken` in memory.
3. Send that value as `X-CSRF-Token` on the write request.

Native requests normally do not send a browser `Origin` header. If the app is implemented as a web app or WebView and sends `Origin`, that exact HTTPS origin must first be added to the backend's `ALLOWED_ORIGINS` configuration.

## Client OTP sign-in and signup

### 1. Create the CSRF session

```http
GET /api/auth/csrf
X-Portal: client
```

Example response:

```json
{ "data": { "csrfToken": "token-returned-by-server" } }
```

Keep both the returned token and the CSRF cookie.

### 2. Request a sign-in code

```http
POST /api/auth/client/request-otp
X-Portal: client
X-CSRF-Token: token-returned-by-server
Content-Type: application/json
```

Email body:

```json
{
  "channel": "email",
  "contact": "person@example.com",
  "intent": "signin"
}
```

SMS body:

```json
{
  "channel": "sms",
  "contact": "+14165550123",
  "intent": "signin"
}
```

Example response:

```json
{
  "data": {
    "challengeId": "challenge-uuid",
    "expiresAt": "2026-09-22T12:05:00.000Z",
    "resendAt": "2026-09-22T12:00:30.000Z",
    "message": "A verification code was sent."
  }
}
```

If the email/phone is not linked to a client account, no code is sent. The response is `{ "data": { "registrationRequired": true, "message": "This email or phone is not connected to a client account. Please create an account first." } }`. Send the user to the signup form and preserve their entered contact.

### 3. Request a signup code

```json
{
  "channel": "email",
  "contact": "person@example.com",
  "intent": "signup",
  "name": "Person Name",
  "companyName": "Example Company",
  "secondary": "+14165550123"
}
```

`secondary` is optional. When the main channel is `email`, it is a phone number; when the main channel is `sms`, it is an email address. A phone number should be sent in international E.164 form such as `+14165550123`.

### 4. Verify the six-digit code

```http
POST /api/auth/client/verify-otp
X-Portal: client
X-CSRF-Token: token-returned-by-server
Content-Type: application/json
```

```json
{
  "challengeId": "challenge-uuid",
  "code": "123456"
}
```

The response sets the authenticated `HttpOnly` client session cookie. Keep it in the same cookie jar.

```json
{
  "data": {
    "user": {
      "id": "user-uuid",
      "kind": "client",
      "name": "Person Name",
      "companyId": "company-uuid",
      "status": "active"
    },
    "expiresAt": "2026-09-23T00:00:00.000Z"
  }
}
```

Codes expire after five minutes, allow five attempts, and have a 30-second resend cooldown. A newly requested code invalidates the previous one.

### Session endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/me` | Restore the current signed-in user and session expiry |
| POST | `/auth/logout` | Revoke the current session and clear its cookie |

## Client application endpoints

All endpoints below require the authenticated client cookie and `X-Portal: client`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/client/dashboard` | Home metrics plus initial crew requests and jobs |
| GET | `/client/company` | Signed-in client's company and bounded worksite context |
| GET | `/client/account` | Signed-in client's profile |
| GET | `/client/worksites` | Paginated worksite list |
| GET | `/client/worksites/:id` | One authorized worksite |
| POST | `/client/worksites` | Create a worksite |
| PATCH | `/client/worksites/:id` | Update a worksite using its current `version` |
| GET | `/client/labour` | Paginated crew-request list |
| GET | `/client/labour/:id` | Crew-request detail |
| POST | `/client/labour` | Create a crew request |
| POST | `/client/labour/:id/change-request` | Ask staff to change an existing request |
| POST | `/client/labour/:id/cancellation-request` | Ask staff to cancel a request |
| GET | `/client/labour/:id/messages` | Paginated shared messages |
| POST | `/client/labour/:id/messages` | Send a shared message |
| GET | `/client/jobs` | Paginated job/role list |
| GET | `/client/jobs/:id` | Job detail and published profiles |
| POST | `/client/jobs` | Create a job/role |
| GET | `/client/jobs/:id/profiles` | Paginated published candidate profiles |

List query parameters:

- `page`: integer, default `1`
- `limit`: integer `1-100`, default `25`
- `search`: optional text
- `status`: applicable status filter or `all`

List response shape:

```json
{
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 25, "total": 0, "pages": 0 },
    "related": { "companies": [] }
  }
}
```

## Create/update payloads

### Create a worksite

Send an `Idempotency-Key` header containing a UUID.

```json
{
  "name": "Toronto Warehouse",
  "address": "100 Example Street, Toronto, ON",
  "zone": "America/Toronto",
  "contactName": "Site Supervisor",
  "contactPhone": "+14165550123",
  "notes": "Use the east entrance",
  "ppe": ["Steel-toe boots", "High-vis vest"]
}
```

Supported zones are `America/Toronto`, `America/Winnipeg`, `America/Edmonton`, `America/Vancouver`, `America/New_York`, `America/Chicago`, `America/Denver`, and `America/Los_Angeles`.

For `PATCH /client/worksites/:id`, send the same fields plus the current numeric `version`.

### Create a crew request

Send an `Idempotency-Key` header containing a UUID.

```json
{
  "role": "Forklift Operator",
  "headcount": 4,
  "siteId": "worksite-uuid",
  "mode": "range",
  "start": "2026-10-01",
  "end": "2026-10-05",
  "days": [],
  "dates": [],
  "startTime": "07:00",
  "endTime": "15:30",
  "equipment": "Counterbalance forklift",
  "tickets": ["WHMIS", "Forklift"],
  "licences": ["AZ"],
  "ppe": ["Steel-toe boots", "High-vis vest"],
  "contactName": "Site Supervisor",
  "contactPhone": "+14165550123",
  "notes": "Report 15 minutes early"
}
```

Schedule modes:

- `one`: one date in `start`; omit or send an empty `end`.
- `range`: every date from `start` through `end`.
- `weekly`: `start`, optional `end`, and `days` where Sunday is `0` and Saturday is `6`.
- `dates`: send 1-100 unique `YYYY-MM-DD` values in `dates`.

Times use local `HH:mm` wall-clock format. An end time earlier than the start time means an overnight shift.

### Request a crew change

```json
{
  "version": 3,
  "headcount": 6,
  "startTime": "08:00",
  "endTime": "16:00",
  "reason": "Production requirements changed"
}
```

### Request cancellation

```json
{ "version": 3, "reason": "Shift is no longer required" }
```

### Send a message

```json
{ "text": "Please confirm the arrival instructions." }
```

### Create a job/role

Send an `Idempotency-Key` header containing a UUID.

```json
{
  "title": "Warehouse Supervisor",
  "description": "Lead the afternoon warehouse team.",
  "start": "2026-10-01",
  "end": "2026-12-31",
  "location": "Toronto, ON",
  "workType": "Contract",
  "openings": 1,
  "licences": ["AZ"]
}
```

`workType` must be one of `Contract`, `Temp`, `Temp-to-perm`, or `Permanent`.

## Staff authentication and API

An internal staff app uses the same CSRF/cookie flow but sends `X-Portal: staff`.

```http
POST /api/auth/staff/request-otp
X-Portal: staff
X-CSRF-Token: token-returned-by-server
Content-Type: application/json
```

```json
{ "channel": "email", "contact": "staff@markshr.com" }
```

Verify the resulting code with `POST /api/auth/staff/verify-otp` using `{ "challengeId", "code" }`; the response sets a separate staff session cookie. Use `channel: "sms"` with an authorized staff mobile number for mobile-code sign-in. Staff endpoints include:

- `/staff/dashboard`, `/staff/metrics`, `/staff/search`
- `/staff/companies`, `/staff/accounts`, `/staff/activity`, `/staff/worksites`
- `/staff/labour`, `/staff/jobs`
- Company activation/suspension and merge operations
- Account creation/link/merge operations
- Crew acceptance, confirmations, shared messages and internal notes
- Job status, internal notes and candidate profile operations

The exact staff request bodies are documented in [`API.md`](./API.md).

## Retry, concurrency and polling rules

- Create requests require `Idempotency-Key: <UUID>`.
- Reuse the same idempotency key and unchanged body when retrying an uncertain create request.
- Records contain a numeric `version`. Send the version received from the API on updates.
- `409 STALE_VERSION` means another user changed the record. Refetch it before retrying.
- Allow at least a 30-second HTTP timeout because a Vercel/MongoDB cold start can take longer than a warm request.
- The Vercel deployment does not provide persistent Socket.IO connections. Refresh lists after a mutation and poll the active screen approximately every 30 seconds, or offer pull-to-refresh.
- Do not send unknown properties. Request schemas are strict and reject additional fields.

Common statuses are `400` validation/OTP, `401` unauthenticated, `403` forbidden or CSRF, `404` inaccessible record, `409` conflict, `422` invalid workflow, `429` rate limit, and `503` temporarily unavailable.

## Mobile implementation checklist

- Use one persistent cookie jar per signed-in portal/account.
- Keep the CSRF token in memory; request another after an app restart or a `CSRF_INVALID` response.
- Never try to read the `HttpOnly` session cookie from application JavaScript.
- Clear the cookie jar and local user cache after logout or a `401` response.
- Store no staff password or OTP after authentication.
- Treat all `id`, `_id`, reference number, date, and time fields as strings unless explicitly documented as numeric.
- Use the response envelope and display `error.message`; log `error.requestId` for support.
