# Focused HTTP request budgets

Authenticated HTTP requests use `packages/platform/src/rateLimit.ts` after session validation and before application dispatch. PostgreSQL's existing `social_rate_windows` table stores one row per user and fixed bucket. A single atomic UPSERT admits exactly the configured number across concurrent web processes. The first admitted request starts a 60-second window; expiration resets its count. Rejected requests neither increase an already saturated counter nor extend its expiration. Account erasure cascades these rows.

| Requests                                                                    | Bucket                     | Requests / 60 seconds |
| --------------------------------------------------------------------------- | -------------------------- | --------------------: |
| Creator publish or unpublish                                                | `http:creator_publish`     |                    20 |
| Creator discovery, with or without filters                                  | `http:creator_discovery`   |                    60 |
| User search, server discovery, room/thread message search with nonempty `q` | `http:search`              |           60 combined |
| Marketplace offer creation                                                  | `http:market_offer_create` |                    20 |
| Marketplace listing creation                                                | `http:market_list`         |                    30 |
| Marketplace buy/cancel, offer accept/reject/cancel, collectible transfer    | `http:market_mutation`     |          120 combined |

These limits count requests before domain validation, including failed requests and operation-ID retries. A financial operation remains idempotent: a retry that receives 429 can be retried after the window expires without creating a duplicate trade. Offer creation additionally retains its domain limit of ten successful creations in a rolling minute and twenty pending outgoing offers.

Normal chat polling, level input synchronization, ranked Ego input and other game actions do not consume these buckets. Existing social creation/upload/comment limits, Creator attempt-start limits, GIF search limits and the separately authorized link-preview budgets remain in place.

Native authentication uses a separate limiter in `packages/auth/src/rateLimit.ts` and additive migration `031_auth_request_budgets.sql`. Origin-valid native POST requests consume a shared **120 requests/minute** transport budget before content-type checks, body reads, JSON parsing, schemas or password hashing. Malformed and oversized requests consume this quota. Cross-origin requests fail the Origin check before expensive work. Development fixture login and read-only auth status retain their separate paths. Discovery remains authenticated and uses the table above; there is no public anonymous username-availability endpoint. Former Google endpoints are unavailable.

The framework request has no verified socket address. The limiter therefore ignores `Forwarded`, `X-Forwarded-For` and `X-Real-IP`. A deployment may set `AUTH_TRUSTED_PROXY_SECRET` to 32–256 bytes and have its reverse proxy **overwrite** `X-Tell-Aviv-Proxy-Secret` and `X-Tell-Aviv-Client-IP` with that secret and the actual remote socket host. A constant-time digest comparison authenticates the proof; only one valid IPv4 or IPv6 address is accepted. IPv6 forms and IPv4-mapped IPv6 addresses normalize to one source. Attested sources also consume a shared **30 requests/minute** native transport quota. The proxy must strip/overwrite incoming attestation headers, protect the secret and prevent direct untrusted access to its backend. The supplied Caddy configuration overwrites both headers; deployments with another proxy need equivalent behavior.

Without valid proof, the global budget and normalized identity budgets still protect native endpoints; there is no claimed per-source protection. Unknown, disabled and existing accounts use the same login identity budget. Request-supplied headers never select a quota namespace. Production ignores the server-side `AUTH_RATE_NAMESPACE` setting, which only permits isolated integration test rows under `NODE_ENV=test`.

| Native operation                                                                                              | Requests per normalized identity | Window     |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------: | ---------- |
| Login, reauthentication, email-token verification                                                             |                                8 | 15 minutes |
| Password change, password-link reset, recovery-code reset, one-device revocation, logout other devices        |                                5 | 15 minutes |
| Password-recovery request                                                                                     |                                5 | 1 hour     |
| Registration, recovery-code generation, email change, send verification email, development password bootstrap |                                3 | 1 hour     |

Core credential handlers consume identity budgets after bounded schema validation and before password verification/hashing, outside their account transaction. Identifiers normalize with NFC, trimming and lowercase; authenticated operations use the server-resolved user ID. SQL stores only domain-separated SHA-256 scope hashes and fixed bucket names, with no raw username, email, IP or account foreign key. Atomic UPSERTs admit the exact concurrent boundary and keep accounting committed when later application work fails. Rejected requests return the standard structured `429 rate_limited` response without moving the original expiry.

Windows retain at most one hour beyond their active window; each new shared global window removes at most 500 expired rows and rechecks expiry before deletion. At 120 admitted transport requests/minute, a caller can introduce at most 240 source/identity rows/minute, below the cleanup capacity. No live account quota or credential record is removed by this housekeeping.

`tests/http-rate-limit-database.test.ts` verifies exact concurrent admission, saturated counter/window preservation, expired-window reset, a shared search bucket, independent user/mutation buckets, and durable request accounting when later application work rolls back. It also verifies that frequent game inputs and ordinary chat polling bypass the selector.

`tests/http-rate-limit-api.test.ts` exercises the actual API dispatcher with real stored sessions: concurrent publication/discovery reach the exact boundary, rejected responses contain a structured 429, invalid marketplace requests retain their request count, unsigned requests consume no authenticated budget, and ordinary game metadata remains available after search saturation.

`tests/native-auth-security-rate.test.ts` covers forged/ambiguous headers, IPv6 normalization, absent proxy configuration, exact concurrent quota, unchanged saturated expiry, failed-work accounting, bounded cleanup and isolated test scopes. `tests/native-auth-security-api.test.ts` exercises the actual dispatcher: malformed/type/oversized bodies, CSRF origins, rate rejection before JSON parsing, session rotation and old-token rejection, ambiguous cookies, private credential exclusion and absent-user failures under changing forged IP headers.
