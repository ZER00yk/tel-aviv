# Native Tell Aviv authentication

Tell Aviv signs users in with a username and password. Google OAuth is no longer a supported authentication path or deployment requirement. Existing UUID user IDs remain the ownership identity for every save, message, class, creation, economy record and achievement; migration `030_native_auth.sql` adds credentials and security records without rewriting that ownership.

Registration canonicalizes a trimmed username to lowercase and enforces the existing 3–24 letter, number or underscore rule. A database uniqueness constraint admits only one concurrent registration of a canonical username. Passwords require 12–128 characters and at most 512 UTF-8 bytes. Password whitespace is significant. Email is optional, private, canonicalized and initially unverified; it is absent from public user responses.

## Passwords and sessions

The auth package uses the native `@node-rs/argon2` binding with Argon2id. Defaults are 65,536 KiB memory, three passes, one lane and a 32-byte output. `AUTH_ARGON_MEMORY_KIB`, `AUTH_ARGON_TIME_COST` and `AUTH_ARGON_PARALLELISM` allow bounded configuration: respectively 19,456–262,144 KiB, 2–10 passes and 1–4 lanes. Each process admits four active hash/verify operations and 32 queued operations; excess work receives a retryable 503. Missing-account login performs a dummy Argon2 verification and uses the same failure as a wrong, disabled or deleted account.

Sessions use random 256-bit opaque tokens. Only SHA-256 digests persist in SQL. Cookies have `Path=/`, `HttpOnly`, `SameSite=Lax`, a 30-day lifetime and `Secure` in production. Ambiguous, malformed, expired, revoked, deleted-account and disabled-account cookies are rejected. Registration/login rotate a presented token, and development password bootstrap revokes every old session before issuing a native session.

Production requires a configured database and HTTPS `APP_URL`. `DEV_AUTH=true` is ignored in a production process. Development login is available only outside production and refuses disabled accounts, existing native credentials and historical external-provider accounts. A signed-in development-only account may set its own password while keeping its UUID and content. There is no shared default password or production development-login bypass. Historical external-provider accounts without native credentials require a separately authorized ownership migration; arbitrary native login cannot claim them.

Password change requires the current password, matching confirmation and a recent session whose credential version still matches. The current session receives the new version. Other sessions are revoked by default; when explicitly retained, they lose recent-authentication proof until the new password is supplied. Password change/reset invalidates all old reset links, verification links and recovery codes.

Recent authentication lasts ten minutes. Password/email changes, recovery-code generation, device revocation, username changes and HTTP account deletion enforce this guard under the account/session locks. The Account Security page supports password change, private email, reauthentication, device/session lists and revocation, recovery codes and recent security events. Lists never include raw session secrets or password hashes. Security events retain the newest 100 rows per account; the page displays 25.

## Recovery and email

Email delivery is enabled only with `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY` and `EMAIL_FROM`. The production adapter sends directly to Resend over HTTPS, rejects redirects and does not log provider payloads, addresses or credentials. A transport interface supports fixture delivery only when `NODE_ENV=test`; no fake transport can activate in production. Live email delivery remains externally unverified in this workspace.

Email verification and reset links use random 256-bit tokens with a twenty-minute expiry, SHA-256 persistent digests, account/credential-version binding and transactional single use. A replacement invalidates the previous link. Changing the email removes verification and outstanding recovery credentials. Password reset delivery requires an enabled native account with a verified private address and a configured provider.

Every admitted forgot-password request returns the same `{ok:true}` body and waits for a two-second response floor, including unknown, unverified and unconfigured accounts. A real reset delivery has a 1.5-second abortable deadline before this floor, and provider timeout/failure records only the `recovery_delivery_failed` event. Delivery runs within the request; there is no detached queue or claimed durable email outbox. This removes the provider-latency distinction under ordinary database latency; exceptional database/host stalls do not have a constant-time guarantee. Failed delivery can be retried within the normal quota. Verification delivery has a five-second deadline and reports failure privately to the signed-in owner.

New email URLs hold the token in `#resetToken=…` or `#verifyEmailToken=…`, avoiding HTTP access-log/referrer query credentials. The persistent app shell consumes initial and later same-document links, removes the credential from browser history while preserving router state, and requires an explicit browser action before consuming it. Old query links are cleared for compatibility, but their original URL can already have reached a server; new links never use that format.

Recovery codes work without an email provider. A password-confirmed, recently authenticated user generates eight random 128-bit codes. Plaintext appears only in that response/UI; SQL stores account-bound digests and the credential version. Regeneration invalidates the old set. A successful code reset invalidates every remaining code and session. Concurrent uses of the same code or reset/verification token admit exactly one winner. Disabled/deleted-account recovery returns the same invalid-credential error without changing a password.

## HTTP contract and abuse limits

All mutation routes require the application origin and a JSON object. The API bounds auth input to 16 KiB, applies anonymous quotas before reading JSON or hashing a password, and marks auth responses `Cache-Control: no-store`. The shared transport budget is 120 native requests/minute; an attested proxy source adds a 30/minute source budget. Client-supplied forwarded addresses do not establish identity. Configure `AUTH_TRUSTED_PROXY_SECRET` only with a proxy that overwrites the secret and client-IP headers; see [HTTP_RATE_LIMITS.md](HTTP_RATE_LIMITS.md).

Account budgets apply equally to missing identities and survive failed credential checks and rolled-back account mutations. Core limits are eight login/reauthentication attempts per fifteen minutes, three registrations per hour, five forgot-password requests per hour, five resets/password changes per fifteen minutes and three recovery-code generations/email changes/verification sends per hour. Scope keys are digested, not plaintext usernames or email. Migration `031_auth_request_budgets.sql` persists quotas and bounded expiry cleanup; test-only namespaces cannot change production quotas.

| Route under `/api/auth`                                    | Method | Behavior                                                 |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `status`                                                   | GET    | Native/dev/email-delivery availability without secrets   |
| `register`, `login`                                        | POST   | Native account creation/sign-in and fresh session cookie |
| `reauthenticate`, `password`                               | POST   | Recent password proof and guarded password change        |
| `password/bootstrap`                                       | POST   | Guarded development account conversion                   |
| `forgot-password`, `reset-password`                        | POST   | Neutral request and one-use email recovery               |
| `email`, `email/send-verification`, `email/verify`         | POST   | Private email change and one-use verification            |
| `recovery-codes/regenerate`, `recovery-codes/reset`        | POST   | One-time recovery-code generation/reset                  |
| `security`, `sessions`                                     | GET    | Owner-only security metadata/session list                |
| `sessions/revoke`, `logout-others`, `logout-all`, `logout` | POST   | Owned session revocation/logout                          |
| `username`                                                 | POST   | Recent-authentication rename with UUID/history preserved |

## Verification and remaining scope

Database regressions exercise canonical registration races, password whitespace/hash parameters, session fixation/revocation, proof expiry/versioning, concurrent password changes, development UUID preservation, token/code digest storage, replacement/expiry/single-use races, private email changes, disabled/deleted users and neutral provider failure/timeouts. API tests exercise CSRF, malformed/oversized/MIME-invalid bodies, durable quota enforcement before password work and attacker-supplied forwarding headers. Browser cases exercise native registration/login, password change with a second device, recovery codes/account deletion, development conversion, mobile validation and action-required fixture links. Fixture-issued email tokens and delivery fixtures are not evidence of live provider delivery.

Passkeys/WebAuthn, physical authenticators, verified-email login and a durable email retry worker are not implemented. Password plus saved recovery codes is the implemented provider-independent authentication/recovery path. Production DNS/TLS, trusted-proxy deployment and live Resend sender/domain delivery still require environment-specific validation.
