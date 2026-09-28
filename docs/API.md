# Crew Ask API contract

The approved portals are served from the same origin as `/api`. Successful API responses use `{ "data": ... }`. The current controller returns HTTP 200 on successful writes, including creates. Errors use `{ "error": { "code", "message", "details"?, "requestId"? } }`.

## Authentication and security headers

Use `X-Portal: client` or `X-Portal: staff`. The two portals have separate session and CSRF cookie names so staff and client sessions can coexist in one browser. Cookies are HttpOnly and SameSite Strict; production adds Secure and the `__Host-` prefix. Sessions are opaque, revocable database records, not JWTs stored in browser storage.

First call `GET /api/auth/csrf`. Retain the returned `csrfToken` in memory and send it as `X-CSRF-Token` on POST/PATCH requests. Include cookies. JSON writes use `Content-Type: application/json`. State-changing requests from an unapproved Origin are rejected. The actual frontend performs these steps automatically.

Create routes require `Idempotency-Key`, a 16-100 character value containing letters, digits, `_` or `-`; a random UUID is suitable. Other mutations also support it and the frontend sends it. Reuse the same key and same payload to retry the same operation. Reusing it for different input returns 409. Receipts and domain writes commit together. Keep an uncertain submission unchanged when retrying; after reloading the browser, check the request list before intentionally submitting a new request.

| Method | Route | Body / result |
|---|---|---|
| GET | `/api/auth/csrf` | Returns CSRF token and sets signed CSRF cookie |
| POST | `/api/auth/client/request-otp` | `channel: email|sms`, `contact`, `intent: signin|signup`; signup also supports `name`, `companyName`, `secondary`. An unrecognised `signin` contact returns `{registrationRequired:true}` without sending a code. |
| POST | `/api/auth/client/verify-otp` | `challengeId`, six-character `code`; sets client session cookie |
| POST | `/api/auth/staff/request-otp` | `channel: email|sms`, authorized `contact`; sends a staff verification code |
| POST | `/api/auth/staff/verify-otp` | `challengeId`, six-character `code`; sets staff session cookie |
| GET | `/api/auth/me` | Current user DTO and session expiry |
| POST | `/api/auth/logout` | Revokes this portal session and disconnects its sockets |

OTP challenges expire after five minutes, permit five verification attempts and are single-use. Resends have a 30-second cooldown and supersede earlier pending codes. Request and verification paths have additional IP/destination limits. Actual timing is checked server-side even if MongoDB has not yet removed an expired document through its TTL index.

## Shared reads

Below, `{portal}` is `client` or `staff`. Client reads are always limited to the company from the session.

| Method | Route | Result |
|---|---|---|
| GET | `/api/{portal}/dashboard` | Server-derived metrics and bounded initial lists |
| GET | `/api/{portal}/labour` | Paginated request list |
| GET | `/api/{portal}/labour/:id` | Request detail and authorized related company summary |
| GET | `/api/{portal}/labour/:id/messages` | Paginated shared conversation |
| GET | `/api/{portal}/jobs` | Paginated role list |
| GET | `/api/{portal}/jobs/:id` | Role detail with only permitted profiles |
| GET | `/api/{portal}/jobs/:id/profiles` | Paginated profiles; clients receive published profiles only |
| GET | `/api/{portal}/worksites` | Paginated worksite list |
| GET | `/api/{portal}/worksites/:id` | An authorized worksite, including selections outside the initial context page |

Request/job `:id` accepts the UUID or human reference (`CR-*`, `JR-*`). List inputs use `page` (default 1), `limit` (default 25, maximum 100), `search` and applicable `status`. Staff lists also accept `companyId`; it is not used to authorize client access. Staff inbox search includes company names/aliases through a server-side company lookup. Global staff search queries companies, people, requests, roles and worksites separately.

A list returns `items`, `pagination: { page, limit, total, pages }`, and optional `related.companies`. Request status filtering follows the next scheduled date's confirmation count, with cancelled/need-info precedence, rather than incorrectly using only the raw recurring phase.

## Client writes

| Method | Route | Fields |
|---|---|---|
| GET | `/api/client/company` | Own company context; `null` when awaiting association |
| GET | `/api/client/account` | Own account |
| POST | `/api/client/worksites` | Worksite fields below |
| PATCH | `/api/client/worksites/:id` | Worksite fields + `version` |
| POST | `/api/client/labour` | Crew fields below |
| POST | `/api/client/labour/:id/messages` | `text` |
| POST | `/api/client/labour/:id/change-request` | `version`, `headcount`, `startTime`, `endTime`, `reason` |
| POST | `/api/client/labour/:id/cancellation-request` | `version`, `reason` |
| POST | `/api/client/jobs` | Job fields below |

Worksite fields: `name`, `address`, `zone` (approved IANA zone), `contactName`, `contactPhone`, optional `notes`, `ppe[]`. The API uses `zone` to remain compatible with the approved frontend. Requests store a copied `site` snapshot, not a mutable reference-only rendering.

Crew fields: `role`, `headcount` (integer 1-500), `siteId`, `mode: one|range|weekly|dates`, `start`, optional `end`, `days[]`, `dates[]`, `startTime`, `endTime`, `equipment`, `tickets[]`, `licences[]`, `ppe[]`, `contactName`, `contactPhone`, `notes`. Weekly `days` use Sunday=0 through Saturday=6. Individual dates are unique and limited to 100. Start/end times are local `HH:mm` wall-clock values; equal times are invalid and an earlier finish denotes the next day. No UTC conversion is applied to those wall-clock fields.

Job fields: `title`, `description`, `start`, `end`, `location`, `workType: Contract|Temp|Temp-to-perm|Permanent`, `openings` (integer 1-500), `licences[]`.

Unknown JSON properties are rejected by strict request schemas. Do not send browser draft-only fields, `companyId`, creator identity, statuses, confirmations or internal notes to client create routes.

## Staff administration

| Method | Route | Fields / behavior |
|---|---|---|
| GET | `/api/staff/metrics` | Counts and server notification cutoff |
| GET | `/api/staff/companies` | Search/status/page/limit |
| GET | `/api/staff/companies/:id` | Profile, bounded worksites and exact totals |
| PATCH | `/api/staff/companies/:id` | `version`, name, industry, email, phone, billingContact, defaultShifts, tickets, licences, ppe, notes |
| PATCH | `/api/staff/companies/:id/status` | `version`, `status: active|suspended` |
| POST | `/api/staff/companies/:id/worksites` | Worksite fields |
| PATCH | `/api/staff/companies/:companyId/worksites/:id` | Worksite fields + version; both company and site must match |
| POST | `/api/staff/companies/merge` | `sourceId`, `targetId`, `sourceVersion`, `targetVersion`, `confirm: true` |
| GET | `/api/staff/accounts` | Search/company/page/limit; `filter: assigned|unassigned` |
| GET | `/api/staff/accounts/:id` | Active client contact |
| GET | `/api/staff/accounts/duplicates` | Exact normalized `email` and/or `phone` lookup |
| POST | `/api/staff/accounts` | `name`, email and/or phone, optional `companyId` |
| POST | `/api/staff/accounts/:id/link` | `version`, destination `companyId`, `confirm: true` |
| POST | `/api/staff/accounts/merge` | Source/target IDs and versions, chosen companyId (nullable), `confirm: true` |
| GET | `/api/staff/activity` | Paginated persistent audit feed |
| POST | `/api/staff/events/mark-read` | `through`: server-provided `metrics.asOf` timestamp |
| GET | `/api/staff/search?q=...` | Separately paginated result groups |

Shifts contain `id`, `name`, `startTime`, `endTime`; keep 1-30 uniquely named templates. A normal link/move changes a person's access, not historical request ownership. It revokes that person's existing sessions. Company merge re-associates operational records and preserves original site snapshots; person merge transfers creator references and contact aliases. Sources remain soft-merged history records. Oversized combined notes/requirements are rejected rather than truncated.

## Staff operations

| Method | Route | Fields |
|---|---|---|
| POST | `/api/staff/labour/:id/accept` | `version` |
| POST | `/api/staff/labour/:id/messages` | `text`, optional `needInfo: true` |
| PATCH | `/api/staff/labour/:id/internal-note` | `version`, `text` |
| POST | `/api/staff/labour/:id/confirm` | `version`, scheduled `date`, integer `count` from 0 to headcount |
| POST | `/api/staff/labour/:id/resolve-change` | `version`, `pendingId`, `approve`; resolves the current change or cancellation |
| PATCH | `/api/staff/jobs/:id/status` | `version`, `status: new|sourcing|shortlist|closed` |
| PATCH | `/api/staff/jobs/:id/internal-note` | `version`, `text` |
| POST | `/api/staff/jobs/:id/profiles` | `version`, `name`, `summary`, `resumeText` |

Acceptance, confirmation, sourcing and shortlist publication require an active company. Change approval resets the existing fills because requirements changed. Cancellation approval changes phase to cancelled without deleting history. Published profiles stay shared when a role status changes; a newly added profile remains a draft until a further shortlist publication.

## Concurrency, errors and sockets

Record versions are explicit integers. Send the version that was loaded into the form. A stale update returns `409 STALE_VERSION` rather than overwriting another person's change. On a conflict, the frontend retains the form/error; reload and reconcile before submitting again.

Typical error statuses: 400 validation, 401 missing/expired session, 403 forbidden/CSRF, 404 missing or inaccessible tenant record, 409 stale/duplicate/idempotency conflict, 413 oversized body, 422 invalid workflow state, 429 rate limit, 500 unexpected error, 503 unavailable database/provider.

Socket.IO requires the corresponding session cookie and `{ portal, csrfToken }` handshake auth from an allowed origin. Only the server assigns user/company/staff/session rooms. `invalidate` events contain a type, record reference and timestamp, not request bodies or private notes. Clients refetch authorized REST resources. A 30-second reconciliation poll recovers missed updates; dirty forms defer automatic rerendering.
