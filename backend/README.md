# MyExpense Backend

Spring Boot 4.1.0 / Java 17 / Maven. This README covers the domains
implemented so far (`docs/roadmap/backend-build-order.md`):

- **Domain 1 — Auth**: the 8 endpoints under `/api/v1/auth` (§4 below).
- **Domain 2 — User & Settings**: the 5 endpoints under `/api/v1/users`
  (§11 below) — the first **authenticated** domain.
- **Domain 3 — Categories**: the 5 endpoints under `/api/v1/categories`
  (§12 below), plus the 8-default-category seed that now runs inside
  `POST /auth/register`'s transaction. **The count has moved 8 → 7 → 8** —
  `docs/decisions/0018-income-is-not-a-category.md` dropped `Income` on
  2026-10-21 and made category names case-insensitively unique (§12.8), then
  `docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md`
  added a protected `Misc` on 2026-10-25 (§12.10). **Those 3 endpoints carry
  one optional level of subcategories as of 2026-10-22** —
  `docs/decisions/0019-subcategories-one-optional-level.md`; see §12.9. **Two
  endpoints were added on 2026-10-25** — `DELETE /categories/{id}` and
  `GET /categories/{id}/usage` — along with **rename propagation into
  `transactions`**, which deliberately reverses one half of ADR 0018's
  snapshot reasoning; see §12.10.
- **Domain 4 — Transactions**: the 5 endpoints under `/api/v1/transactions`
  (§13 below) — the first **paginated** domain, the first with
  **optimistic concurrency** (`409 VERSION_CONFLICT`), and the first consumer of
  `service/IncomeCategorySnapshot`. §4's sixth endpoint,
  `POST /receipts/upload-signature`, is **deliberately not implemented** — see
  §13.9.
- **Statistics**: the 1 endpoint under `/api/v1/statistics` (§14 below) — the
  first **aggregating** read in this API, and the first that adds **no table,
  no column and no migration**. It reads `transactions` and `categories` only
  (`docs/decisions/0022-statistics-expenses-by-parent-category.md`). Not a
  numbered domain in the build order — it is a small follow-on to Domain 4.

- **Domain 6 — Contacts, Groups, Individual balances, Split expenses, Settle
  up**: the 7 endpoints of §15 below and the 6 of §16 below. The first
  **membership-gated** (rather than owner-scoped) domain, and the one that
  **writes** `activities` and `notifications` through the fan-out.
- **Domain 7 — Activity log & Notifications**: the 4 endpoints under
  `/api/v1/activities` and `/api/v1/notifications` (§17 below) — the **read**
  half of the two tables Domain 6 already writes, and **the last backend gap in
  the free tier**. `ActivityFanoutService` remains the only writer of either
  table; `notifications.read` is the only column §17 mutates.

**Domain 5 (budget) and Domain 8 (sync) are intentionally not implemented
yet.** *(This paragraph previously listed contacts, groups, splits, activities
and notifications as unimplemented; §15–§17 discharged all of them.)*

Contract source of truth: `docs/api/authentication-api.md`,
`docs/api/api-overview.md` §2–§4, §6–§12 and §14,
`docs/architecture/authentication.md`,
`docs/architecture/security-architecture.md`,
`docs/architecture/data-model.md` §1–§2.2.

---

## 1. Required environment variables

| Variable | Required? | Default (if any) | Notes |
|---|---|---|---|
| `DB_URL` | No | `jdbc:postgresql://localhost:5432/myexpense` | JDBC URL |
| `DB_USERNAME` | No | `myexpense` | |
| `DB_PASSWORD` | **Yes** | none | No committed default — constitution §13 |
| `JWT_SECRET` | **Yes** | none | HMAC signing key for access tokens. Must be a long, random string (32+ bytes / 256+ bits). **Never commit a real value.** |
| `CORS_ALLOWED_ORIGINS` | No | empty (CORS closed) | Comma-separated exact origins. Not needed for mobile/curl/Postman testing — only matters for a future browser-based client. |

Generate a JWT secret locally, e.g. (PowerShell):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

or, if you have OpenSSL available:

```bash
openssl rand -base64 32
```

---

## 2. Local PostgreSQL

Any local Postgres 13+ works. Quickest option, via Docker:

```powershell
docker run --name myexpense-postgres `
  -e POSTGRES_USER=myexpense `
  -e POSTGRES_PASSWORD=devpassword `
  -e POSTGRES_DB=myexpense `
  -p 5432:5432 -d postgres:16
```

Set `DB_PASSWORD=devpassword` (or whatever you chose) to match.

You do **not** need to run any migration by hand — Flyway applies
`database/migrations/*.sql` automatically on application startup
(`spring.flyway.locations=filesystem:../database/migrations` in
`application.properties`, since `backend/` and `database/` are sibling
folders). `spring.jpa.hibernate.ddl-auto=validate` — Hibernate never creates
or alters schema itself; if the entities and the migrated schema disagree,
startup fails fast with a validation error rather than silently patching the
database.

---

## 3. Running the app

```powershell
cd backend
$env:DB_PASSWORD = "devpassword"
$env:JWT_SECRET   = "<paste a generated secret here>"
./mvnw spring-boot:run
```

The app starts on `http://localhost:8080` by default (no `server.port`
override has been set).

**Verified:** `./mvnw compile` and `./mvnw test-compile` both pass cleanly
(checked 2026-08-19). Two issues found during that check were fixed
directly: a wrong import (`WebAuthenticationDetailsSource` is under
`org.springframework.security.web.authentication`, not
`...security.authentication`), and a missing `spring-boot-starter-json`
dependency — `spring-boot-starter-webmvc` in this Spring Boot 4.1.0 does
not transitively pull in Jackson the way the classic `-starter-web` did.
That surfaced a second, more interesting wrinkle worth knowing about:
this Spring Boot version's own JSON auto-configuration uses the new
**Jackson 3** (`tools.jackson.*`, groupId `tools.jackson.core`), not the
classic `com.fasterxml.jackson.databind` (2.x) — `jjwt-jackson` still
pulls in classic Jackson 2 for its own internal use, but that's a
separate, unrelated copy on the runtime classpath only. Any code in this
project that autowires Spring's `ObjectMapper` bean should import
`tools.jackson.databind.ObjectMapper`, not `com.fasterxml.jackson.databind.ObjectMapper` —
worth remembering for future domains.

**End-to-end verified against a live PostgreSQL 16 (2026-09-04).** The app
boots, Flyway applies `V1__auth_schema.sql`, and all 8 endpoints were
exercised with real requests, with the resulting rows checked directly in
the database. Five further issues were found and fixed during that run —
recorded here because three of them are traps future domains can repeat:

1. **Flyway never ran.** `flyway-core` alone is not enough on Spring Boot 4:
   each integration now lives in its own `spring-boot-<tech>` module, so
   without `org.springframework.boot:spring-boot-flyway` the library sits on
   the classpath, nothing triggers it at startup, and every `spring.flyway.*`
   property is silently ignored — the only symptom is Hibernate's
   `Schema validation: missing table [...]`. Added to `pom.xml`.
2. **`spring.jackson.serialization.write-dates-as-timestamps` is invalid**
   under Jackson 3 — that `SerializationFeature` no longer exists (dates are
   ISO-8601 by default now), and an unknown value there fails startup during
   property binding. Removed.
3. **Account lockout never triggered.** `login()` writes
   `failed_login_attempts` and then throws `InvalidCredentialsException`;
   since `ApiException extends RuntimeException`, Spring's default
   rollback-on-runtime-exception undid the write every time, pinning the
   counter at 0 forever. Fixed with `noRollbackFor` on the `@Transactional`.
4. **Refresh-token family revocation never persisted** — the same rollback
   trap. `rotate()` revoked the family and then threw
   `RefreshTokenReuseDetectedException`, so the revocation was rolled back:
   the API returned the correct error while the replayed token's siblings
   stayed fully usable, which defeats the entire point of reuse detection.
   Fixed on **both** the inner (`RefreshTokenService.rotate`) and outer
   (`AuthService.refresh`) `@Transactional` boundaries — the inner annotation
   alone is not enough, because the inner method joins the caller's
   transaction and it is the outer one that actually decides to roll back.
5. **`createdAt` was `null` in the register response** (contract requires it).
   The id is assigned rather than generated, so Spring Data merges instead of
   persisting, and the INSERT was deferred to commit — after the DTO was
   built. Fixed with `saveAndFlush` plus using the returned instance.

**General lesson for later domains (points 3 and 4):** any `@Transactional`
method that deliberately writes something and *then* throws needs
`noRollbackFor`, on every transactional boundary in the call chain. Security
side effects — lockout counters, revocations, audit rows — are exactly the
case where this bites, and it fails silently: the API returns the right
status code while the database quietly forgets.

**Config note, not a bug:** login's rate limit (5 per 15 min per account) and
the lockout threshold (5 failed attempts) are the same number, so in practice
a caller hits `429 RATE_LIMIT_EXCEEDED` at roughly the moment lockout engages
and will rarely see `401 ACCOUNT_LOCKED`. Both protections work correctly and
independently (each verified); if `ACCOUNT_LOCKED` should be the visible
response, the two thresholds need separating.

---

## 4. Manually testing the full flow (curl)

All bodies are JSON; all responses use the `ApiErrorResponse` shape on
error (`docs/api/authentication-api.md` "Common types").

### 4.1 Register

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "password": "Passw0rd1",
    "firstName": "Jane",
    "lastName": "Doe"
  }'
```

Expect `201` with a `UserResponse` (`emailVerified: false`,
`roles: ["USER"]`). Check the application log for a line prefixed
`[DEV EMAIL STUB]` — it contains the email-verification token (see §5
below on the email stub).

Verify in the database: a new row in `users` (with a bcrypt
`password_hash`, never the plaintext password), a matching `user_roles`
row (`role = 'USER'`), and a `verification_tokens` row
(`token_type = 'email_verification'`).

### 4.2 Login

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "password": "Passw0rd1"
  }'
```

Expect `200` with an `AuthResponse` including `accessToken`,
`refreshToken`, `expiresIn: 900`, and `user`. Save both tokens for the
next steps. Check `refresh_tokens` for a new row.

Try a wrong password 5 times in a row to see `401 ACCOUNT_LOCKED` kick in
(`users.failed_login_attempts`/`locked_until`) instead of
`401 INVALID_CREDENTIALS` on the 5th+ attempt.

### 4.3 Refresh

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<refreshToken from login>" }'
```

Expect `200` with a **new** `accessToken` and `refreshToken`, `user`
omitted. Verify in `refresh_tokens`: the original row now has
`revoked_at` set, and a new row exists with the same `family_id`.

Replay the **original** (now-rotated) refresh token again — expect
`401 REFRESH_TOKEN_REUSE_DETECTED`, and verify every row in that
`family_id` now has `revoked_at` set (the whole family was revoked, not
just the reused token).

### 4.4 Logout

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{ "refreshToken": "<a currently-active refreshToken>" }'
```

Expect `204` with no body. Calling it again with the same body is still
`204` (idempotent). Calling it with **no** `Authorization` header expects
`401 UNAUTHORIZED`.

### 4.5 Forgot password

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "jane@example.com" }'
```

Expect `200` with the same generic message regardless of whether the
email exists — try it once with `jane@example.com` and once with
`doesnotexist@example.com` and confirm the response body is identical
either way. For the real account, check the log for the
`[DEV EMAIL STUB]` password-reset token, and confirm a new
`verification_tokens` row (`token_type = 'password_reset'`).

### 4.6 Reset password

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<token from the DEV EMAIL STUB log line>",
    "newPassword": "NewPassw0rd1"
  }'
```

Expect `200`. Verify `users.password_hash` changed, and that **every**
row in `refresh_tokens` for that user now has `revoked_at` set (the
required side effect — a stale login session shouldn't survive a
password reset). Re-using the same reset token a second time should now
return `400 INVALID_OR_EXPIRED_TOKEN`.

### 4.7 Verify email

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{ "token": "<token from the DEV EMAIL STUB log line>" }'
```

Expect `200`, and `users.email_verified` now `true`. Re-using the token
returns `400 INVALID_OR_EXPIRED_TOKEN`.

### 4.8 Resend verification

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{ "email": "jane@example.com" }'
```

Expect `200` with the same generic message whether or not the account
exists/is already verified — a new `verification_tokens` row (and log
line) only actually appears when the account exists **and** is still
unverified.

---

## 5. Email delivery — deliberately stubbed

No email provider has been evaluated or approved for this project yet
(unlike SMS, which went through its own ADR — `docs/decisions/0015-sms-phone-invite.md`).
Rather than pick one unilaterally, `EmailService` is a small interface
(`service/EmailService.java`) with a single implementation right now,
`LoggingEmailService`, which logs the verification/reset link at `INFO`
level, clearly prefixed:

```
[DEV EMAIL STUB] Password reset requested for jane@example.com (Jane). To reset, call POST /api/v1/auth/reset-password with body {"token": "...", "newPassword": "..."}
```

Pull the token straight from the console/log to exercise the full
reset/verify flow manually. Swapping in a real provider later (SES,
SendGrid, etc.) only means writing a new `EmailService` implementation —
no caller changes.

---

## 6. Rate limiting

Two tiers, both built on the same in-memory token bucket
(`ratelimit/RateLimiter.java`). Hitting either returns `429` with
`error: "RATE_LIMIT_EXCEEDED"`; both reset on their own after the
configured window.

**Strict tier — `/api/v1/auth/**` (Domain 1).** Limited per-client-IP
(20 requests / 60 seconds by default, per endpoint path).
`register`, `login`, `forgot-password`, and `resend-verification` are
additionally limited per-account (by the submitted email) with tighter
windows — see `app.ratelimit.auth.*` in `application.properties`. If
you're scripting repeated test runs against the same account, you may
hit these.

**Default tier — every other `/api/v1/**` endpoint** (`ApiRateLimitFilter`,
added with Domain 2, `security-architecture.md` §11). Keyed by the
**authenticated user id**, not by IP or path: 120 requests / 60 seconds
shared across all of that user's endpoints
(`app.ratelimit.api.user.*`). Unauthenticated requests to a protected
path fall back to an IP-keyed bucket so an anonymous flood isn't free.

Domains 3+ inherit the default tier automatically — do **not** add a
second mechanism per domain. A domain needing something *stricter* (the
SMS invite endpoints, file uploads) layers that on inside its own
service, the way `AuthService` layers per-account limits over the per-IP
filter.

**Confirmed for Domain 4, not assumed (§13.7).** `ApiRateLimitFilter` keys off
the path prefix `/api/v1/` and excludes only `/api/v1/auth/`, so all five
`/api/v1/transactions` endpoints were covered the moment the controller existed;
nothing was added. The one endpoint in `api-overview.md` §4 that would need a
*stricter* tier — `POST /receipts/upload-signature`, which
`security-architecture.md` §11 requires to carry **two** independent limits (a
~10-per-10-minute burst limit and a ~50-per-24-hour cost cap) — is not
implemented this phase, and is not under this path prefix.

---

## 7. What was implemented — Domain 1 (Auth)

**Endpoints** (`controller/AuthController.java`), exactly matching
`docs/api/authentication-api.md`:

`POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`,
`/forgot-password`, `/reset-password`, `/verify-email`,
`/resend-verification`.

**Layers:**
- `entity/` — `User`, `UserRole` (+`UserRoleId`), `RefreshToken`,
  `VerificationToken` (+`VerificationTokenType`), mapped exactly to
  `docs/architecture/data-model.md` §1.1–§1.4 / `database/migrations/V1__auth_schema.sql`.
- `repository/` — one Spring Data JPA repository per entity; all custom
  queries are JPQL with bound parameters (no native/raw SQL).
- `dto/request`, `dto/response` — Java records; JPA entities never cross
  the API boundary. `dto/validation` — the shared `@PasswordComplexity`
  Bean Validation constraint.
- `service/` — `AuthService` (orchestration + business rules: lockout,
  anti-enumeration, rate limiting), `RefreshTokenService` (rotation/reuse
  detection/revocation), `VerificationTokenService` (issue/consume for
  both reset and verify flows), `EmailService`/`LoggingEmailService`.
- `security/` — `JwtTokenProvider`, `JwtAuthenticationFilter`,
  `RestAuthenticationEntryPoint`, `RestAccessDeniedHandler`, `TokenHasher`.
- `ratelimit/` — `RateLimiter` (hand-rolled in-memory token bucket),
  `AuthRateLimitFilter`, `AuthRateLimitProperties`.
- `config/` — `SecurityConfig` (the single `SecurityFilterChain`),
  `AccountLockoutProperties`, `VerificationTokenProperties`.
- `exception/` — `ApiException` + 7 subclasses, `GlobalExceptionHandler`
  (`@RestControllerAdvice`).
- `web/ApiErrorResponseWriter` — shared JSON writer for the rejection
  paths that happen outside normal controller dispatch (security
  entry point/access-denied handler, the rate-limit filter).

---

## 8. Key assumptions — Domain 1 (flagged for the System Architect / Database Architect)

- **Email is lowercased before storage/lookup.** Not stated explicitly in
  the schema or API docs; done to avoid two accounts differing only by
  case. Low risk, but flagging since it's a real behavioral decision.
- **Refresh/verification token hashing uses SHA-256, not BCrypt**, despite
  `data-model.md` describing `token_hash` with "same non-reversible-hash
  rule as passwords." BCrypt can't support the required
  `WHERE token_hash = ?` point lookup (it's salted per-call, not
  deterministic); SHA-256 is the standard choice for high-entropy opaque
  tokens specifically because they don't need the slow/salted defense a
  low-entropy password does. Documented in `security/TokenHasher.java`.
- **Refresh token TTL: 30 days. Password-reset token TTL: 60 minutes.
  Email-verification token TTL: 24 hours.** None of these are pinned by
  the approved docs (only the 15-minute access token TTL is); picked as
  reasonable, tunable defaults (`application.properties`).
- **Account lockout: 5 attempts / flat 15-minute lockout, no backoff
  escalation** — exactly `security-architecture.md` §5's own suggested
  Phase 1 starting point.
- ~~**Category seeding at registration is deliberately NOT implemented.**~~
  **Resolved with Domain 3 (2026-10-10).** The hook is now live in
  `AuthService.register()` — `categoryService.seedDefaultsFor(...)`, inside
  the registration transaction, for every new account with no exemption for
  test accounts. See §12.5. **Accounts registered during Domains 1–2 were
  not backfilled** and therefore have zero categories; register a fresh
  account to exercise anything category-related.
- **`429 RATE_LIMIT_EXCEEDED`** is a new status/error code not present in
  `authentication-api.md`'s per-endpoint error tables (that document
  predates the 2026-08-17 API-wide rate-limiting requirement). Uses the
  same `ApiErrorResponse` shape; flagging since it's technically outside
  the currently-documented set.
- **CORS** is closed by default (no origins configured) — nothing in
  this phase needs it (native mobile HTTP clients aren't subject to
  CORS); `CORS_ALLOWED_ORIGINS` is there for when a web dashboard exists.
- **No `spring-boot-starter-actuator`** was added — not requested, and
  not needed to satisfy the 8 endpoints. `SecurityConfig` has a comment
  marking where a health-endpoint matcher would go if/when it's added.

## 9. Dependencies added (constitution §21)

| Dependency | Why |
|---|---|
| `spring-boot-starter-security` | Required for the whole auth domain — password hashing (`PasswordEncoder`), the filter chain, method security. No alternative in this stack. |
| `flyway-core`, `flyway-database-postgresql` | Explicitly directed by the task — applies the Database Architect's migrations from `../database/migrations`. Both are Spring-Boot-parent-managed (no version pinned here). |
| `io.jsonwebtoken:jjwt-api` / `jjwt-impl` / `jjwt-jackson` (0.12.6) | JWT access token issuance/validation (`docs/architecture/authentication.md` §1). Actively maintained, widely used, MIT-licensed, small surface area; `jjwt-jackson` reuses the Jackson already on the classpath rather than pulling in Gson. `impl`/`jackson` are runtime-scoped since application code only depends on the `jjwt-api` interfaces. |
| `spring-security-test` (test scope) | Standard companion for testing Spring-Security-protected endpoints later; no auth tests were written this round (see §10) but the dependency is harmless to have in place. |

**Rate limiting deliberately does *not* add a new dependency.** Evaluated
against `security-architecture.md` §11's own framing: Bucket4j is a
reasonable named option, but a hand-rolled in-memory token bucket
(`ratelimit/RateLimiter.java`, ~70 lines, zero dependencies beyond the
JDK) is explicitly called out there as acceptable for Phase 1's
single-instance deployment. Flagged as a real limitation: it does not
coordinate across multiple backend instances — revisit (e.g. Bucket4j +
Redis) if this backend is ever horizontally scaled.

---

## 10. Not done / follow-ups — Domain 1

- **No compile/test run.** This session had no shell access. The
  coordinating session (or the Project Owner) needs to run `./mvnw
  compile` (and ideally `./mvnw test`, though `BackendApplicationTests`'
  `contextLoads()` now requires a reachable Postgres + `JWT_SECRET`/
  `DB_PASSWORD` to pass, since it boots the full context) before this is
  considered verified. Flag back immediately if anything fails to
  compile — in particular, please double-check the `jjwt` 0.12.6
  coordinates resolve; that version was chosen from memory, not
  confirmed against Maven Central in this session.
- No automated tests were written this round (unit or integration) —
  out of scope for this pass per the task's focus on getting the domain
  correct and manually verifiable first; flag back if test coverage is
  wanted before moving to the next domain.
- ~~Category seeding at registration (see §8)~~ — **done with Domain 3**
  (§12.5).
- Multi-instance-safe rate limiting (see §9) if/when this backend scales
  beyond one instance.

---

## 11. Domain 2 — User & Settings

Five endpoints under `/api/v1/users`, implemented exactly to
`docs/api/api-overview.md` §2.1–§2.5. Backed by `users` (from
`V1__auth_schema.sql`) and `user_settings` (from `V2__user_settings.sql`,
`data-model.md` §1.5).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/users/me` | The caller's own profile |
| PATCH | `/api/v1/users/me` | Partial profile update (name, phone, currency — **no premium gate**) |
| GET | `/api/v1/users/me/settings` | Behavioural settings |
| PATCH | `/api/v1/users/me/settings` | Partial settings update (upsert) |
| PATCH | `/api/v1/users/me/premium` | Toggle premium (boolean stub, no billing) |

**All five require `Authorization: Bearer <accessToken>`** — this is the
first authenticated domain. `/api/v1/auth/**` stays public exactly as
before (logout excepted, unchanged).

### 11.1 The one rule every later domain must copy

The caller's identity comes **only** from the JWT principal in the
`SecurityContext`, never from a path variable, query parameter or request
body (`security-architecture.md` §2). Concretely:

```java
@GetMapping("/me")
public ResponseEntity<UserProfileResponse> getCurrentUser(@CurrentUserId UUID userId) { ... }
```

`@CurrentUserId` (`security/CurrentUserId.java`) is a meta-annotation over
Spring Security's `@AuthenticationPrincipal`, resolving the `UUID` that
`JwtAuthenticationFilter` put in the context. There is deliberately **no
`/users/{id}` endpoint** — only `/users/me` — so there is nothing for a
client to tamper with. Services receive that `UUID` as an ordinary
parameter and scope every read and write to it; they never read
`SecurityContextHolder` themselves, which keeps authorization visible in
each method signature.

**If every one of these endpoints returns `401` with a token that works
for `POST /auth/logout`**, the meta-annotation is the first thing to
check: swap `@CurrentUserId` for `@AuthenticationPrincipal` in
`UserController` to confirm. The services treat a null principal as
`401 UNAUTHORIZED` rather than throwing, so that failure mode is loud but
safe.

### 11.2 Get an access token first

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "jane@example.com", "password": "Passw0rd1" }'
```

Copy `accessToken` from the response; every call below uses it as
`$TOKEN`. It expires after 15 minutes — re-login or use
`POST /auth/refresh` when it does. **These endpoints are the first real
exercise of the frontend's `authorizedRequest`/refresh-on-401 path**, so
deliberately letting a token expire and watching the app recover is worth
doing once.

### 11.3 Get current user (§2.1)

```bash
curl -i http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` with `id`, `email`, `phone` (`null` until set), `firstName`,
`lastName`, `emailVerified`, `isPremium`, `defaultCurrencyCode` (`INR` by
default), `createdAt`. No `passwordHash`, no `roles` — this shape is
`UserProfileResponse`, not `UserResponse`.

Verify in the database: the values match
`SELECT id, email, phone, first_name, last_name, email_verified, is_premium,
default_currency_code, created_at FROM users WHERE email = 'jane@example.com';`
— and that **nothing was written**: `updated_at` is unchanged.

Without the header, expect `401 UNAUTHORIZED` (same `ApiErrorResponse`
shape as everywhere else). With a garbage token, also `401`.

### 11.4 Update current user (§2.2)

```bash
curl -i -X PATCH http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "firstName": "Janet", "phone": "+919876543210" }'
```

Expect `200` with the updated `UserProfileResponse`. Verify in the
database that `users.first_name` changed, `users.phone` is now
`+919876543210`, `users.last_name` is **unchanged** (omitted fields are
untouched), and `users.updated_at` advanced.

Four behaviours worth testing explicitly, because each is easy to get
wrong:

1. **Clearing the phone number** — `"phone": null` is a real instruction,
   not an omission:
   ```bash
   curl -i -X PATCH http://localhost:8080/api/v1/users/me \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{ "phone": null }'
   ```
   Expect `200` and `users.phone` back to `NULL`. Then send `{}` — expect
   `200` with **no** column changed. (An omitted `phone` and an explicit
   `"phone": null` must not behave the same way; see §11.7.)
2. **Phone uniqueness** — register a second account, set the same number
   on it: expect `409 PHONE_ALREADY_EXISTS` and no change to either row.
   Re-sending the caller's *own* current number is not a conflict and
   returns `200`.
3. **Changing the currency — free for every tier** (changed 2026-10-02,
   `docs/decisions/0017-per-currency-balances-and-partial-settlement.md`
   §1; the `403 PREMIUM_REQUIRED` this step used to expect **no longer
   exists**, and `PATCH /users/me` has no `403` response at all):
   ```bash
   curl -i -X PATCH http://localhost:8080/api/v1/users/me \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{ "defaultCurrencyCode": "USD" }'
   ```
   Expect `200` on a **free** account, with `users.default_currency_code`
   now `USD`. Sending `{"defaultCurrencyCode": "INR"}` (the value already
   stored) is *not* a change and returns `200` without writing. The code
   is a **display-symbol preference only** — verify the point that matters
   most here: **no stored amount changes.** Nothing is converted,
   re-denominated or recalculated anywhere; once Domains 4+ exist, check
   that a `1000.00` row still reads `1000.00` after the switch.
4. **Validation** — `{"phone": "9876543210"}` (no `+`, not E.164),
   `{"firstName": "   "}`, `{"defaultCurrencyCode": "ZZZ"}` (not a real
   ISO 4217 code) each expect `400 VALIDATION_ERROR` with `fieldErrors`
   naming the offending field.

`email` is not updatable by this or any endpoint in this phase; sending
it is ignored.

### 11.5 Settings (§2.3 / §2.4)

```bash
curl -i http://localhost:8080/api/v1/users/me/settings \
  -H "Authorization: Bearer $TOKEN"
```

For a brand-new account, expect `200` with
`{"overspendingAlertsEnabled": true, "paymentModeEnabled": false,
"subcategoriesEnabled": false}` — the documented defaults. **All three keys
are always present**, which is why a client writes the response body rather
than the value it asked for.

**`subcategoriesEnabled` added 2026-10-22** (`api-overview.md` §2.3, ADR 0019
§6) — default `false`, the same opt-in framing `paymentModeEnabled` uses.
It is a **UI affordance and gates nothing server-side**: `POST /categories`
accepts a `parentCategoryId` whether it is `true` or `false`, and
`GET /categories` always returns the complete tree. Nothing in the backend
reads it outside this one endpoint pair — `CategoryService` must never consult
it (§12.9).

**The key database check for this endpoint is that nothing was written:**

```sql
SELECT count(*) FROM user_settings WHERE user_id = '<the id from /users/me>';
```

must still be `0` after any number of GETs. "No row" is a valid state;
the read is side-effect-free by design and existing users are not
backfilled.

```bash
curl -i -X PATCH http://localhost:8080/api/v1/users/me/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "paymentModeEnabled": true }'
```

Expect `200` with `{"overspendingAlertsEnabled": true,
"paymentModeEnabled": true, "subcategoriesEnabled": false}`.
Now exactly one `user_settings` row exists for that user, with
`payment_mode_enabled = true`, `overspending_alerts_enabled = true` and
`subcategories_enabled = false` — the two fields that weren't sent took the
documented defaults on insert. `created_at` and `updated_at` are both set.

PATCH again with `{"overspendingAlertsEnabled": false}`: still exactly
one row, `payment_mode_enabled` **stays** `true` (partial update),
`overspending_alerts_enabled` is now `false`, and `updated_at` has
advanced while `created_at` has not — the schema has no `updated_at`
trigger, so that timestamp is maintained by the application
(`@UpdateTimestamp`), and a stale one would quietly undermine
last-write-wins sync later.

PATCH `{"subcategoriesEnabled": true}`: still exactly one row, the other two
columns untouched. **The check that matters most for this field is that
nothing else changed** — ADR 0019 §6.2 requires that turning it off (or on)
writes one boolean and touches no other row, so re-run
`SELECT count(*) FROM categories WHERE user_id = '<id>';` before and after a
`{"subcategoriesEnabled": false}` write and confirm the count and every
`parent_category_id` are identical. Subcategories are **hidden by the client,
never destroyed**.

A non-boolean value (`{"paymentModeEnabled": "yes"}`) expects
`400 VALIDATION_ERROR`.

### 11.6 Toggle premium (§2.5)

```bash
curl -i -X PATCH http://localhost:8080/api/v1/users/me/premium \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "isPremium": true }'
```

Expect `200` with the full updated `UserProfileResponse` (`isPremium:
true`), and `users.is_premium = true` in the database. An empty body or
`{}` expects `400 VALIDATION_ERROR` — the field is required, and a
missing value must never be read as "switch premium off".

**This flag no longer gates anything.** It used to gate §11.4's currency
change; that gate was removed on 2026-10-02 and `is_premium` currently has
no behavioural consumer in the implemented endpoints at all — it is a
stored boolean stub awaiting the premium features that will read it
(Transaction Detail's payment-method enrichment, display-only FX
conversion). Worth confirming once either way: with premium **off**,
§11.4's `USD` change still returns `200`.

### 11.7 Implementation notes

- **Partial update vs. explicit null.** `UpdateUserRequest` is the one
  request DTO in this project that is a class rather than a record: a
  record component cannot distinguish "field omitted" from
  `"phone": null`, and for `phone` those mean different things (leave
  alone vs. clear). Its setters record that they were called, and Jackson
  calls a setter only for a property physically present in the JSON, so
  `hasPhone()` means exactly "the client sent a `phone` key". The presence
  flags are exposed as `hasXxx()`, which is not a JavaBean accessor
  prefix, so a client cannot try to set them. The DTO's Javadoc records
  the alternatives that were rejected (`Optional<T>` components — Jackson
  maps both absent and explicit-null to `Optional.empty()`; a custom
  deserializer — too much machinery for one field). Fields backed by
  `NOT NULL` columns (`firstName`, `lastName`, `defaultCurrencyCode`)
  treat an explicit null exactly like omission, since there is no "clear"
  intent to express for them. **Categories' `monthlyCap` and
  Transactions' nullable fields will need this same treatment — copy this
  DTO's approach rather than inventing a second one.**
- **Settings upsert race.** Two concurrent first-time PATCHes both see
  "no row" and both try to insert; one loses on `pk_user_settings`.
  `UserSettingsWriter` performs one attempt in its own
  `REQUIRES_NEW` transaction and `UserSettingsService` retries it once on
  `DataIntegrityViolationException` — the row it wanted now exists, so
  the retry applies the same patch as an update. It is a separate bean on
  purpose: a self-invoked private method gets no transaction at all
  (proxy semantics), and catching a constraint violation inside the
  transaction that caused it is useless because that transaction is
  already rollback-only.
- **The rollback trap (§3, points 3 and 4) does not apply here — checked,
  not assumed.** No method in this domain writes and then throws:
  `PHONE_ALREADY_EXISTS` and `UNAUTHORIZED` are both decided *before* any
  field is mutated (`UserService.updateCurrentUser`
  is written in two explicit phases for exactly this reason), and a
  rollback is the desired behaviour if one is thrown. So no
  `noRollbackFor` anywhere in this domain. Re-check this if a future
  change adds an audit row or a counter that must survive a rejection.
- **No premium gate, as of 2026-10-02.** `defaultCurrencyCode` is writable
  by any authenticated user; the `403 PREMIUM_REQUIRED` path is gone from
  `UserService` and `exception/PremiumRequiredException` is now unused
  (flagged for deletion in its own Javadoc). ISO 4217 validation is
  unchanged — an invalid code is still `400 VALIDATION_ERROR`.
- **Injection hardening.** Every query is a Spring Data derived method or
  `findById` with bound parameters — no native SQL, no dynamic query
  construction, nothing built from client input
  (`security-architecture.md` §12). Every request DTO carries Bean
  Validation constraints.
- **Rate limiting.** The default per-user tier, applied by
  `ApiRateLimitFilter` — see §6.

### 11.8 Key assumptions — Domain 2

- **`defaultCurrencyCode` is validated against the JDK's own ISO 4217
  registry** (`java.util.Currency`), not just a 3-letter regex, so
  `"ZZZ"` is rejected. Accepted case-insensitively and stored uppercase.
  The contract says "ISO 4217 3-letter code"; treating that as a real
  constraint rather than a shape check is an interpretation — flagging it.
- ~~**Which error wins when a single PATCH violates two rules.**~~
  **Obsolete as of 2026-10-02** — there is no longer a second rule to
  order against on this endpoint. A free user sending a new
  `defaultCurrencyCode` **plus** an already-claimed `phone` now gets
  `409 PHONE_ALREADY_EXISTS`, because the premium gate that used to
  short-circuit first is gone (`api-overview.md` §2.2's superseded note
  records this exact side effect). Nothing else in the request is applied
  when it is thrown — the rejection still happens before any mutation.
- **E.164 is enforced as `^\+[1-9]\d{6,14}$`** (7–15 digits after the
  `+`). The contract gives a format name and one example, not a regex.
- **Explicit `null` for a `NOT NULL`-backed field is treated as
  omission**, not as a `400`. Lenient on purpose: a client clearing
  `phone` by sending the whole form back with nulls elsewhere shouldn't
  be rejected.
- **A valid token whose `user_id` no longer exists returns `401
  UNAUTHORIZED`** (not `404`, not `500`) — the missing resource *is* the
  principal.
- **Unknown request fields are ignored** rather than rejected (Jackson's
  default here), which is what makes "`email` is not updatable" safe:
  it is never read, so it can never be applied.

### 11.9 Not done / follow-ups — Domain 2

- **No compile or run in the session that wrote this.** Needs
  `./mvnw compile` plus a real boot against PostgreSQL with
  `V2__user_settings.sql` applied — `ddl-auto=validate` means a mismatch
  between `UserSettings` and the migrated table fails startup loudly,
  which is the fastest confirmation that the entity mapping is right.
- **No automated tests**, consistent with Domain 1.
- **`docs/api/api-overview.md` §2's Status cells still say "Not started"**
  and `docs/roadmap/backend-build-order.md`'s Domain 2 row still says
  "Next — ready to start". Both files are System-Architect-owned, so they
  were deliberately not edited here; they need updating once the Project
  Owner's testing pass (workflow step 2) confirms this domain.
- **The settings-upsert retry is untested under real concurrency** — it
  needs two simultaneous first-time PATCHes for the same brand-new user
  to actually exercise the race.
- **Latent trap for whoever first adds `@PreAuthorize`** (most likely
  Domain 6, where membership checks need method security). Today
  `GlobalExceptionHandler` has an `@ExceptionHandler(Exception.class)`
  and no handler for Spring Security's `AccessDeniedException`. An
  exception thrown by method security *inside* the dispatcher would be
  caught by that catch-all and answered `500 INTERNAL_ERROR` instead of
  reaching Spring Security's translation to 403 — the filter-chain
  `RestAccessDeniedHandler` only covers denials made in the chain itself.
  Not fixed here because this domain uses no method security, and because
  the right mapping is domain-dependent: `security-architecture.md` §2
  requires ownership/membership failures to be `404` with the resource's
  own code, not a generic `403`. Decide that mapping deliberately when
  method security is introduced. This domain instead uses §2's sanctioned
  alternative — an explicit service-layer check (`requireUser`) called on
  every entry point, with every query keyed by the authenticated id.

---

## 12. Domain 3 — Categories

Five endpoints under `/api/v1/categories`, implemented exactly to
`docs/api/api-overview.md` §3.1–§3.5. Backed by the `categories` table from
`V3__categories.sql`, as amended by
`V4__categories_case_insensitive_name.sql`,
`V6__categories_subcategories.sql` and
`V8__categories_misc_fallback.sql` (`data-model.md` §2.1).

**Read §12.8, §12.9 and §12.10 first if you are re-verifying this domain** —
ADR 0018 changed the seed count (8 → 7) and made name uniqueness
case-insensitive on 2026-10-21, ADR 0019 added one optional level of
**subcategories** on 2026-10-22, and ADR 0021 added **`DELETE`, the usage
pre-flight, a protected 8th `Misc` category and rename propagation** on
2026-10-25 — all after the original verification pass. Everything below
reflects the current behaviour.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/categories` | List the caller's categories, as a two-level tree |
| POST | `/api/v1/categories` | Create one — a category **or a subcategory** (`201`, always `isDefault: false`) |
| PATCH | `/api/v1/categories/{id}` | Partial update of name/icon/glyph/cap, on either level — **a name/icon/glyph change now PROPAGATES to that category's transactions** (§12.10) |
| DELETE | `/api/v1/categories/{id}` | *(new 2026-10-25)* Hard delete, cascading to subcategories, reassigning every affected transaction to the protected `Misc` category (`200` **with a body**, not `204`) |
| GET | `/api/v1/categories/{id}/usage` | *(new 2026-10-25)* Side-effect-free delete pre-flight: how many transactions and subcategories a delete would affect |

**All five require `Authorization: Bearer <accessToken>`** and follow
Domain 2's rules unchanged: the caller comes from `@CurrentUserId` only
(§11.1), every query is filtered by that id, and the default per-user rate
limit tier applies automatically (§6 — **no second mechanism was added for
this domain, including for the two new endpoints**).

~~**There is no `DELETE` endpoint this phase**~~ — **superseded 2026-10-25**
(`docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md`
§2). `DELETE /api/v1/categories/{id}` exists and is a **hard** delete:
`categories` still has no soft-delete column and is not gaining one (§12.10).
**Reparenting still does not exist**, so the tree is deliberately
half-editable this round.

Get a token first exactly as in §11.2; every call below uses it as `$TOKEN`.
**Register a brand-new account for this domain** — accounts created during
Domains 1–2 have no categories and were deliberately not backfilled
(§12.5).

### 12.1 List categories (§3.1)

```bash
curl -i http://localhost:8080/api/v1/categories \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` with a **plain JSON array** (not a `PageResponse` — the
contract specifies `CategoryResponse[]`, and the set is small and bounded).
For a freshly registered account that array has **exactly 8 entries**
(**7 until 2026-10-25** — ADR 0021 added `Misc`, §12.10), each
with `monthlyCap: null`, `isDefault: true`, `parentCategoryId: null` and
`subcategories: []`. Exactly **one** of them — `Misc` — carries
`isProtected: true`; the other seven are `false`.

Each entry is `{ id, name, iconName, glyph, monthlyCap, isDefault,
isProtected, parentCategoryId, subcategories, createdAt, updatedAt }` — no
`userId` (it would only invite a client to start sending one back) and no
`currencyCode` (`monthlyCap` is a plain amount in the one unit of account).

**The array is a two-level tree as of 2026-10-22** (ADR 0019 §7): it holds
**top-level categories only**, and a subcategory appears solely inside its
parent's `subcategories` array. `parentCategoryId` and `subcategories` are
always present rather than omitted, so `subcategories` is `[]` and never
`null`. Purely additive — for an account with no subcategories this response
is byte-identical to the pre-2026-10-22 one. See §12.9.

Verify in the database:

```sql
SELECT count(*) FROM categories WHERE user_id = '<the id from /users/me>';
-- 8 for a newly registered account (7 before 2026-10-25)

SELECT name, icon_name, glyph, monthly_cap, is_default, is_protected
FROM categories WHERE user_id = '<id>' ORDER BY name;
```

The 8 rows must be exactly: `Entertainment`/`film-outline`/`E`,
`Fitness / Leisure`/`barbell-outline`/`W`, `Food`/`cafe-outline`/`F`,
`Groceries`/`cart-outline`/`G`, `Home / Rent`/`home-outline`/`H`,
`Misc`/`ellipsis-horizontal-outline`/`M`,
`Shopping`/`bag-outline`/`S`, `Transport`/`car-outline`/`T` — all with
`monthly_cap` `NULL` and `is_default` `true`, and **`is_protected` `true` on
`Misc` and `false` on the other seven**. (`Fitness / Leisure`'s glyph
really is `W`, not `F` — that is the frontend's own value.)

**In the catalog's own order `Misc` is LAST, after `Fitness / Leisure`** — the
query above sorts by name, which is why it appears sixth there. The catalog's
order is the frontend's display order, so do not "fix" it to alphabetical.

```sql
-- The invariant V8 exists to establish: exactly one protected row per user.
SELECT count(*) FROM categories WHERE user_id = '<id>' AND is_protected;
-- 1, for every account, always
```

**There is no `Income` row, and that is the point** (ADR 0018 §1/§2): income
is not a category, `transactions.type` is the discriminator, and an income
transaction carries `category_id = NULL` with its four display values
supplied from `service/IncomeCategorySnapshot`. Do not re-add it, and do not
add a semantic `is_income`/`kind`/`slug` field to compensate — ADR 0018 §4
rejects exactly that.

**`Misc` is the 8th, and it is NOT `Income` coming back** (ADR 0021 §2.1). The
count has moved 8 → 7 → 8 with different membership each time: `Income` was
removed because it was nonsense *as a category* (a user could tag an expense
"Income" or put a spending cap on it), while `Misc` is an ordinary expense
bucket a user can legitimately spend into — and it exists because `DELETE`
needs a reassignment target that is **guaranteed** to exist. See §12.10.

These mirror the frontend's `useCategoriesStore` initial list, which is the
point: after the frontend swap, a new user must see the same list they see
today. **One known, temporary divergence, and note the trap in it:** that
store still carries a `cat-income` entry and no `Misc` entry, so since
2026-10-25 the two lists happen to be the same *length* (8) while still
disagreeing on *membership* — a count check alone no longer catches it.
Both halves are the Frontend Engineer's (ADR 0018's follow-up item 2 and
ADR 0021's frontend follow-up); the server is authoritative.

**An account registered between Domain 3 and 2026-10-21 returns rows including
a stray `Income`.** That is not a regression: nothing retroactively edits
existing rows. **Since 2026-10-25 you *can* remove it through the API** —
`DELETE /api/v1/categories/{id}` (§12.10), which also reassigns anything tagged
to it — or register a fresh account, or delete that one row directly in the dev
database (ADR 0018's "Existing data" section). Note what `V8` *did* do for such
accounts, which is a different thing: it backfilled a protected `Misc` row for
every user that had none, so an old account now holds its stray `Income`
**and** a `Misc`.

### 12.2 Create a category (§3.2)

```bash
curl -i -X POST http://localhost:8080/api/v1/categories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pets",
    "iconName": "paw-outline",
    "glyph": "P",
    "monthlyCap": 1500.00
  }'
```

Expect `201` with the created `CategoryResponse`, and critically
`isDefault: false` **and `isProtected: false`** — a client can never create a
default or a protected category, and an `isDefault`/`isProtected` key in the
body is ignored rather than applied (there is no such property on
`CreateCategoryRequest`). Verify
`categories` has a 9th row for that user with `is_default = false` and
`is_protected = false` (8 seeded + this one), `monthly_cap = 1500.00`, and
`created_at`/`updated_at` both set (the response must not contain `null`
timestamps — that was a real Domain 1 bug, §3 point 5).

`monthlyCap` is optional: omit it (or send `null`) and the row stores
`NULL`, meaning "no cap".

Four things worth testing explicitly:

1. **Duplicate name** — re-run the same request: expect
   `409 CATEGORY_NAME_ALREADY_EXISTS`, and **no 10th row**. Scoped per
   user: a different account may have its own `Pets`. One new case since
   2026-10-25: `{"name": "misc"}` is now also a `409`, because the seeded
   `Misc` is a top-level sibling and the index folds case. That is a
   correct, already-mapped `409` and needed no new code.
2. **Case and whitespace** — `"name": "pets"` now **conflicts** (`409`),
   because `uq_categories_user_id_lower_name` folds case (ADR 0018 §6;
   changed 2026-10-21 — this used to return `201`). `"name": "Pets  "` is
   trimmed before the check, so it conflicts too. Trimming is unchanged:
   the rule is case-insensitive, **not** whitespace-insensitive.
3. **Validation** — each of these expects `400 VALIDATION_ERROR` with
   `fieldErrors` naming the field: `{"name": "   "}` (blank),
   a `name` over 100 chars, a missing `iconName`, `"glyph": "ABC"`
   (max 2 chars), `"monthlyCap": 0` and `"monthlyCap": -5` (must be
   `> 0`), `"monthlyCap": 10.005` (more than two decimal places — the
   sub-paise guard, `security-architecture.md` §3).
4. **No auth** — drop the `Authorization` header: `401 UNAUTHORIZED`.

### 12.3 Update a category (§3.3)

```bash
curl -i -X PATCH http://localhost:8080/api/v1/categories/<categoryId> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Pets & Vet", "monthlyCap": 2000.00 }'
```

Expect `200` with the updated row; `icon_name`/`glyph` **unchanged**
(omitted fields are untouched) and `updated_at` advanced while `created_at`
did not.

**The one behaviour to test carefully — `monthlyCap`'s three states:**

```bash
# (a) clear the cap — an explicit null is a real instruction
curl -i -X PATCH http://localhost:8080/api/v1/categories/<categoryId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "monthlyCap": null }'

# (b) leave the cap alone — the key is simply absent
curl -i -X PATCH http://localhost:8080/api/v1/categories/<categoryId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "iconName": "paw" }'
```

(a) must set `monthly_cap` to `NULL`; (b) must leave whatever was there
untouched. **These two must not behave the same way** — that distinction is
the whole reason `UpdateCategoryRequest` is a class rather than a record
(§12.4). Sending `{}` is a valid no-op `200` that changes nothing.

Also worth testing:

- **A seeded default is editable** — rename `Food`, or give it a cap:
  expect `200`. `is_default` stays `true` and is never settable through the
  API; it is informational, not a lock. (Budget Settings' category caps are
  applied to exactly these rows, so they must be editable.) **The one
  exception since 2026-10-25 is per-field, not per-row:** a `name` change on
  the protected `Misc` row is `400 CATEGORY_PROTECTED`, while `iconName`,
  `glyph` and `monthlyCap` are accepted on it like on any other row (§12.10).
- **A rename now PROPAGATES to that category's transactions** (§12.10), and
  so do an icon and a glyph change. This is new on 2026-10-25 and it
  **inverts** the old Domain 4 assertion that a transaction keeps its old
  category name (§13.1).
- **Renaming onto an existing name** → `409 CATEGORY_NAME_ALREADY_EXISTS`,
  including in a different case (`"name": "food"` when `Food` exists —
  ADR 0018 §6). Re-sending a category's **own** current name is not a
  conflict (`200`), and neither is **re-casing its own name** (`Food` →
  `food` on that same id, `200`, and the stored name really does become
  `food`): both the pre-check and the index exclude the row being updated,
  so a self-recase is a change, not a conflict.
- **Someone else's category** — register a second account, then PATCH the
  first account's category id with the second account's token: expect
  `404 CATEGORY_NOT_FOUND`, **never a `403`**, and identical to the
  response for a random non-existent UUID. A 403 would confirm the id is
  real (`security-architecture.md` §2).
- **A malformed id** — `PATCH /api/v1/categories/not-a-uuid` expects
  `400 VALIDATION_ERROR` (see §12.6; this is the first domain with a typed
  path variable, and it used to be a `500`).

### 12.4 Implementation notes

- **`monthlyCap`'s absent-vs-explicitly-null distinction reuses Domain 2's
  mechanism, it does not invent a second one.**
  `UpdateCategoryRequest` is a class with `hasXxx()` presence flags, copied
  from `UpdateUserRequest` (§11.7) exactly as that DTO's Javadoc instructs:
  Jackson calls a setter only for a property physically present in the JSON,
  so `hasMonthlyCap()` means "the client sent a `monthlyCap` key",
  independent of its value. `null` clears the cap; omitted leaves it alone.
  `name`/`iconName`/`glyph` back `NOT NULL` columns, so for them an explicit
  `null` is treated exactly like omission — same lenient rule as Domain 2.
  `CreateCategoryRequest` stays a record: on a create there is no third
  state to express.
- **`name` is trimmed before the uniqueness check and before storage.**
  The unique indexes fold case but not whitespace, so
  without trimming `Food` and `Food ` would both be storable as distinct
  categories that look identical to a user. ADR 0018 §6 and ADR 0019 §3 both
  left trimming exactly as it was.
- **Name uniqueness is case-insensitive** (ADR 0018 §6, 2026-10-21) **and
  scoped to a row's siblings** (ADR 0019 §3, 2026-10-22).
  `CategoryRepository`'s four pre-checks are
  `existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCase[AndIdNot]` and
  `existsByUserIdAndParentCategoryIdAndNameIgnoreCase[AndIdNot]` — derived
  queries, with the value bound, not hand-written SQL. `Food` and `food` can
  no longer coexist for one user at either level, while `Food › Snacks` and
  `Transport › Snacks` may both exist; the error code
  `CATEGORY_NAME_ALREADY_EXISTS` is unchanged through both decisions, so no
  client is affected.
  **One correction to the Database Architect's handoff note, flagged not
  absorbed:** that note expected `IgnoreCase` to render as
  `lower(name) = lower(?)`, byte-identical to the index expression. Spring
  Data JPA's own keyword table documents it as `UPPER(x.name) = UPPER(?1)`.
  Behaviour is unaffected — the pre-check is case-insensitive either way, the
  index is still the guarantee, and the planner can still use the index's
  `user_id` leading column on a table holding single digits of rows per user.
  The only real consequence is that an exotic Unicode pair whose `upper` and
  `lower` foldings disagree could be judged differently by the check and by
  the index; that is the same caveat ADR 0018 §6 already records for the
  client/server pair, and it resolves the same way — the index wins, and the
  violation it raises is still a clean `409`. See
  `CategoryRepository#existsByUserIdAndNameIgnoreCase`'s Javadoc.
- **The 409 is identified by constraint *name*, never by message text — and
  there are now TWO names.** The sibling-scoped `existsBy...` pre-check is the
  friendly path; the unique indexes are the real guard (two concurrent creates
  can both pass the pre-check) — **both halves are kept deliberately**, per
  ADR 0018 §6, carried over verbatim by ADR 0019 §3.
  `CategoryService.persist` catches `DataIntegrityViolationException`, walks
  the cause chain for Hibernate's `ConstraintViolationException`, and maps
  **either** of the two names in `CategoryService.UNIQUE_NAME_CONSTRAINTS`
  onto `409`: `uq_categories_user_lower_name_top_level` and
  `uq_categories_user_parent_lower_name`. Anything else — including this
  table's `CHECK` constraints and any depth trigger, all of which the layers
  above should already have rejected as a `400` — is rethrown and logged, so a
  schema-level surprise shows up as an honest `500` rather than a mislabelled
  conflict.
  **A partial functional unique index reports identically to a table
  constraint** — the same reasoning V4 recorded: PostgreSQL raises
  `SQLSTATE 23505` and puts the *index's* name in the error's `CONSTRAINT`
  field, so `getConstraintName()` returns the index name exactly as it
  returned the old constraint name. Both the `lower(name)` expression and the
  partial `WHERE` clause appear only in the error `DETAIL`. Nothing about the
  matching *mechanism* changed across either decision — ADR 0018 changed the
  string, ADR 0019 made it a list of two.
  **Those two strings and the ADR 0019 `categories` migration must land in the
  same restart** (§12.9).
- **The rollback trap (§3, points 3 and 4) does not apply — checked, not
  assumed.** No method in this domain writes and *then* throws:
  `updateCategory` is written in Domain 2's two explicit phases (resolve and
  reject everything first, mutate afterwards); `persist`'s 409 follows a
  *failed* flush, so rolling back is correct; and the seed writes without
  ever throwing deliberately. So there is no `noRollbackFor` anywhere in
  this domain, and `CategoryService`'s class Javadoc records that reasoning
  next to the code.
- **Injection hardening.** Every query is a Spring Data derived method with
  bound parameters — no native SQL, no `@Query`, no dynamic query
  construction, nothing built from client input
  (`security-architecture.md` §12). Every request DTO carries Bean
  Validation constraints.
- **Logging.** Creates/updates log the category id and *whether* a cap was
  set/cleared — never the amount. A spending limit is personal financial
  information (constitution §23).
- **No pagination**, deliberately: the contract returns a plain array and
  the list is small and bounded. Constitution §11's pagination guidance
  targets lists that grow without bound (Transactions, Activities).

### 12.5 The registration seed hook

`AuthService.register()` now calls `categoryService.seedDefaultsFor(userId)`
immediately after the `user_roles` insert. The set lives in one place —
`service/DefaultCategoryCatalog.java`.

- **Unconditional.** Every new account gets the 8 rows, with **no exemption
  for test accounts** (Project Owner, 2026-10-02 — ADR 0018 §2 changed the
  count from 8 to 7, ADR 0021 §2.1 changed it back to 8 with `Misc` as the
  last entry, and nothing else about this hook changed in either round).
- **The 8th row is load-bearing, not cosmetic.** `Misc` carries
  `is_protected = true` and is `DELETE /categories/{id}`'s reassignment
  target. This hook is the **only** thing that creates it for accounts
  registered from now on: `V8`'s backfill could only cover accounts that
  existed when it ran, and the service deliberately **never** creates it on
  demand. A registration that skipped it would leave an account whose every
  category delete is a `500` (§12.10).
- **Inside the registration transaction.** `seedDefaultsFor` is
  `@Transactional` with default propagation, so it joins `register()`'s
  transaction rather than starting its own: the `users` row, the
  `user_roles` row and the 8 `categories` rows commit together or not at
  all.
- **If seeding fails, registration fails.** There is no try/catch around it
  on purpose. A brand-new user cannot collide with
  `uq_categories_user_id_lower_name`, so a failure here means a real bug (a
  catalog edited into a duplicate name — now including a *case-variant*
  duplicate, or a schema mismatch) — and the
  alternative, swallowing it so registration "succeeds", would leave an
  account with no categories that Add Expense depends on and that **no
  endpoint in this phase can repair** (there is no re-seed endpoint, by
  design). Expect `500 INTERNAL_ERROR`, a logged stack trace, and **no
  `users` row at all** in that case.
- **Verification is the §12.1 check:** register a fresh account, then
  `GET /categories` → 8 entries, and `SELECT count(*) FROM categories
  WHERE user_id = ...` → `8`. Also confirm the log line
  `Seeded 8 default categories for new user <id>` — the count in that line
  is `rows.size()`, not a literal, so it follows the catalog automatically
  (it read `Seeded 7 …` before 2026-10-25, and nothing in the logging code
  changed to make it read 8).
- **Not idempotent, and does not need to be** — the only caller creates the
  user in the same transaction. Calling it twice for one user would violate
  the unique constraint, which is the correct loud failure; nothing here
  silently ignores a conflict (no `ON CONFLICT DO NOTHING`, per the
  Database Architect's handoff note).

### 12.6 Key assumptions — Domain 3

- ~~**⚠ `INCOME_CATEGORY_ID` on the frontend will break when categories come
  from the API — flagged, deliberately not solved here.**~~
  **ANSWERED by ADR 0018 (2026-10-21): income is not a category.** The flag
  was right, and the resolution was neither of the options it listed. There
  is no income category row to find and no id to look up: `categories` holds
  **expense categories only**, `transactions.type` is the discriminator it
  always was, and an income transaction is written with `category_id = NULL`
  plus four server-supplied constants (`Income` / `cash-outline` / `I` /
  `success` — `service/IncomeCategorySnapshot`, ADR 0018 §3). A semantic
  `is_income`/`kind`/`slug` column was considered and **rejected** (ADR 0018
  §4 and "Why the alternative was rejected"): a flag only gives three call
  sites something to filter on, and two of them had already forgotten to.
  `CategoryResponse` gains no field, `categories` gains no column.
  The frontend deletes `INCOME_CATEGORY_ID` rather than re-pointing it (ADR
  0018 §7) — **and that deletion is a prerequisite of Domain 3's frontend
  wiring, not follow-up polish**: the current lookup is dereferenced without
  a null guard, so saving a Credit entry throws a `TypeError` the moment the
  store reads real categories.
  **One consequence worth not re-filing as a bug** (ADR 0018 §5): a user
  *can* still create an expense category named `Income`, and that is
  acceptable precisely because no server code resolves anything by name.
- ~~**Name uniqueness is exact-match — case-sensitive — matching the
  schema.**~~ **ANSWERED by ADR 0018 §6 (2026-10-21): case-insensitive is
  correct, and the frontend's rule won.** `uq_categories_user_id_name` was
  dropped and replaced with the functional unique index
  `uq_categories_user_id_lower_name` on `(user_id, lower(name))`
  (`V4__categories_case_insensitive_name.sql`), and the service-layer
  pre-checks moved to `...IgnoreCase` to match it. `Food` and `food` can no
  longer coexist for one user, which closes the disagreement with
  `utils/categories.js#isDuplicateCategoryName` — the app blocked `food`
  client-side while the API accepted it. The deciding argument was not
  symmetry: two case-variant rows are indistinguishable in the picker and
  give one category **two separate monthly caps**, silently doubling the
  user's intended limit. Whitespace handling is unchanged (trimming, §12.4),
  and `CATEGORY_NAME_ALREADY_EXISTS` is unchanged.
  **One honest limitation, recorded in ADR 0018 §6 rather than papered
  over:** JavaScript's `toLowerCase()` is locale-independent while Postgres
  `lower()` follows the database collation, so an exotic Unicode
  case-folding pair (Turkish dotted/dotless *i*) could in principle be
  judged differently by the two layers. Both agree across ASCII. If a
  mismatch is ever observed, **the index wins** — the client-side check is
  UX only (`security-architecture.md` §3).
- **`iconName` is capped at 100 characters.** The contract says "required"
  without a length; 100 mirrors the `icon_name` column so an over-long
  value is a clean `400` rather than a database error. No icon-name
  allow-list is enforced — the contract doesn't define one, and
  `design-system.md` §6's inventory is a frontend concern; the server
  accepts any non-blank string.
- **List ordering is `created_at`, then `name`** — the contract specifies
  none, and *some* deterministic order is needed. The 8 seeded rows are
  inserted in one transaction and can share a creation instant, so in
  practice they come back name-ordered, with later hand-created categories
  after them. **One consequence of that worth knowing since 2026-10-25:**
  `Misc` is last in the *catalog* but sorts sixth by name, so a client that
  wants it rendered last must order it itself — `isProtected` is the field to
  do that with, never the name. **The frontend should not depend on this order**; it is
  deterministic, not meaningful (the store's own convention is
  newest-first, which is a display choice it can keep making locally).
- **A malformed path variable is `400 VALIDATION_ERROR`, not `404`.** This
  is the first domain with a typed path variable, and
  `MethodArgumentTypeMismatchException` previously fell through to
  `GlobalExceptionHandler`'s catch-all as a `500` with a logged stack
  trace. A handler was added mapping it to the standard `400` shape with
  the parameter named in `fieldErrors` (`security-architecture.md` §4's 400
  row). `404` was the alternative reading; `400` was chosen because the
  request is malformed rather than pointing at a missing resource. Flagging
  since the contract doesn't cover it. **This handler is API-wide**, so
  every later domain with path variables inherits it.
- **A seeded default is fully mutable** (rename, re-icon, re-cap) and
  `is_default` is informational only — confirmed with the Database
  Architect. There is no way to create or clear the flag through the API.
  **Narrowed on 2026-10-25 by exactly one row per user:** the protected
  `Misc` row cannot be renamed or deleted (`400 CATEGORY_PROTECTED`), though
  its icon, glyph and cap remain editable. `is_default` did **not** acquire
  that meaning — a separate `is_protected` column carries it, because all
  eight seeded rows are `is_default` and making that mean "immutable" would
  have locked `Food` too (§12.10).
- **A valid token whose `user_id` no longer exists returns `401
  UNAUTHORIZED`**, same as Domain 2 (`requireUser` on every entry point).

### 12.7 Not done / follow-ups — Domain 3

- ~~**No compile or run in the session that wrote this**~~ — **the original
  Domain 3 implementation was verified end-to-end against a live PostgreSQL
  by the Project Owner on 2026-10-09** (all three endpoints, fresh-account
  seeding, duplicate name → `409`, absent-vs-`null` `monthlyCap`, cross-user
  access → `404`). **The ADR 0018 changes on top of it (§12.8) were again
  written without shell access** and need `./mvnw compile` plus a boot with
  `V4__categories_case_insensitive_name.sql` applied; see §12.8 for exactly
  what to re-check.
- **`exception/PremiumRequiredException.java` is now dead code and should
  be deleted.** It has zero references; the session that removed the gate
  could not delete a file, so its Javadoc says so loudly instead. Still
  true, and still restated by ADR 0018's follow-up item 6 — no session so
  far has had the shell access to remove a file.
- **No automated tests**, consistent with Domains 1–2.
- **The ADR 0021 round (§12.10) was also written without shell access** and
  needs `./mvnw compile` plus a boot with
  `V8__categories_misc_fallback.sql` applied — **the two halves must land in
  the same restart**; see §12.10.8 for exactly what to re-check.
- **Reparenting still does not exist** (ADR 0019 §9, unchanged by ADR 0021
  §2.6), so the tree is half-editable: a mis-parented subcategory can now be
  **deleted** and re-created under the right parent, but not **moved** — and
  the delete sends its transactions to `Misc` on the way, which is a worse
  outcome than a move for exactly the user who made a small mistake. ADR 0019's
  Open Question #2 is **half answered**, not closed.
- ~~**`docs/api/api-overview.md` §3's Status cells still say "Not
  started"**~~ — **corrected by the System Architect with ADR 0018**, along
  with `docs/roadmap/backend-build-order.md`'s Domain 3 row. Both now record
  "backend done and verified; frontend wiring (workflow step 3)
  outstanding", which is the accurate state.
- ~~**The income-category identity question (§12.6) blocks nothing in this
  domain but needs resolving before Domain 4**~~ — **resolved by ADR 0018
  §3** (§12.6). Domain 4 is unblocked on that point. Its two other blockers
  stand and are not affected: the **receipt-upload ADR** (or an explicit
  deferral of receipt support) and **Domain 3's own frontend wiring**, which
  the build order says comes before the next domain and which carries the
  `INCOME_CATEGORY_ID` deletion with it.
- **Accounts created before this domain have no categories** and the other
  seven are still not backfilled (`V3__categories.sql` seeds no rows,
  deliberately). If the Project Owner wants existing test accounts usable, the
  cheapest route is registering fresh ones; a backfill of the seven would be a
  Database-Architect-owned migration plus a decision about what "default" means
  for an account that has been live for a while.
  **One exception as of 2026-10-25:** `V8` backfilled a protected `Misc` row
  for **every** user that had none, because `DELETE /categories/{id}` needs a
  target that is *guaranteed* to exist (§12.10). So one of those
  category-less accounts now holds exactly one category — its `Misc`. That
  looks odd and is correct: the invariant is "every user has a reassignment
  target", not "every user has the full seed set".

### 12.8 ADR 0018 (2026-10-21) — what changed after Domain 3 was verified

`docs/decisions/0018-income-is-not-a-category.md` changed already-shipped,
already-verified Domain 3 code. Three changes, nothing else:

1. **The seed set is 7, not 8 — `Income` is gone.** *(Count superseded on
   2026-10-25: it is 8 again, with `Misc` as the 8th — §12.10. The membership
   and the reasoning in this item stand unchanged for those seven, and `Misc`
   is emphatically not `Income` returning.)*
   `service/DefaultCategoryCatalog.java`. Income is not a category:
   `transactions.type` is the discriminator (and always was), so a row for it
   made `Income` selectable as an *expense* category and gave it a monthly
   *spending* cap — both nonsense, both live behaviour before this change.
   Removing the row makes both structurally impossible rather than merely
   discouraged; a semantic `is_income` flag would only have given three call
   sites something to filter on. The seed hook itself is untouched:
   unconditional, inside the registration transaction, no test-account
   exemption, no try/catch.
2. **Category names are unique case-insensitively.**
   `CategoryRepository`'s pre-checks became
   `existsByUserIdAndNameIgnoreCase` / `...IgnoreCaseAndIdNot`, and
   `CategoryService.UNIQUE_NAME_CONSTRAINT` became
   `uq_categories_user_id_lower_name`. The pre-check **and** the
   violation-catch are both kept, as before: the pre-check gives the clean
   error, the index is the only real guard against the concurrent-insert
   race.
3. **The income snapshot constants exist** —
   `service/IncomeCategorySnapshot.java`, a new file holding the four
   server-authoritative values an income transaction carries (`Income` /
   `cash-outline` / `I` / `success`). **Nothing reads them yet**: their
   consumer is Domain 4's transaction write path. ADR 0018's follow-up item 3
   allowed either now or with Domain 4 and required only that they are never
   re-typed inline; they are here now so that the forcing function is a named
   class next to `DefaultCategoryCatalog` rather than a line in a follow-up
   list. The file's own Javadoc records that reasoning, including why this is
   not the same call as Domain 2's declined unused `PATCH /users/me` wrapper
   (a wrapper is behaviour whose shape depends on an absent caller; these are
   four literals whose shape the ADR fixed).

**Deliberately unchanged:** `CategoryResponse` (no `isIncome`, `kind`, `slug`
or `tone` — ADR 0018 §4), the `categories` columns, the `409
CATEGORY_NAME_ALREADY_EXISTS` code, trimming, the three endpoints' shapes,
and every DTO. **No API contract change**, so no client needs updating for
the backend half.

#### The one thing that must not ship half-way

`V4__categories_case_insensitive_name.sql` (Database-Architect-owned: a
fail-loud pre-flight guard, then `DROP CONSTRAINT uq_categories_user_id_name`,
then `CREATE UNIQUE INDEX uq_categories_user_id_lower_name ON categories
(user_id, lower(name))`) and change 2 above **must land in the same restart.**

The index name changes, and `CategoryService` identifies the `409` by
constraint name. If the constant is updated while V4 is unapplied — or V4 is
applied against a stale constant — every *sequential* duplicate is still a
clean `409` from the pre-check, but a *concurrent* duplicate becomes a logged
`500`. It fails closed rather than loosely: the old literal is not a
substring of the new name (they differ by the inserted `lower_`), so there is
no partial match to mask it.

**If V4 refuses to apply**, it has found rows already violating
case-insensitive uniqueness (plausible — §12.2's own test case created a
lowercase `pets` alongside `Pets`). That is deliberate: it must not delete,
rename or merge anything. Resolve the pair by hand — `PATCH
/categories/{id}` to rename the loser, or delete it in the dev database —
then re-apply. Nothing anywhere references a `categories` row yet
(`transactions`, `budget_period_category_caps` and `split_expenses` do not
exist), which is what makes that cheap today and expensive after Domain 4.

#### Re-verification checklist

Everything Domain 3 was verified on still applies — these are the points this
change could plausibly have broken:

- **Seeding** — register a fresh account: `GET /categories` → **8 since
  2026-10-25** (this line read **7** when it was written; ADR 0021 added
  `Misc` — §12.10), no `Income`, `SELECT count(*)` → `8`, log line
  `Seeded 8 default categories for new user <id>`. Seeding still happens
  inside the registration transaction (§12.5).
- **Case-insensitive create** — `POST` `"pets"` after `"Pets"` → **`409`**
  (was `201`). Postman request **21b** asserts exactly this.
- **Case-insensitive rename** — `PATCH` a category's name to `"food"` while
  `Food` exists → `409`. But re-casing a category's **own** name (`Food` →
  `food`, same id) → `200`, and the stored name becomes `food`.
- **Trimming unchanged** — `"Pets  "` still conflicts; the rule is
  case-insensitive, not whitespace-insensitive.
- **Concurrent duplicate** → `409`, not `500`. This is the one that proves
  the constraint-name matcher and V4 agree; it needs two simultaneous creates
  of the same name for one user, so it is the hardest item here to exercise
  and the only one that distinguishes "both halves landed" from "only the
  pre-check is doing the work".
- **Unaffected, but worth re-running since this is a live domain:**
  `monthlyCap` absent-vs-explicit-`null` (§12.3), a seeded default still
  editable, cross-user access → `404` (never `403`), malformed id → `400`,
  no-token → `401`.
- **Rollback trap (§3, points 3 and 4) still does not apply** — re-checked
  against the changed code rather than assumed. The case-insensitive
  pre-check is still evaluated in `updateCategory`'s phase 1, before
  anything is mutated, and `persist`'s `409` still follows a *failed* flush,
  so a rollback remains the correct outcome in both paths. No
  `noRollbackFor` anywhere in this domain, and none was added.

#### Not verified in the session that made these changes

No shell access, so: **not compiled, not run, no live request issued.** The
specific statically-unverifiable items are (a) that Spring Data derives
`existsByUserIdAndNameIgnoreCase` / `...IgnoreCaseAndIdNot` without a
`PropertyReferenceException` at context startup — the `IgnoreCase`-before-
`AndIdNot` parse is the only non-obvious part, and it fails loudly at boot if
wrong; (b) that `getConstraintName()` returns the index name on a real
concurrent violation (reasoned through with the Database Architect, who
confirmed PostgreSQL's reporting is identical for a functional index, but
reasoning is not a run); and (c) the Postman collection's JSON parses in
Postman and request 21b's pre-request script populates `categoryNameLower`.

#### Not this agent's half

`INCOME_CATEGORY_ID` and `useCategoriesStore`'s `cat-income` entry are
Frontend-Engineer-owned (ADR 0018 §7 and its frontend follow-up list), and
until they ship, the store's 8-entry list disagrees with this seed on
membership — it carries `cat-income` and lacks `Misc`. (It disagreed on
*length* too until ADR 0021 took the seed back to 8; since 2026-10-25 both
are 8, which makes the disagreement harder to spot, not smaller.)
The stray `Income` row in accounts registered before 2026-10-21 is a Project
Owner data decision (§12.1, ADR 0018's "Existing data") — this backend does
not touch existing rows, and no endpoint here can remove one.

### 12.9 ADR 0019 (2026-10-22) — subcategories, one optional level

`docs/decisions/0019-subcategories-one-optional-level.md` added **one optional
level of subcategories** to already-shipped Domain 2 and Domain 3 code.
**No endpoint was added**: the whole feature is one optional request field,
two added response fields, one settings boolean and four service-layer rules.
Everything is **additive** — no existing field changed type or meaning, so no
client contract broke.

#### What a subcategory is

A row in the same `categories` table with a non-null `parent_category_id`
(data-model.md §2.1). It is otherwise an ordinary, fully mutable, user-owned
expense category: its own name, icon and glyph, selectable wherever a category
is, referenced by `transactions.category_id` directly when chosen. **Exactly
one level** — a row with a parent can never itself be a parent.

#### The contract delta

| Where | Change |
|---|---|
| `GET /users/me/settings`, `PATCH /users/me/settings` | `subcategoriesEnabled` — third boolean, default `false` (§11.5) |
| `GET /categories` | Returns a **two-level tree**: top-level entries only at the root, children inside their parent's `subcategories` |
| `CategoryResponse` | `+ parentCategoryId` (null at top level), `+ subcategories` (always `[]` on a child) |
| `POST /categories` | `+ parentCategoryId`, optional. New: `404 PARENT_CATEGORY_NOT_FOUND`, `400 SUBCATEGORY_DEPTH_EXCEEDED` |
| `POST`/`PATCH /categories` | A non-null `monthlyCap` on a row with a parent is `400 VALIDATION_ERROR` |
| `409 CATEGORY_NAME_ALREADY_EXISTS` | Same code; meaning widens from "for this user" to "for this user, **among these siblings**" |
| `PATCH /categories/{id}` | Still has **no** `parentCategoryId` — a row's level is fixed at creation |

#### `subcategoriesEnabled` gates nothing server-side — this is load-bearing

It follows `paymentModeEnabled`'s precedent exactly (ADR 0019 §6.1): that flag
decides whether Add Expense *shows* the payment-mode fields while
`transactions.payment_mode` is `NOT NULL` regardless. A settings flag in this
codebase is a **UI affordance, not an authorization rule**.

Concretely, and please do not "fix" any of these:

- `POST /categories` accepts a `parentCategoryId` whether the flag is `true`
  or `false`. A subcategory created while it is off is still a legitimate,
  user-owned row.
- `GET /categories` **always** returns the complete tree. No response shape in
  this API depends on the flag — a shape that did would race with
  `useUserSettings`, which is lazily loaded and which only the Profile screen
  reads today.
- `CategoryService` never reads it. Nothing outside the two settings endpoints
  does. Its class Javadoc says so next to the code.
- Setting it to `false` writes **one boolean and touches no other row**
  (§6.2): no delete, no reparent, no flagging, nothing hidden from the API.
  Subcategories are hidden **by the client**, never destroyed, and turning it
  back on restores everything with nothing to re-create.

#### The four service-layer rules, and why each is where it is

All four are decided in `CategoryService` **before anything is mutated**, which
is what keeps the rollback trap (§3, points 3 and 4) inapplicable to this
domain — re-checked against the changed code, not assumed. Still no
`noRollbackFor` anywhere here.

1. **A cap may not accompany a parent.** `400 VALIDATION_ERROR` via
   `SubcategoryCapNotSupportedException` — a named class with the *generic*
   code, because the contract chose generic copy for a rejection no client
   should ever trigger (the create-subcategory form has no cap field). Checked
   **first** on both paths: it is the cheapest rule, it depends on no other
   row, and answering it needs no database round trip. On `PATCH` only a
   **non-null** cap is rejected; an explicit `null` on a subcategory stays a
   legal no-op (clearing a cap the row could not have had).
2. **The parent must be the caller's own.** `404 PARENT_CATEGORY_NOT_FOUND`,
   **including when it exists but belongs to someone else** — never a `403`,
   which would confirm the id is real (`security-architecture.md` §2). Resolved
   with the same owner-scoped `findByIdAndUserId` the PATCH target uses.
3. **The parent must itself be top-level.** `400 SUBCATEGORY_DEPTH_EXCEEDED`.
   A `404` would be a lie: the row exists and is the caller's own, so this is
   *ineligibility*, not absence. **Mandatory in this layer** regardless of the
   database's own trigger (ADR 0019 §2).
4. **A name is unique, case-insensitively, among its siblings.** `409`, code
   unchanged. Top-level names are compared against top-level names; a child's
   name against its own parent's children. So `Food › Snacks` and
   `Transport › Snacks` may **both** exist, a top-level `Snacks` may coexist
   with either, and `Food`/`food` still may not coexist at either level.

#### How the nested response is assembled — one query, not N+1

`GET /categories` issues **one** owner-scoped read
(`findByUserIdOrderByCreatedAtAscNameAsc`, both levels, flat) and
`CategoryService.toTree` groups it in memory: one pass collects every row that
has a parent under that parent's id, a second emits the top-level rows in the
repository's deterministic order, each carrying its children in that same
order. Fetching children per parent would be 1 + N round trips for a result
set the service already holds every row of (constitution §10).

`PATCH /categories/{id}` costs **one extra bounded query**, and only when the
updated row is top-level: its response must carry its real `subcategories`
rather than `[]`, because a client that writes the response into its store
would otherwise read "this parent's subcategories are gone". A subcategory's
children are empty by the depth rule, so that case needs no query. `POST`
needs none at all — a brand-new row can have no children at either level.

#### ⚠ The thing that must not ship half-way — two constraint names now

`V5__user_settings_subcategories_enabled.sql`,
`V6__categories_subcategories.sql` (both Database-Architect-owned) and this
backend change **must land in the same restart**, in both directions:

- **Migrations without the backend half** — nothing breaks, but the new
  columns are unused.
- **Backend half without the migrations** — the app **will not start**.
  `ddl-auto=validate` fails fast on the two new entity fields
  (`Category.parentCategoryId`, `UserSettings.subcategoriesEnabled`) before
  anything serves traffic. Loud and safe, which is the intent.
- **The `409` matcher is the subtle one.** `CategoryService` identifies
  `CATEGORY_NAME_ALREADY_EXISTS` by constraint name, and V6 replaces V4's one
  index with **two partial ones**:

  ```
  uq_categories_user_lower_name_top_level   (user_id, lower(name)) WHERE parent_category_id IS NULL
  uq_categories_user_parent_lower_name      (user_id, parent_category_id, lower(name)) WHERE parent_category_id IS NOT NULL
  ```

  `CategoryService.UNIQUE_NAME_CONSTRAINTS` is now a **list of those two full
  names**, where it held one string before. V4's
  `uq_categories_user_id_lower_name` is **dropped** and is deliberately **not**
  kept in that list as a transition aid: with V4's index still in place, a
  legitimate `Transport › Snacks` would then be answered with a
  plausible-looking `409` instead of an honest `500`. A half-applied migration
  must look broken, not merely strict. It fails closed either way — the old
  literal is not a substring of either new name.

**Three traps in that matcher, all flagged by the Database Architect on
2026-10-22 and all handled:**

1. **The depth trigger raises with NO constraint name.** V6 adds
   `trg_categories_enforce_depth_one` (this schema's first trigger), and a
   plpgsql `RAISE` has no associated constraint, so `getConstraintName()`
   returns **`null`** on that path. A `name.toLowerCase(...).contains(...)`
   matcher would throw a `NullPointerException` *inside* the handler for the
   original failure. `isUniqueNameViolation` is written null-safe **generally**
   — true of any trigger-raised or otherwise unnamed integrity error, not
   special-cased for this trigger — and keeps walking the cause chain in case a
   named violation sits deeper.
2. **Never match the shared prefix.** V6 also adds
   `uq_categories_user_id_id` (`UNIQUE (user_id, id)`), which exists only so
   the composite parent FK is declarable and has nothing to do with names. It
   shares the `uq_categories_user_` prefix, so a prefix matcher would mislabel
   it as a duplicate name. The two **full** names are matched; neither is a
   substring of it, and it is not a substring of either.
3. **Nothing else V6 added means "duplicate name".**
   `fk_categories_parent_category_id` (23503 — unreachable from a legal
   request, because rule 2 above pre-resolves the parent),
   `chk_categories_subcategory_has_no_cap` and `chk_categories_parent_not_self`
   (23514 — rule 1 answers the first as a `400` first) all fall through to a
   logged `500 INTERNAL_ERROR`. **That is correct:** reaching one means a
   service-layer rule was skipped, so an honest 500 is better than a
   plausible-looking 400 or 409.

#### Reparenting: structurally impossible, not merely rejected

`UpdateCategoryRequest` has no `parentCategoryId` property and must not gain
one (ADR 0019 §9), `Category.parentCategoryId` is mapped
`updatable = false`, and no code path in `updateCategory` writes that column.
So a `"parentCategoryId"` key in a PATCH body is **ignored**, exactly as any
other unknown field is (the API-wide behaviour recorded in §11.8), and the
row's level cannot change.

**Flagged to the System Architect rather than resolved unilaterally:**
ADR 0019's follow-up item 4 says PATCH "must reject `parentCategoryId`" while
also saying "it is not a field on that request and must not become one," and
`api-overview.md` §3.3's error table defines **no error code** for an attempted
parent change. Those two cannot both be satisfied by a `400` — rejecting
requires binding the field. This implementation took the structural reading
(no field, silent no-op, nothing reparented) and **invented no error code**.
If a loud `400` is wanted instead, that is a one-line contract addition plus a
presence-tracking setter; say so and it is a small change.

The known limitation that leaves, stated rather than hidden: combined with the
absence of a delete endpoint, **a subcategory created under the wrong parent is
stuck** — rename it where it is, or ignore it. ADR 0019 §9 records this and
recommends one "edit the category tree" pass covering delete *and* reparent
together; Open Question 2 in that ADR puts it to the Project Owner.

#### Deliberately unchanged

- **`DefaultCategoryCatalog`** — unchanged *by ADR 0019*: every seeded row is
  top-level and there are **no seeded subcategories** (§8). The second level
  starts empty for everyone. The seed hook is also untouched: unconditional,
  inside the registration transaction, no test-account exemption, no
  try/catch. *(It was "exactly 7 rows" when this was written; ADR 0021 later
  added an 8th, `Misc` — §12.10. Both statements above still hold of the
  8-row catalog: the new row is top-level and is not a subcategory.)*
- **`IncomeCategorySnapshot`** — untouched. ADR 0019 §5 adds a sixth value
  (`parent_category_name = NULL`) to the income constant block, but that is
  **specification-only today** (follow-up items 7–10, "no action now") and
  lands with Domain 4's transaction write path. Income gains no special case:
  it is `NULL` there for the same reason a top-level expense is — no parent.
- **`CategoryResponse` still carries no semantic field** — no `isIncome`, no
  `kind`, no `slug`, no `tone`. ADR 0018 §4's prohibition stands;
  `parentCategoryId` is not a field of that class (it records a relationship
  nothing else records, and leaves every row meaning the same thing).
- Trimming, the `CATEGORY_NAME_ALREADY_EXISTS` code, `monthlyCap`'s
  absent-vs-explicit-null semantics, the owner-scoped `404`s, the malformed-id
  `400`, rate limiting (default per-user tier, **no second mechanism added**),
  and every other Domain 1–3 behaviour.

#### Re-verification checklist

Everything Domains 1–3 were verified on still applies. **Re-run the whole
Domain 3 suite** — this change touched live create/update/list paths. The
points this change could plausibly have broken, in order:

**Must still be true (regression checks):**

- **Seeding** — register a fresh account: `GET /categories` → **8 since
  2026-10-25** (written as **7**; ADR 0021 added `Misc` — §12.10), no
  `Income`, every entry `parentCategoryId: null` and `subcategories: []`,
  `SELECT count(*)` → `8`, log line `Seeded 8 default categories for new user`.
- **Duplicate top-level name** → `409`, including the case variant (`pets`
  after `Pets`) and the trimming case (`"Pets  "`).
- **Self-recase** (`Pets` → `pets` on the same id) → `200`, and the stored
  name really becomes `pets`.
- **`monthlyCap` absent vs. explicit `null`** on PATCH — both still correct
  (§12.3's (a)/(b)).
- **A seeded default is still editable**; `isDefault` stays `true`.
- **Cross-user access** → `404 CATEGORY_NOT_FOUND`, never `403`; malformed id
  → `400`; no token → `401`.
- **Non-premium currency change** (§11.4, step 3) → `200`.
- **Settings** — `GET` on a brand-new account still writes no row
  (`SELECT count(*) FROM user_settings` → `0`).

**New behaviour:**

- `GET /users/me/settings` → three keys, `subcategoriesEnabled: false`.
- `PATCH {"subcategoriesEnabled": true}` → `200`, one row, other two columns
  untouched. Then `false` again and confirm **`categories` is byte-identical**
  before and after — same row count, same `parent_category_id` values.
- `POST` with `parentCategoryId` = Food's id → `201`, `parentCategoryId`
  echoed, `subcategories: []`, `isDefault: false`, `monthlyCap: null`, and
  `SELECT parent_category_id FROM categories WHERE id = '<new id>'` matches.
- **The same name under two different parents must both succeed** —
  `Food › Snacks` **and** `Transport › Snacks` → `201` twice. This is the one
  that proves V6 landed: with V4's index still in place the second would fail.
- **A top-level category named `Snacks`** alongside `Food › Snacks` → `201`.
- Duplicate **sibling** name (`Food › snacks` after `Food › Snacks`) → `409`.
- `monthlyCap` + `parentCategoryId` → `400 VALIDATION_ERROR`.
- `parentCategoryId` naming a subcategory → `400 SUBCATEGORY_DEPTH_EXCEEDED`.
- `parentCategoryId` unknown, **and** one belonging to a second account →
  `404 PARENT_CATEGORY_NOT_FOUND` in both cases, identically.
- `GET /categories` → the root array still holds **only** top-level rows (its
  length does not grow when a subcategory is created), `Food.subcategories`
  holds the child, and the child carries `parentCategoryId` + `subcategories: []`.
- `PATCH` a **subcategory's** name/icon/glyph → `200`. `PATCH` it with
  `monthlyCap: 500` → `400`; with `monthlyCap: null` → `200` (legal no-op).
- `PATCH` a **parent** → `200` **with its `subcategories` still populated**.
  An empty array here is the bug this costs one query to avoid.
- **Concurrent duplicate → `409`, not `500`** — the hardest item and the only
  one that distinguishes "both halves landed" from "only the pre-check is
  working". Worth doing once per parent scope (two concurrent top-level creates
  of one name; two concurrent creates of one name under one parent), since the
  two cases exercise *different* indexes.
- **Trigger sanity, by hand in psql, not through the API:** an
  `INSERT ... parent_category_id = <a subcategory's id>` must be refused by
  `trg_categories_enforce_depth_one`. Through the API this is unreachable; if
  it ever surfaces there it arrives as a logged `500` with a **null**
  constraint name, which the matcher now survives instead of throwing an NPE.

#### Not verified in the session that made these changes

No shell access, so: **not compiled, not run, no live request issued.** The
statically-unverifiable items, in rough order of risk:

1. **That Spring Data derives the four new pre-check methods** without a
   `PropertyReferenceException` at context startup —
   `existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCase[AndIdNot]` and
   `existsByUserIdAndParentCategoryIdAndNameIgnoreCase[AndIdNot]`, plus
   `findByUserIdAndParentCategoryIdOrderByCreatedAtAscNameAsc`. The
   `IgnoreCase`-before-`AndIdNot` parse is already proven by the two methods
   these replace; `ParentCategoryIdIsNull` (a keyword binding no parameter,
   mid-expression) is the genuinely new part. **It fails loudly at boot if
   wrong**, not at request time.
2. **That `@Column(updatable = false)` on `parentCategoryId` does not disturb
   the insert.** It should not — `updatable` governs UPDATE only, and
   `userId` on the same entity has carried it since Domain 3 — but this is the
   one mapping change that could in principle make a created subcategory land
   with a `NULL` parent. **Check the first `POST` with a parent writes the
   column**, which the Postman test asserts.
3. **That `getConstraintName()` returns the index name on a real concurrent
   violation of a *partial* index** — reasoned through with the Database
   Architect, who confirmed the reporting is identical to V4's plain functional
   index, and V4's half of it is now live-verified. Reasoning is still not a
   run.
4. **That the trigger path really produces a null constraint name** rather than
   some surrogate. The guard is harmless either way.
5. **That the Postman collection's JSON parses** and that requests 32+ chain
   their variables correctly (`foodCategoryId`/`transportCategoryId` from
   request 19, `subcategoryId` from request 32).

#### Not this agent's half

- **`/database`** — `V5`/`V6` are Database-Architect-owned and were written in
  parallel with this change; nothing here edits them.
- **`/frontend`** — `useCategoriesStore`'s nested shape and `addSubcategory`,
  the two-level Category Picker, `formatCategoryPath`, `useRecentCategories`'
  pair-resolution, the Profile toggle row, and — **not optional** —
  `isSettingsResponse` gaining its third `typeof === 'boolean'` check, which is
  what stops `undefined` reaching a boolean if the halves deploy out of order
  (ADR 0019 §10.5, frontend follow-up item 6). All Frontend-Engineer-owned, and
  ADR 0019 §10.1 says they land **with** Domain 3's wiring step, after this.
- **`/docs`** — `api-overview.md` §3's Status cells still read `Done`
  *(against the pre-2026-10-22 contract)*. Once the Project Owner's testing
  pass confirms this round, that parenthetical is the System Architect's to
  remove.

### 12.10 ADR 0021 (2026-10-25) — delete, `Misc`, and rename propagation

`docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md`
is two Project Owner rulings pointed at one mechanism, landing together:

> *"if category is renamed then, the renamed category should be shown in the
> transaction thats what i meant"*
>
> *"You are deleting the category having some transactions which will be now
> consider in the misc category"*

Both are a server-side `UPDATE` of the same four snapshot columns on
`transactions`, aimed at different events — which is why they ship in one pass.
Getting one right without the other would leave rows reading `Snacks` while
pointing at `Misc`.

**This half is COUPLED to `V8__categories_misc_fallback.sql` and must land in
the same restart.** That migration adds `categories.is_protected`, the partial
unique index `uq_categories_user_protected`, the
`chk_categories_protected_is_top_level` CHECK, the
`trg_categories_enforce_protection` trigger, and a backfill of one protected
`Misc` row per existing user. **Without it the app will not start**
(`ddl-auto=validate` fails on the unmapped column), and with it but without
this code every new registration would leave an account with no reassignment
target.

**What changed, in one list:**

1. **`DefaultCategoryCatalog` has an 8th entry, last** — `Misc` /
   `ellipsis-horizontal-outline` / `M`, no cap, `isDefault: true`,
   **`isProtected: true`**. Values byte-identical to `V8`'s backfill, or a
   backfilled user and a newly-registered one would hold visibly different
   targets. **There is no `tone` value** — `categories` has no tone column and
   must not gain one; `transactions.category_tone` is derived from `type`, so a
   reassigned expense already reads `neutral` with nothing stored.
2. **`Category.isProtected` → `is_protected`**, mapped as a primitive
   `boolean` (the column is `NOT NULL DEFAULT FALSE`, so there is no third
   state), and **`CategoryResponse.isProtected`** so the client can hide the
   delete/rename affordance.
3. **`DELETE /api/v1/categories/{id}`** → `200` with
   `{ reassignedTransactionCount, deletedSubcategoryCount }`.
4. **`GET /api/v1/categories/{id}/usage`** → `{ categoryId, transactionCount,
   subcategoryCount }`.
5. **`PATCH` propagates** a name/icon/glyph change into `transactions` —
   **two** UPDATEs, not one.
6. **`PATCH` refuses a `name` change on the protected row** with
   `400 CATEGORY_PROTECTED`, while accepting `iconName`, `glyph` and
   `monthlyCap` on it.

**Postman coverage is requests 84–112** of
`backend/postman/MyExpense-Auth.postman_collection.json`, in the order this
section walks through: resolve the protected row, the pre-flight, a delete that
reassigns, the second-delete `404`, the parent cascade, both
`CATEGORY_PROTECTED` refusals and the per-field acceptance, then the
rename-propagation proof including the `Food › Lunch` parent case. They need
requests 19, 32 and 48 to have run on the same account and they create their
own fixtures, in **November 2026** so the Statistics assertions (September) and
Domain 4's rows (October) stay exact. Request **45**'s console notes carry the
inversion correction described below, and request **19** now asserts 8 rows
with exactly one protected.

#### The resolution rule — the one thing not to reinterpret

`Misc` is found as **"the caller's own row with `is_protected = true`"**:

```sql
SELECT ... FROM categories WHERE user_id = :callerId AND is_protected;
```

**Never by the name `Misc`, never by `is_default`, never by a well-known id.**
Nothing in this system resolves a category by name (ADR 0018 §5), and that is a
safety property, not a style preference: names are unique only
case-insensitively and only among siblings, a user may already own a category
called `misc`, and names are mutable while identity must not be — a name-matched
target would be hijackable by a rename, which (since this very ADR) would then
propagate into transaction history. `is_default` cannot do the job either: it is
`true` for all eight seeded rows, so overloading it would have made `Food`
undeletable.

**It lives in exactly ONE method — `CategoryService#resolveProtectedCategory`**
— and everything that needs the row calls it. One site rather than two is the
whole mitigation: a second implementation of this lookup is how a by-name match
creeps back in.

**The service RESOLVES the row and never CREATES it.** `V8` guarantees exactly
one per user (backfill + `uq_categories_user_protected` + its own STEP 7
assertion) and the registration seed covers every account created since. If the
row is absent, that is a broken invariant, and the honest answer is a logged
`500 INTERNAL_ERROR` — not a get-or-create inside a financial write path. **The
likeliest cause of that 500 is `V8` not having been applied.**

#### 12.10.1 The usage pre-flight (§3.5)

```bash
curl -i http://localhost:8080/api/v1/categories/<categoryId>/usage \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "categoryId": "<categoryId>", "transactionCount": 14, "subcategoryCount": 2 }
```

**Why this exists rather than something cheaper.** The warning is shown
*before* the user confirms, so the client needs the count up front, and the
option that looks cheapest is wrong by construction: `GET /transactions` is
**paginated**, so a client counting from its own store would under-report — a
category with 300 transactions, none on the page it holds, would delete with
**no warning at all**. A `transactionCount` on `GET /categories` was rejected
too (an aggregate over `transactions` on the app's most-read structural read).
**A client must never derive a total from a paginated list.**

Four things to check:

- **It rolls up.** Ask about a **parent**: `transactionCount` includes rows
  tagged to its subcategories, and `subcategoryCount` is non-zero. Ask about a
  **subcategory**: only its own rows, and `subcategoryCount` is always `0`.
  It is the same id set §3.4 reassigns and the same semantics as
  `GET /transactions?categoryId=`, resolved by the same service helper — so the
  warning and the write cannot disagree.
- **It is legal on the protected row.** `GET /categories/<misc id>/usage` is a
  plain `200`, **not** `400 CATEGORY_PROTECTED`: asking is legal, only deleting
  is refused.
- **Zero is a normal answer** — `{"transactionCount": 0, "subcategoryCount": 0}`
  on a fresh category, never a `404`.
- **Side-effect-free.** Re-run it ten times; nothing is written, nothing is
  reserved, and the number is never sent back to the server.

Errors: `404 CATEGORY_NOT_FOUND` (unknown **or** another account's, identically
— never `403`), `400 VALIDATION_ERROR` (malformed uuid), `401` with no token.

#### 12.10.2 A delete that reassigns (§3.4)

```bash
# 1. a category with one transaction on it
curl -i -X DELETE http://localhost:8080/api/v1/categories/<categoryId> \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "reassignedTransactionCount": 1, "deletedSubcategoryCount": 0 }
```

**`200` with a body, not `204`** — the one place this domain departs from
`DELETE /transactions/{id}`'s `204` (§13.5), because **this delete mutates rows
the caller did not name.** A `204` would leave the client with nothing but its
own possibly-stale pre-flight number. The body is additive and ignorable: a
client that reads only the status code is correct. Both numbers are
after-the-fact facts, **not a confirmation protocol** — there is no two-phase
delete and the pre-flight is never sent back.

Now re-read the transaction:

```bash
curl -i http://localhost:8080/api/v1/transactions/<transactionId> \
  -H "Authorization: Bearer $TOKEN"
```

- `categoryId` is now **`Misc`'s id**;
- `categoryName` is `"Misc"`, `categoryIconName` is
  `"ellipsis-horizontal-outline"`, `categoryGlyph` is `"M"`;
- `parentCategoryName` is **`null`** (the protected row is always top-level,
  which is what `chk_categories_protected_is_top_level` is for — it means the
  reassignment can null the parent with no branch);
- `categoryTone` is **unchanged** (`neutral`) — it follows `type`, not the
  category;
- `updatedAt` has advanced; **`version` has NOT**.

```sql
SELECT category_id, category_name, parent_category_name, category_icon_name,
       category_glyph, category_tone, version, updated_at
FROM transactions WHERE id = '<transactionId>';
-- category_id = the Misc row's id, parent_category_name NULL, version unchanged

-- The category row is GONE — a hard delete, not a soft one:
SELECT count(*) FROM categories WHERE id = '<categoryId>';
-- 0

-- And nothing was left dangling:
SELECT count(*) FROM transactions
 WHERE user_id = '<id>' AND type = 'expense' AND category_id IS NULL;
-- 0  (if this is ever non-zero, the reassignment missed a row and
--     fk_transactions_category_id's ON DELETE SET NULL silently nulled it)
```

**A hard delete, deliberately** (§2.7): `categories` has no `deleted_at` and is
not gaining one — a soft-delete column would put a `WHERE deleted_at IS NULL`
filter on every read of that table, and the transaction snapshot columns are
what already make a hard delete safe.

**A second `DELETE` of the same id is `404 CATEGORY_NOT_FOUND`** — the row
genuinely no longer exists. The operation is idempotent **in effect, not in
status code**, and the client rule follows: a `404` on a retry of a delete the
user already confirmed is success, not an error to surface.

#### 12.10.3 The parent cascade — the case worth testing by hand

Create `Travel`, give it a subcategory `Flights`, tag a transaction to **the
subcategory**, then delete **the parent**:

```bash
curl -i -X DELETE http://localhost:8080/api/v1/categories/<travelId> \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "reassignedTransactionCount": 1, "deletedSubcategoryCount": 1 }
```

**The transaction tagged to the cascaded child goes to `Misc`, NOT to the
surviving parent** — there is no surviving parent in a cascade, and applying a
different rule when a child is deleted on its own would give one user action two
outcomes they cannot predict. One rule, both levels. So that row now reads
`categoryName: "Misc"` and `parentCategoryName: null` — **not** `"Travel"`.

```sql
SELECT count(*) FROM categories WHERE id IN ('<travelId>', '<flightsId>');
-- 0 — both rows are gone
```

**Children are deleted before the parent, and by their resolved ids.** The
order is what keeps `V6`'s `NO ACTION` self-FK satisfied without a migration.
Deleting them *by id* (rather than by `parent_category_id = ...`) is what makes
§2.4's required check meaningful: a child created by another device **after**
this request resolved its id set is not silently destroyed — it is left in
place, the parent's own delete then fails loudly on the self-FK, and the whole
transaction rolls back.

#### 12.10.4 The protected row refuses two things, and accepts the rest

```bash
# DELETE the protected row → 400 CATEGORY_PROTECTED (never 403, never 404)
curl -i -X DELETE http://localhost:8080/api/v1/categories/<miscId> \
  -H "Authorization: Bearer $TOKEN"

# PATCH its name → 400 CATEGORY_PROTECTED
curl -i -X PATCH http://localhost:8080/api/v1/categories/<miscId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Miscellaneous" }'

# PATCH its icon, glyph and cap → 200. This is the half that is easy to
# over-enforce: the refusal is per-FIELD, not per-row.
curl -i -X PATCH http://localhost:8080/api/v1/categories/<miscId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "iconName": "apps-outline", "glyph": "MX", "monthlyCap": 500.00 }'
```

**`400`, not `403`** — the row exists and is the caller's own, so this is
*ineligibility*, not an authorization failure (the same test §3.2's
`SUBCATEGORY_DEPTH_EXCEEDED` applied). One code for both conditions,
deliberately: one condition, one code.

**An icon change on `Misc` propagates like any other** — re-read a transaction
that was reassigned into it and its `categoryIconName` follows. That is the
clearest proof that the per-field reading is implemented rather than just
documented.

**`"name": null` on the protected row is NOT refused** — it is a legal no-op.
`name` backs a `NOT NULL` column, so this DTO treats an explicit `null` exactly
like omission (the same lenient rule Domain 2 applies and the same shape as the
cap rule, which also rejects only a *non*-null value). There is no rename being
requested, so there is nothing to refuse.

**Decided service-side, before the write.** `V8`'s
`trg_categories_enforce_protection` is a backstop against a service bug or a
direct SQL write, **not** the error path: a plpgsql `RAISE` carries **no
constraint name**, so it cannot be mapped onto this `400` even in principle and
correctly surfaces as a logged `500`. **If you ever see a `500` where this
`400` belongs, the service check was skipped.** Worth exercising by hand in
psql, where it is the only way to reach it:

```sql
DELETE FROM categories WHERE id = '<miscId>';                   -- refused
UPDATE categories SET name = 'X' WHERE id = '<miscId>';         -- refused
UPDATE categories SET is_protected = FALSE WHERE id = '<miscId>'; -- refused
UPDATE categories SET icon_name = 'apps-outline' WHERE id = '<miscId>'; -- allowed
```

#### 12.10.5 Rename propagation — TWO UPDATEs, and the second is the one that gets missed

```bash
# Food has a subcategory (Lunch / Snacks), and two transactions exist:
#   A — tagged DIRECTLY to Food
#   B — tagged to Food's SUBCATEGORY
curl -i -X PATCH http://localhost:8080/api/v1/categories/<foodId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Food & Drink" }'
```

**UPDATE 1 — rows tagged to the renamed row itself.** Re-read **A**:
`categoryName` is now `"Food & Drink"`. ⚠ **This inverts the assertion §13.1
used to make** (see the banner there): it used to require the OLD name.

**UPDATE 2 — rows tagged to the renamed row's CHILDREN.** Re-read **B**:
`parentCategoryName` is now `"Food & Drink"`, while `categoryName` is still the
leaf's own name (`"Lunch"` / `"Snacks"`) — **never a composed path**.

**Why UPDATE 2 is not optional, stated as the failure it prevents:** a
transaction tagged to `Food › Lunch` carries *Lunch's* id in `categoryId`, so
renaming `Food` matches **zero** rows in UPDATE 1. Without the second statement
that row renders `OldFoodName › Lunch` — a stale parent beside a correct leaf,
in one string, which reads as data corruption rather than as a missed
propagation.

```sql
SELECT category_name, parent_category_name, version, updated_at
FROM transactions WHERE id IN ('<A>', '<B>');
-- A: 'Food & Drink' | NULL           | version unchanged
-- B: 'Lunch'        | 'Food & Drink' | version unchanged
```

**Three precisions that are easy to get wrong, each worth its own check:**

- **An icon- or glyph-only change must NOT trigger UPDATE 2.** `PATCH` Food
  with `{"iconName": "restaurant-outline"}` only: **A**'s
  `categoryIconName` follows (UPDATE 1 carries all three display values), while
  **B**'s `parentCategoryName` is **untouched**. There is no
  `parent_category_icon_name` column, so only the parent's *name* is
  snapshotted — the code gates UPDATE 2 on `nameChanged` alone.
- **Renaming a SUBCATEGORY runs UPDATE 1 only.** A subcategory can have no
  children, so the resolved child set is empty — structural, not a filter, and
  it costs no query.
- **A cap-only change propagates nothing.** `PATCH {"monthlyCap": 2000}`
  must leave every transaction's `updated_at` alone: no snapshot value depends
  on a cap, and bumping the sync cursor for it would hand every offline client a
  pile of rows to re-pull for nothing. Re-submitting a category's **own current
  name** is the same no-op for the same reason.

**Income rows are never touched, and no `type` filter does it.** Re-read the
income transaction from §13.2 after every rename and delete above: `categoryId`
is still `null` and the five values are still
`Income`/`cash-outline`/`I`/`success`/`null`. Both UPDATEs key on `category_id`,
which is `NULL` on every income row, so **neither can match one** — a
`WHERE type <> 'income'` clause would merely *look* like it protects income and
would be the first thing a future reader could weaken. There is no such clause
to weaken.

**`updated_at` IS bumped; `version` is NOT.** `updated_at` is the sync cursor,
so without it the rename would reach **no offline client** through `/sync/pull`
until some unrelated edit happened to touch each row — i.e. the feature would
silently not work on the one platform this app is built for. `version` guards
*client-authored* edits (`409 VERSION_CONFLICT`), and all five snapshot values
are server-authoritative and never request fields, so there is nothing for a
client to re-fetch and bumping it would reject a user's unrelated in-flight edit
— real lost work, to protect a value the client cannot send.

#### 12.10.6 Implementation notes

- **`updated_at` is set EXPLICITLY in all three bulk statements, and that is the
  single most important line in this change.** A bulk JPQL `UPDATE` bypasses the
  persistence context entirely, so `@UpdateTimestamp` never runs — and
  `V7__transactions.sql`'s own contract records that the database maintains
  neither `updated_at` nor `version`. One `OffsetDateTime.now(ZoneOffset.UTC)`
  is captured per request and passed to both rename statements, so the rows they
  touch share one cursor position for one logical event.
- **The three statements, in full** (`TransactionRepository`, JPQL, every value
  a bound parameter — no native SQL, no concatenation anywhere):

  ```
  UPDATE 1 (rename)     set categoryName, categoryIconName, categoryGlyph, updatedAt
                        where userId = :userId and categoryId = :categoryId

  UPDATE 2 (rename)     set parentCategoryName, updatedAt
                        where userId = :userId and categoryId in :subcategoryIds

  Reassignment (delete) set categoryId, categoryName, parentCategoryName = null,
                            categoryIconName, categoryGlyph, updatedAt
                        where userId = :userId and categoryId in :categoryIds
  ```

  Note what is in **none** of them: `version`, `categoryTone`, and any mention
  of `type`.
- **One UPDATE on delete, two on rename, and the asymmetry has a reason.** The
  reassignment target is a single top-level row, so every affected transaction
  ends up with the same four values and a `NULL` parent whatever level it was
  tagged at. The rename case changes *different columns* on *different row
  sets*, which one statement cannot express.
- **Both bulk writes are scoped by `user_id` as defence in depth.** It cannot
  change the result — a category is owner-scoped and both endpoints have already
  `404`ed on a row the caller does not own — but a bulk `UPDATE` on a financial
  table is exactly where an unscoped `WHERE` is most expensive to get wrong.
- **Soft-deleted transactions ARE reassigned and ARE propagated to, while the
  usage count EXCLUDES them.** The asymmetry is deliberate, not an oversight:
  §3.5's number describes what the *user* will see change (and a soft-deleted
  row appears in no read), while the writes must cover every row that references
  the dying category — otherwise `ON DELETE SET NULL` would quietly null it and
  leave a snapshot naming a category that no longer exists. **Consequence worth
  knowing: `reassignedTransactionCount` can legitimately exceed the pre-flight's
  `transactionCount`.** The pre-flight is explicitly advisory.
- **`CategoryService` injects `TransactionRepository`.** These are
  category-domain business rules that happen to write denormalized columns on
  another table; routing them through `TransactionService` would add three
  pass-through methods carrying no logic of their own while coupling two
  services. Constitution §5 allows a business-layer class to use more than one
  repository; it does not ask for a service-to-service hop.
- **The rollback trap (§3, points 3 and 4) was checked on the delete path
  specifically**, because it is the first method in this domain that *writes
  before it could throw*. Both of its user-facing errors —
  `404 CATEGORY_NOT_FOUND` and `400 CATEGORY_PROTECTED` — plus the `Misc`
  resolution are decided **before** the reassigning `UPDATE`. After that write
  it can still throw, but only `IllegalStateException` on a broken invariant
  (a `DELETE` affecting a different number of rows than were resolved), and
  **there a rollback is exactly what must happen**: a half-finished cascade
  would leave transactions pointing at `Misc` while their category still exists.
  So there is still **no `noRollbackFor` anywhere in this domain**, and adding
  one would be the bug rather than the fix.
- **Constraint-name matching: full names, never the shared prefix, and
  null-safe.** `V8` adds a fourth `uq_categories_user_*` name
  (`uq_categories_user_protected`) alongside `uq_categories_user_id_id` and the
  two name indexes, and only the two name indexes mean "duplicate name".
  `CategoryService.UNIQUE_NAME_CONSTRAINTS` lists those two full strings and
  neither is a substring of the other two names in either direction. `V8` also
  adds **three more `RAISE` paths with a NULL constraint name** (the protection
  trigger), which the existing null guard in `isUniqueNameViolation` already
  survives — that guard was written generally rather than special-cased for
  `V6`'s depth trigger, which is why it needed no change.
- **Injection hardening.** Every query added here is JPQL or a derived method
  with bound, typed parameters, including the `in :ids` collections. Nothing
  from client input becomes a field name, a table name or a SQL fragment, and
  neither new endpoint takes a query parameter at all.
- **Rate limiting.** Both new endpoints sit on the **default per-user tier** and
  needed nothing: `ApiRateLimitFilter` keys off the `/api/v1/` prefix and
  excludes only `/api/v1/auth/`, and `SecurityConfig`'s
  `/api/v1/categories/**` matcher is method-agnostic so the `DELETE` is
  authenticated like the rest. **No second mechanism was added**, and neither
  endpoint warrants a stricter tier.
- **Logging.** Ids and counts only: the delete logs
  `reassignedTransactions`/`deletedSubcategories`, the propagation logs
  `nameChanged` plus both row counts (sync status is an explicitly allowed
  category, constitution §23). **No category names and no amounts** — a spending
  limit and a transaction amount are personal financial information.

#### 12.10.7 Key assumptions — ADR 0021

- **Soft-deleted transactions are reassigned and propagated to; the usage count
  excludes them.** The ADR states the exclusion for §3.5 and says nothing either
  way for §3.4. This implementation took the broader reading for the writes,
  because the alternative leaves rows that `ON DELETE SET NULL` silently nulls
  (and ADR 0022's statistics query explicitly relies on "§3.4 reassigns on
  delete rather than nulling" being true of the whole table). **Flagged for the
  System Architect** — if the counts must agree exactly, the fix is one
  `deletedAt is null` clause in three statements, and it trades correctness of
  the data for tidiness of the number.
- **A `name` key with a non-null value on the protected row is refused even when
  it is identical to the stored name.** §3.3 says "a request carrying `name`
  … is `400 CATEGORY_PROTECTED`", so this follows the contract's wording rather
  than the trigger's behaviour (the trigger only fires on an actual change). The
  practical effect is the clearer client rule: *do not send `name` for a
  protected row.*
- **A cap-only change (and a no-op rename) propagates nothing.** The ADR does
  not spell this out. The reasoning is `updated_at`: it is the sync cursor, so
  touching transaction rows for a change no snapshot value depends on would be
  pure noise for every offline client.
- **`IllegalStateException` → `500`, with no new exception type**, for both an
  absent protected row and a delete-count mismatch. The ADR calls the first one
  "a broken invariant and a `500` is the honest answer"; a dedicated
  `ApiException` subclass would imply a client-facing meaning these have none of.
- **`DELETE` takes no request body and no query parameters**, and the
  pre-flight's number is never sent back. There is no two-phase delete in the
  contract and this invents none.
- **`deletedSubcategoryCount` is reported from the resolved id set's size**, not
  from the `DELETE`'s affected-row count — they are asserted equal, so the two
  can never disagree; the assertion is what makes the report truthful rather
  than optimistic.
- **The `Misc` row may receive subcategories, and nothing here prevents it**
  (ADR 0021 §2.1 says it is otherwise an ordinary category). Deleting such a
  child reassigns its transactions to `Misc` — i.e. to its own parent — which is
  the one case where the "never to the surviving parent" rule and the "always to
  `Misc`" rule coincide. Harmless, and recorded so it is not re-litigated.

#### 12.10.8 Not verified in the session that wrote this

**No shell access, so: not compiled, not run, no live request issued.** The
statically-unverifiable items, in rough order of risk:

1. **That `V8` has been applied at all.** It was written but **not yet applied**
   when this code was written. With `ddl-auto=validate`, an unapplied `V8` is a
   **boot failure** on the unmapped `is_protected` column — loud, not subtle.
   A `V8` applied *without* this code is the more dangerous direction: new
   registrations would seed only 7 rows and every delete would `500`.
2. **That Spring Data derives
   `findByUserIdAndProtectedCategoryIsTrue`** without a
   `PropertyReferenceException` at startup. The property is
   `Category.protectedCategory` (`protected` being a Java keyword) and the
   keyword is `IsTrue`. It fails **at boot** if wrong, not at request time.
3. **That the three `@Modifying` JPQL statements parse and bind.** `@Query` JPQL
   is validated when the context starts, so a mistake is again a boot failure.
   The genuinely new parts are `set t.parentCategoryName = null` (a literal null
   in a bulk `SET`) and `in :collection` in a bulk `UPDATE`.
4. **That the bulk `UPDATE`s' affected-row counts are what `int` returns** —
   i.e. that `reassignedTransactionCount` is the real number of rows and not,
   say, `-1` or a batch artefact. Reasoned, not run.
5. **That `clearAutomatically` is genuinely unnecessary on the three
   `TransactionRepository` statements.** It is set on
   `CategoryRepository#deleteByUserIdAndIdIn` (where stale managed instances of
   deleted rows would otherwise be flushed at commit) but deliberately **not**
   on the transaction writes, because no `Transaction` entity is ever loaded in
   this domain's persistence context and clearing it would detach the
   `Category` the response is built from. **This is a latent trap for whoever
   next adds a transaction read to these flows** — if you do, add
   `clearAutomatically = true` or read before writing.
6. **That the propagation and the reassignment really do leave `version`
   untouched in the database**, not merely in the JPQL. Nothing increments it,
   but only a live `SELECT version` proves it.
7. **That `@JsonProperty("isProtected")` serializes as `isProtected`** rather
   than `protected`, the same wrinkle `isDefault` already has — and that adding
   a record component did not reorder the JSON in a way a client notices (it
   should not; no client reads by position).
8. **That the Postman collection's JSON parses** and that requests 84+ chain
   their variables correctly (`miscCategoryId` from request 84, and the
   fixtures each request creates for the next).
9. **Concurrency, which cannot be exercised by hand:** two simultaneous deletes
   of the same category, and a child created by another device between the id
   resolution and the cascade. The first should give one `200` and one `404`;
   the second should fail loudly on the self-FK and roll back.

#### 12.10.9 Not this agent's half

- **`/database`** — `V8__categories_misc_fallback.sql` is
  Database-Architect-owned and was written in parallel with this change;
  nothing here edits it. Its one open flag (**account deletion now has to get
  past `trg_categories_enforce_protection`**) is for the System Architect, not
  for this domain.
- **`/frontend`** — the delete affordance and its `ConfirmationDialog`, the
  pre-flight call with the `transactionCount > 0` copy switch (**and the
  fail-closed fallback when the pre-flight errors**), hiding delete/rename on
  `isProtected: true` rows (**read the field, never match the name `Misc`**),
  invalidating the transactions cache after a delete, and — the easiest one to
  forget — **re-fetching after a RENAME, which now changes transaction rows for
  the first time**. All Frontend-Engineer-owned, landing with Domain 3's
  outstanding wiring step.
- **`/docs`** — `api-overview.md` §3.4/§3.5's Status cells read `Not started`;
  once the Project Owner's testing pass confirms this round, they are the System
  Architect's to flip.

> **SUPERSEDED IN PART 2026-11-03 — see §12.11.** The delete in §12.10 is now a
> SOFT delete. Item 9's "fail loudly on the self-FK" no longer applies: the
> concurrent-child case is now serialized by row locks instead.

### 12.11 ADR 0024 (2026-11-03) — categories are soft-deleted, never hard-deleted

`docs/decisions/0024-no-hard-delete-soft-delete-everywhere.md`. Project Owner
ruling: *"there should be no hard delete on anything, if user delete anything
user should not be able to view that but it should be saved in the DB"*. This
reverses ADR 0021 §2.7's hard delete on purpose; it is not a bug fix.

**COUPLED to `database/migrations/V15__categories_soft_delete.sql` — ship in the
same restart.** After V15, the old hard-delete code is refused by the widened
`trg_categories_enforce_protection` (a `500`). Before V15, this code fails
`ddl-auto=validate` (unmapped `categories.deleted_at` and the two
`reassigned_from_category_id` columns).

**What changed:**

1. **`DELETE /api/v1/categories/{id}` is a soft delete.** Request, response
   (`reassignedTransactionCount`, `deletedSubcategoryCount`), errors, warning
   copy and §3.5 pre-flight are unchanged. One transaction:
   lock the target `FOR UPDATE` (live only) → refuse the protected row (`400`) →
   resolve `Misc` → lock the live children `FOR UPDATE` → reassign
   `transactions` → **reassign the caller's `split_expenses`** (new, ADR 0024
   §4.8) → stamp `deleted_at` + `updated_at` with **one shared instant** on the
   children, then the target, counts verified → post-condition: zero live
   children left. `CategoryRepository#deleteByUserIdAndIdIn` is **removed**;
   the soft delete is `CategoryRepository#stampDeletedAt`.
2. **Restore marker.** Both reassignment UPDATEs write
   `reassigned_from_category_id` = the row's prior `category_id`.
   `PATCH /transactions/{id}` clears it when it actually changes `category_id`.
   It is never in any response. Split expenses have no PATCH, so nothing clears
   theirs yet.
3. **Every category read is live-only** (ADR 0024 §4.2): every derived
   `CategoryRepository` method now carries `DeletedAtIsNull` (including all four
   `existsBy...NameIgnoreCase...` pre-checks and the protected-row lookup), and
   every JPQL clause over `Category` carries `c.deletedAt is null`
   (`findSubcategoryIds`, both halves of `TransactionRepository#findFiltered`,
   `aggregateSpendByCategory`). Consumers: `CategoryService`,
   `CategorySnapshotResolver`, `BudgetService#resolveCaps`, `StatisticsService`.
   A deleted category is a `404` everywhere and its name is reusable at once.
4. **Locks (ADR 0024 §4.4).** Subcategory create reads its parent
   `FOR SHARE` (required). Also taken, as recommended: transaction create/patch
   and split-expense create share-lock their leaf category
   (`CategorySnapshotResolver#lockLiveLeaf`), budget-cap resolution share-locks
   the capped categories, and `PATCH /categories/{id}` locks its row
   `FOR UPDATE` (otherwise its entity save could write `deleted_at = NULL` back
   over a concurrent delete).
5. **Budget caps.** The stored `category_id` is never nulled. The read
   (`BudgetPeriodCategoryCapRepository#findCapRowsByBudgetPeriodId`) left-joins
   `categories` on `id` **and `deleted_at IS NULL`** and returns that `c.id`, so
   the API still says `categoryId: null` for a deleted category. `categoryName`
   always comes from the cap row. Capping a deleted id is `404`.
6. **Constraint names.** The three unique-index names are unchanged, so the
   `409 CATEGORY_NAME_ALREADY_EXISTS` mapping is unchanged.
   `chk_categories_protected_not_deleted`,
   `fk_transactions_reassigned_from_category_id` and
   `fk_split_expenses_reassigned_from_category_id` are matched by no translator
   (none of the matched full names is a substring of them) and reach
   `GlobalExceptionHandler`'s catch-all as a logged `500`. The trigger's DELETE
   refusal has a null constraint name; every matcher is null-safe.

**Manual checks** (Postman folder "Categories — soft delete (ADR 0024)"):

```bash
# delete Food, then re-create it -> 201 (the name is free again)
curl -s -X DELETE "http://localhost:8080/api/v1/categories/$FOOD_ID" -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:8080/api/v1/categories -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"Food","iconName":"fast-food-outline","glyph":"F"}'
# the second delete of the OLD id -> 404 CATEGORY_NOT_FOUND
curl -s -X DELETE "http://localhost:8080/api/v1/categories/$FOOD_ID" -H "Authorization: Bearer $TOKEN"
# PATCH / usage on the old id -> 404; tagging a transaction to it -> 404; capping it -> 404
```

```sql
-- the row is still there, stamped; children share the parent's instant
SELECT id, parent_category_id, deleted_at, updated_at
FROM categories WHERE user_id = '<user>' AND deleted_at IS NOT NULL ORDER BY deleted_at, id;
-- reassigned rows carry the marker
SELECT id, category_id, reassigned_from_category_id FROM transactions
WHERE user_id = '<user>' AND reassigned_from_category_id IS NOT NULL;
SELECT id, category_id, reassigned_from_category_id FROM split_expenses
WHERE created_by_user_id = '<user>' AND reassigned_from_category_id IS NOT NULL;
-- a saved cap keeps its stored link
SELECT category_id, category_name FROM budget_period_category_caps WHERE budget_period_id = '<period>';
```

**Accepted cost, recorded:** a `PATCH /transactions/{id}` that holds its row lock
and then share-locks a category, racing a delete of that category that holds
the category lock and then needs the transaction row, deadlocks. PostgreSQL
aborts one (`40P01`, logged `500`, nothing written). The same shape exists for a
child `PATCH`/delete racing its parent's delete (V6's depth trigger share-locks
the parent). Both need two devices acting in the same instant; the alternative
was a row silently left on a hidden category.

---

## 13. Domain 4 — Transactions

Five endpoints under `/api/v1/transactions`, implemented exactly to
`docs/api/api-overview.md` §4.1–§4.5. Backed by the `transactions` table from
`V7__transactions.sql` (`data-model.md` §2.2).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/transactions` | **Paginated**, filterable list |
| POST | `/api/v1/transactions` | Create one (`201`) |
| GET | `/api/v1/transactions/{id}` | One transaction, + premium payment-method enrichment |
| PATCH | `/api/v1/transactions/{id}` | Partial update; `version` required |
| DELETE | `/api/v1/transactions/{id}` | **Soft** delete (`204`) |

**All five require `Authorization: Bearer <accessToken>`** and follow Domains
2–3's rules unchanged: the caller comes from `@CurrentUserId` only (§11.1),
every query is filtered by that id, and the default per-user rate-limit tier
applies automatically (§6 — **no second mechanism was added**).

**`api-overview.md` §4's table lists a sixth endpoint,
`POST /receipts/upload-signature`. It is deliberately NOT implemented** — see
§13.9. The `receipt_public_id` column and the `receiptPublicId` request/response
field **are** implemented, including their server-side claim check.

> **AMENDED 2026-11-03 — the group-membership check on `POST`/`PATCH` is now
> real.** Both endpoints used to answer `403 NOT_GROUP_MEMBER` for *every*
> `scope='group'` request, a genuine member's included, because `group_members`
> did not exist when this domain was built. That was a reported bug. The check
> now resolves `group_members` per request. **The code stays `403`** and an
> unknown group gets that same `403`. Test matrix in §13.6(h), reasoning in
> §13.10, the closed follow-up in §15.8, Postman requests 216–225.

Get a token first exactly as in §11.2; every call below uses it as `$TOKEN`.
**Use an account registered after 2026-10-25** so its 8 seeded categories
exist, including the protected `Misc` (§12.1) — every expense needs a category,
and every category *delete* needs `Misc`.

### 13.1 Create a transaction (§4.2)

```bash
curl -i -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Lunch at Saravana",
    "categoryId": "<a categoryId from GET /categories>",
    "txnDate": "2026-10-24",
    "txnTime": "13:45",
    "amount": 250.00,
    "type": "expense",
    "scope": "personal",
    "paymentMode": "cash"
  }'
```

Expect `201` with a `TransactionResponse`. The fields to check are the ones
the server filled in rather than the ones you sent:

- `categoryName` / `categoryIconName` / `categoryGlyph` match the category row
  you named, **snapshotted** — not looked up at read time;
- `parentCategoryName` is `null` (that category is top-level);
- `categoryTone` is `"neutral"`;
- `version` is `1`;
- `txnTime` reads back exactly `"13:45"`, not `"13:45:00"`;
- `groupId`, `splitExpenseId`, `notes`, `receiptPublicId`, `cashAmount`,
  `onlineAmount`, `clientId` are all **present and `null`** (the uniform
  key-set convention), and `paymentMethodDisplay`/`paymentMethodUpiId` are
  **absent entirely** — they exist only on §4.3.

Verify in the database:

```sql
SELECT id, title, category_id, category_name, parent_category_name,
       category_icon_name, category_glyph, category_tone, txn_date, txn_time,
       amount, type, scope, group_id, payment_mode, cash_amount, online_amount,
       notes, receipt_public_id, client_id, version, deleted_at,
       created_at, updated_at
FROM transactions WHERE user_id = '<the id from /users/me>';
```

`version = 1`, `deleted_at IS NULL`, `created_at`/`updated_at` both set (the
response must not contain `null` timestamps — that was a real Domain 1 bug,
§3 point 5), and `category_tone = 'neutral'`.

**Now rename that category and re-read the transaction.** This is the single
most important check in this domain:

```bash
curl -i -X PATCH http://localhost:8080/api/v1/categories/<categoryId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Food & Drink" }'
```

> **⚠ THIS ASSERTION WAS INVERTED ON 2026-10-25 — read it carefully if you
> remember the old one.** It used to read *"the transaction's `categoryName`
> must **still say the old name**"*, on the reasoning that renaming a category
> must never rewrite financial history (`data-model.md` §2.2). **The Project
> Owner reversed that ruling** (`docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md`
> §1, §1.6 — "one class of assertion is now INVERTED").

The transaction's `categoryName` must now say **the NEW name** — `Food &
Drink`. A rename **propagates** to that category's transactions, in the same
transaction as the category row's own update (§12.10). `updatedAt` on the
transaction advances; **`version` does not**.

**What did *not* change, and is still worth asserting here:** no read path
joins `categories` — the propagation is an `UPDATE` on *write*, so the five
snapshot columns still exist and `GET /transactions` still renders with no
join. If you want to see the snapshot doing its other job, delete a category
instead (§12.10): the row keeps rendering, as `Misc`. And an **income** row's
five values never change, whatever happens to any category.

### 13.2 Income — the ADR 0018 path (§4.2)

```bash
curl -i -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "October salary",
    "txnDate": "2026-10-01",
    "txnTime": "09:00",
    "amount": 85000.00,
    "type": "income",
    "scope": "personal",
    "paymentMode": "online"
  }'
```

Expect `201` with **no `categoryId` sent and none stored**:
`categoryId: null`, `categoryName: "Income"`,
`categoryIconName: "cash-outline"`, `categoryGlyph: "I"`,
`categoryTone: "success"`, `parentCategoryName: null`.

```sql
SELECT category_id, category_name, category_icon_name, category_glyph,
       category_tone, parent_category_name
FROM transactions WHERE type = 'income' AND user_id = '<id>';
-- NULL | Income | cash-outline | I | success | NULL
```

Those five values come from `service/IncomeCategorySnapshot` —
**written during Domain 3 with no consumer until now**, and this is it. There
is no `Income` category row anywhere and nothing resolves a category by name,
so the test that proves the model is right is: create your own expense category
literally named `Income`, then create an income transaction. The `categoryId`
stays `null` and your category is untouched (ADR 0018 §5 — a correct
consequence, not a gap).

**Sending a `categoryId` with `type: "income"` is a `400 VALIDATION_ERROR`**,
not a silently ignored field:

```bash
curl -i -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Bad income", "categoryId": "<any categoryId>",
        "txnDate": "2026-10-01", "txnTime": "09:00", "amount": 100,
        "type": "income", "scope": "personal", "paymentMode": "cash" }'
```

Also worth confirming: the four snapshot fields are **never** request fields.
Send `"categoryName": "Hacked"`, `"categoryTone": "negative"` — both are
ignored (unknown fields, §11.8) and the stored values are the server's own.

### 13.3 Subcategories and the roll-up filter (§4.1)

Create a subcategory under `Food` (§12.2's request 32 shape), then tag a
transaction to **the subcategory's id**:

```bash
curl -i -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Chips", "categoryId": "<the SUBcategory id>",
        "txnDate": "2026-10-24", "txnTime": "17:00", "amount": 40,
        "type": "expense", "scope": "personal", "paymentMode": "cash" }'
```

`categoryId` holds **the leaf** (the subcategory), `categoryName` is the
subcategory's own name — **never a composed path like `Food › Snacks`** — and
`parentCategoryName` is `"Food"`. The client composes the path at render time;
freezing a separator into history would make every past row wrong the moment
the UI changed it.

**Now the roll-up.** With one transaction on `Food` and one on `Food › Snacks`:

```bash
# the PARENT's id must return BOTH
curl -i "http://localhost:8080/api/v1/transactions?categoryId=<FOOD id>" \
  -H "Authorization: Bearer $TOKEN"

# the SUBcategory's id must return only its own one
curl -i "http://localhost:8080/api/v1/transactions?categoryId=<SUBcategory id>" \
  -H "Authorization: Bearer $TOKEN"
```

`totalElements` is `2` then `1`. That asymmetry is the whole behaviour
(ADR 0019 §5): an exact-match-only reading would make "Food spending" silently
exclude `Food › Snacks`.

Three more roll-up checks:

1. **`categoryId` never matches income** — filter by any category id and
   confirm the income row from §13.2 is absent. Income has
   `category_id = NULL`; `type=income` is the filter for that.
2. **Another account's category id returns an empty page, not a `404`** —
   register a second account, then filter the first account's list by the
   second's category id. `totalElements: 0`, `content: []`. A `404` would
   confirm to a non-owner that the id is real
   (`security-architecture.md` §2), and §4.1's contract defines no error for
   this parameter. A random non-existent UUID behaves identically.
3. **One query, no N+1** — turn on `spring.jpa.show-sql=true` locally if you
   want to see it: a page of 20 rows issues the page query plus its count
   query and **nothing per row**. The roll-up is a subquery inside the same
   statement, and no read path in this domain joins `categories` at all.

### 13.4 List, filters and pagination (§4.1)

```bash
curl -i "http://localhost:8080/api/v1/transactions?page=0&size=2" \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` with a **`PageResponse`** — exactly five keys: `content`, `page`,
`size`, `totalElements`, `totalPages`. **Not** Spring Data's own `Page` shape:
if you see `pageable`, `sort`, `first`, `last` or `numberOfElements`, a `Page`
is being serialized directly and that is a bug (`dto/response/PageResponse`).

Things to check:

- **Ordering is newest-first and total**: `txn_date desc, txn_time desc,
  created_at desc, id desc`. Create three transactions on the same date and
  time and page through them with `size=1` — **no row may appear on two pages
  and none may be skipped.** The contract specifies no order, so this is
  derived (§13.8); the `id` tie-break is what makes it stable.
- **Filters**: `?type=income`, `?type=expense`, `?scope=personal`,
  `?dateFrom=2026-10-01&dateTo=2026-10-31`. Both dates are **inclusive** —
  create a row exactly on `dateFrom` and confirm it is included.
- `?dateFrom=2026-12-01&dateTo=2026-01-01` (reversed) is a legal, empty range,
  **not** a `400`.
- `?scope=group` is accepted and returns nothing — no group transaction can
  exist (§13.6).
- **Soft-deleted rows are absent** — see §13.5.
- **Validation**: `?size=0`, `?size=101`, `?page=-1`, `?type=Expense`
  (capitalised — the vocabulary is exactly lowercase), `?scope=team`,
  `?dateFrom=24-10-2026`, `?categoryId=not-a-uuid` each expect
  `400 VALIDATION_ERROR` with `fieldErrors` naming the parameter. **These used
  to be `500`s** — `GlobalExceptionHandler` gained a `BindException` handler
  with this domain (§13.7), and it is API-wide.
- **`size` is capped at 100.** `?size=100000` is a `400`, not a full table
  scan. Derived — the contract gives a default but no maximum (§13.8).

### 13.5 Soft delete (§4.5)

```bash
curl -i -X DELETE http://localhost:8080/api/v1/transactions/<id> \
  -H "Authorization: Bearer $TOKEN"
```

Expect `204` with no body. Then:

```sql
SELECT id, deleted_at, version, updated_at
FROM transactions WHERE id = '<id>';
```

**The row is still there** with `deleted_at` set — it is not removed
(constitution §14: offline clients need deletes to *propagate* through
`/sync/pull`, not vanish). `updated_at` advanced; `version` did **not** change
(§13.8 explains why that is deliberate).

Now confirm it is gone from every read: `GET /transactions/{id}` → `404
TRANSACTION_NOT_FOUND`; `GET /transactions` → `totalElements` dropped by one;
`PATCH` it → `404`; `DELETE` it **again** → `404`, not `204`. The second
delete is not idempotent, and that follows from the contract: §4.5 lists `404`
as its only error and §4 excludes deleted rows from reads, so there is no row
left to address.

**The receipt reference survives a soft delete, deliberately** — the row still
points at the asset, so the Cloudinary object is not destroyed and its
uniqueness slot stays taken (ADR 0020 §9). Confirm:
`SELECT receipt_public_id FROM transactions WHERE id = '<the deleted id>'` is
unchanged, and claiming that same `receiptPublicId` on a new transaction is
still `409 RECEIPT_ALREADY_ATTACHED`.

### 13.6 Update, and the rules worth testing one at a time (§4.4)

```bash
curl -i -X PATCH http://localhost:8080/api/v1/transactions/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "version": 1, "title": "Lunch at Saravana Bhavan" }'
```

Expect `200`, `version: 2`, `updated_at` advanced, `created_at` unchanged, and
**every other column untouched**.

**(a) Optimistic concurrency.** Re-send the *same* request (still
`"version": 1`) → `409 VERSION_CONFLICT`, and **nothing changed in the
database** — the check happens before any mutation. Then send `"version": 2` →
`200`, `version: 3`. Omitting `version` entirely is `400 VALIDATION_ERROR`
naming the field; it must never be read as `0`.

**(b) `notes` and `receiptPublicId` — absent vs. explicit `null`.** The one
behaviour to test carefully, and the same three states §12.3 verified for
`monthlyCap`:

```bash
# set a note
-d '{ "version": 3, "notes": "split with Rahul, settled in cash" }'
# leave it alone — the key is simply absent
-d '{ "version": 4, "title": "Lunch" }'
# clear it — an explicit null is a real instruction
-d '{ "version": 5, "notes": null }'
```

After step 2 `notes` is **unchanged**; after step 3 it is `NULL`. These two
must not behave the same way — that distinction is the whole reason
`UpdateTransactionRequest` is a class rather than a record, and the mechanism is
copied from `UpdateUserRequest`/`UpdateCategoryRequest` rather than reinvented
(§11.7, §12.4). Sending `{"version": N}` alone is a valid `200` that changes
nothing but the version.

**(c) The two `type` transitions** (ADR 0018 §3.3 — the case that leaves a row
nothing can render if it is got wrong):

```bash
# expense -> income: server nulls categoryId and overwrites all five snapshot values
-d '{ "version": 6, "type": "income" }'
# ...and a categoryId in the same request is a 400
-d '{ "version": 7, "type": "income", "categoryId": "<any>" }'
# income -> expense: categoryId becomes REQUIRED in that same request
-d '{ "version": 7, "type": "expense" }'                      # 400
-d '{ "version": 7, "type": "expense", "categoryId": "<id>" }' # 200
```

After the first, `category_id IS NULL`, `category_name = 'Income'`,
`category_tone = 'success'`, `parent_category_name IS NULL`. After the last,
all five come from the resolved category and `category_tone = 'neutral'`.

**(d) A `type`-preserving patch must NOT touch the snapshot.** Tag a
transaction to a *subcategory*, then patch only its `amount`. `category_id`,
`category_name` and `parent_category_name` are all unchanged — which is what
makes editing a transaction without opening the category picker preserve the
subcategory assignment. Then patch `categoryId` to a **top-level** category and
confirm `parent_category_name` is reset to `NULL` (all five are re-derived
together, never partially).

**(e) Payment mode arithmetic** (`security-architecture.md` §3 — the client's
identical check is UX only):

```bash
# a valid 'both'
-d '{ "version": 9, "paymentMode": "both", "amount": 250.00,
      "cashAmount": 100.00, "onlineAmount": 150.00 }'          # 200
# the sum rule, re-validated server-side
-d '{ "version": 10, "paymentMode": "both", "amount": 250.00,
      "cashAmount": 100.00, "onlineAmount": 149.99 }'          # 400
# patching amount ALONE on a 'both' row is a 400 - the stored portions no
# longer add up, and the server will not guess how to redistribute money
-d '{ "version": 10, "amount": 300.00 }'                       # 400
# switching away from 'both' CLEARS both portions, with no need to null them
-d '{ "version": 10, "paymentMode": "cash" }'                  # 200
# ...but stating a portion alongside a single mode is contradictory
-d '{ "version": 11, "paymentMode": "cash", "cashAmount": 50 }' # 400
```

After the clear, `cash_amount IS NULL AND online_amount IS NULL`. An explicit
`"cashAmount": null` with a single mode is fine, so a client that always sends
every key is unaffected. `"amount": 10.005` (three decimal places) is a `400`
— the sub-paise guard.

**(f) `txnTime` is frozen.** Send `{"version": N, "txnTime": "23:59"}` →
`200`, and `txn_time` is **unchanged**. There is no `txnTime` field on the
request DTO, the column is mapped `updatable = false`, and no code path writes
it — so the key is ignored exactly as any unknown field is. The refusal is
structural, not a check.

**(g) Ownership and malformed ids.** Register a second account and `GET`,
`PATCH` and `DELETE` the first account's transaction id with the second's
token: all three expect `404 TRANSACTION_NOT_FOUND`, **never a `403`**, and
identical to the response for a random non-existent UUID (a 403 would confirm
the id is real). `GET /api/v1/transactions/not-a-uuid` → `400`. No
`Authorization` header → `401 UNAUTHORIZED`.

**(h) Group scope — the membership check is REAL as of 2026-11-03.** It used to
reject every group-scoped write; see §13.10's bullet for the incident and
§15.8 for the follow-up it closed. Four cases, all on `POST` and all repeating
identically on `PATCH`:

| Request | Expect |
|---|---|
| `scope: "group"`, no `groupId` | `400 VALIDATION_ERROR` |
| `groupId` with `scope: "personal"` | `400 VALIDATION_ERROR` |
| `scope: "group"` + a `groupId` the caller **is a member of** | `201` with `groupId` echoed back and the row stored |
| `scope: "group"` + a group the caller is not in, **or a group id that does not exist at all** | `403 NOT_GROUP_MEMBER`, byte-identically |

The last row is the one to read twice. **`403` is deliberate and must not be
"fixed" to §7's `404 GROUP_NOT_FOUND`** — §4.2's error table assigns this
endpoint `403` explicitly and `V10`'s contract item 1 re-confirms the
divergence as approved. **An unknown group gets that same `403`, not a `404`,**
for two reasons that agree: §4.2's error table has no `GROUP_NOT_FOUND` row at
all, so a `404` would be inventing a code; and one query
(`existsByGroupIdAndUserId`) answers both halves, so the service never learns
which case it was and cannot leak the difference. Diff the two response bodies
field by field — they must be indistinguishable.

Only **registered** membership counts. A `group_members` row with
`invited_contact_id` set is an unregistered placeholder with no account, so it
can never be the caller; create a group containing an unlinked contact and
confirm the contact's presence grants nothing.

DB checks:

```sql
-- the member's row really landed, with scope and group_id agreeing
SELECT id, scope, group_id FROM transactions WHERE group_id IS NOT NULL;

-- and every one of them points at a group its own owner is actually in
SELECT t.id
  FROM transactions t
 WHERE t.group_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM group_members m
                    WHERE m.group_id = t.group_id AND m.user_id = t.user_id);
-- -> zero rows. A row here means the gate was bypassed.
```

### 13.7 Single read + the premium enrichment (§4.3)

```bash
curl -i http://localhost:8080/api/v1/transactions/<id> \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` with the same base shape **plus `paymentMethodDisplay`** —
`"Cash"`, `"Online"` or `"Both"` on a free account. Flip premium on
(§11.6, `PATCH /users/me/premium`) and re-read an `online` transaction:
`paymentMethodDisplay` becomes `"Unified Payments Interface"`. A `cash` row is
identical either way (no online component to enrich) and a `both` row stays
`"Both"` (§13.8).

The gate is read from `users.is_premium` **server-side** — never from anything
the client sends (`security-architecture.md` §2). Confirm by flipping premium
off and re-reading: the field drops back to `"Online"`.

**`paymentMethodUpiId` is absent from every response, always** — see §13.8;
there is no column to source it from. **`receiptSignedUrl` is absent too** —
§13.9.

Also confirm `paymentMethodDisplay` is **absent** from `GET /transactions`'s
list rows and from the `POST`/`PATCH` responses. "Present only on this
single-resource endpoint" is the contract's wording and it is enforced by
field-level `@JsonInclude(NON_NULL)` on exactly those two components.

### 13.8 Implementation notes

- **Layering.** `TransactionController` is HTTP only.
  `TransactionService` holds the flow and the cross-field rules.
  Three collaborators keep it readable and keep one rule in one place:
  `CategorySnapshotResolver` (the whole income/expense rule, called from both
  write paths so §4.2 and §4.4 cannot diverge), `CategorySnapshot` (the six
  snapshot values as one value object with `applyTo`, so they are applied **all
  together or none** — a partial application is exactly the failure ADR 0018
  §3.3 warns about), and `ReceiptPublicIdPolicy` (the claim check and the one
  definition of the asset-path shape).
- **The five snapshot values are server-authoritative.** No request DTO carries
  `categoryName`, `parentCategoryName`, `categoryIconName`, `categoryGlyph` or
  `categoryTone`, and none may gain them (ADR 0018 §3.1, ADR 0019 §5).
  `categoryTone` is derived from `type` alone. The two tone literals live in
  exactly one place each: `"success"` in `service/IncomeCategorySnapshot`
  (untouched by this domain, as its own Javadoc permits) and `"neutral"` in
  `CategorySnapshot.EXPENSE_TONE`, the class that performs the derivation. What
  that Javadoc forbids — a second inline copy of either — does not happen.
- **No join to `categories` on any read path.** The snapshot columns are what
  render; that is the entire point of the denormalization. The only read that
  touches that table is the `categoryId` roll-up, as a subquery inside the
  single page query, plus one bounded parent-name lookup on a *write* when the
  chosen category has a parent.
- **Optimistic concurrency uses a plain column plus a row lock, not JPA
  `@Version`.** `Transaction#version`'s Javadoc records the full reasoning; in
  short, the contract pins the initial value at `1` and this project's
  assigned-id entities go through `merge` rather than `persist`
  (§3 point 5), which makes a `@Version` field's seed and merge behaviour
  something this session could not verify by running it. Instead: the write
  path fetches with `SELECT ... FOR UPDATE`
  (`findForUpdateByIdAndUserIdAndDeletedAtIsNull`), compares, and increments by
  one. The lock is what makes compare-then-increment atomic — without it two
  concurrent patches holding the same stale version would both pass and one
  would silently overwrite the other, which is the exact outcome `409
  VERSION_CONFLICT` exists to prevent.
- **A soft delete does not bump `version`.** The contract defines `version`
  purely as `PATCH`'s conflict check; `DELETE` takes no body, performs no check
  and returns no row, so a bump would be unobservable. What sync reads is
  `updated_at` (`security-architecture.md` §9's confirmed last-write-wins
  rule), and `@UpdateTimestamp` advances that. Inventing a second signal with
  no specified consumer was declined.
- **The application owns `version` *and* `updated_at`** — `V7` adds no trigger
  for either (Database Architect, 2026-10-24), consistent with V1–V6. Any
  future write path that bypasses the persistence layer (a bulk JPQL `UPDATE`,
  raw SQL) silently skips both, and `updated_at` is load-bearing for sync.
- **Partial-update semantics reuse Domain 2's mechanism; they do not invent a
  second one.** `UpdateTransactionRequest` is a class with `hasXxx()` presence
  flags for exactly the two fields that need three states (`notes`,
  `receiptPublicId`), copied from `UpdateUserRequest` as §11.7 instructs.
  Everything else needs only its value: fields backing `NOT NULL` columns treat
  an explicit `null` as omission (the same lenient rule as Domains 2–3), and
  `categoryId`'s own contract rule is written in terms of a *non-null* value,
  so absent and `null` are correctly identical there.
- **Pagination** (constitution §11) — this is the first genuinely unbounded
  list in the API, so it is the first `PageResponse`. `PageResponse` is a
  project DTO, not Spring Data's `Page`: serializing a `Page` directly would
  put Spring's own unstable internal shape on the wire, which the same rule
  that keeps JPA entities off the boundary forbids. **`size` is capped at
  100** — derived, since the contract gives a default but no maximum; an
  uncapped page size is a trivial way to make one request read a whole table.
- **Injection hardening** (`security-architecture.md` §12, which names *this
  endpoint's* filters as its own example). One fixed, developer-written JPQL
  query with every filter bound as a typed parameter; a `null` parameter
  disables its clause. No native SQL, no dynamically-built query, nothing from
  client input ever becoming a field or table name. **There is no `sort`
  parameter at all** — the contract defines none, so the `ORDER BY` is a
  literal in `TransactionRepository` and cannot be influenced from outside. If
  sorting is ever added it must map through a fixed allow-list. Every request
  DTO carries Bean Validation constraints, including the query DTO.
- **Rate limiting.** The default per-user tier, inherited from
  `ApiRateLimitFilter` — **confirmed to cover these paths, not assumed** (§6).
- **`GlobalExceptionHandler` gained one API-wide handler:** `BindException`
  → `400 VALIDATION_ERROR` with `fieldErrors`. Domain 4 is the first domain
  with validated **query parameters**, and without it `?size=0` or
  `?dateFrom=garbage` fell through the `Exception` catch-all as a `500`. It is
  placed on the supertype deliberately, so later domains inherit it;
  `MethodArgumentNotValidException` (a `BindException` subclass) keeps its own
  more specific handler for request bodies.
- **Constraint → error mapping.** `uq_transactions_receipt_public_id` →
  `409 RECEIPT_ALREADY_ATTACHED`, matched by **constraint name** (never message
  text) and **null-safe** — not every integrity error carries a name (V6's
  `trg_categories_enforce_depth_one` raises from plpgsql with none), and
  folding a null's case would throw an NPE *inside* the handler for the original
  failure. Everything else `V7` can raise is rethrown and logged as an honest
  `500`: the eight `chk_transactions_*` CHECKs and
  `fk_transactions_category_id` all restate rules the service rejects first, so
  reaching one means a rule was skipped and a logged stack trace beats a
  plausible-looking `400`.
- **The two `409`s on `PATCH` are deliberately distinct codes.**
  `VERSION_CONFLICT` means re-fetch and retry; `RECEIPT_ALREADY_ATTACHED` must
  **never** be retried, because retrying re-sends the same reference. Do not
  collapse them.
- **The expense/income rule has no database backstop.**
  `CHECK ((type = 'expense') = (category_id IS NOT NULL))` could not be added —
  it would make `category_id`'s own `ON DELETE SET NULL` unexecutable, since the
  cascade's `UPDATE` would violate it (Database Architect, 2026-10-24). So
  `CategorySnapshotResolver` is the **only** enforcement, and nothing may assume
  otherwise. One correct consequence: an expense row with
  `category_id = NULL` and intact snapshot values still renders — and a `PATCH`
  that does not touch `categoryId` must not demand one for such a row. That is
  why the snapshot is re-derived **only** when `type` changes or a `categoryId`
  is supplied.
  **Amended 2026-10-25:** the API no longer *produces* such a row.
  `DELETE /categories/{id}` reassigns to `Misc` rather than nulling (§12.10), so
  the `ON DELETE SET NULL` path is now unreachable on the happy path and only
  direct SQL can reach it. The leniency above stays exactly as it is — it is
  what keeps history renderable if one ever appears.
- **The rollback trap (§3, points 3 and 4) does not apply — checked, not
  assumed.** No method here writes and *then* throws: both write paths are in
  Domain 2/3's two explicit phases, so every rejection (`400`, `403`, `404`,
  `409 VERSION_CONFLICT`, the pre-checked `409 RECEIPT_ALREADY_ATTACHED`) is
  decided before a single field is mutated; `persist`'s `409` follows a *failed*
  flush, so rolling back is correct; and the soft delete writes once and cannot
  throw afterwards. So there is **no `noRollbackFor` anywhere in this domain**,
  and `TransactionService`'s class Javadoc records that reasoning next to the
  code. Re-check it when Domain 6 adds `activities`/`notifications` fan-out —
  that is the first place a write will need to survive a rejection.
- **Logging** (constitution §23, `security-architecture.md` §8). Creates and
  updates log ids, the coarse operation shape (`type`, `paymentMode`), which
  fields changed, and whether a receipt/note was set or cleared — **never an
  amount, a title or a note**. Transaction amounts and merchant detail are
  personal financial information. `receipt_public_id` is explicitly safe to log
  but the boolean is what is actually useful. Nothing logs a signature or a
  signed URL, because neither is generated (§13.9).

### 13.9 Receipts — what is implemented and what is NOT

**Implemented:** the `receipt_public_id` column, the `receiptPublicId`
request/response field on §4.1/§4.2/§4.4, the **claim check**, the one-asset-one-transaction
`409`, and absent-vs-explicit-`null` clearing.

The claim check (`service/ReceiptPublicIdPolicy`, ADR 0020 §3) is the only
server-side validation of the value, and it is the one that matters: the
submitted string must match the configured root **and carry the caller's own
user id**. Shape:

```
{app.receipts.public-id-root}/receipts/{callerUserId}/{assetName}
```

`app.receipts.public-id-root` defaults to `myexpense` and is overridable with
`RECEIPT_PUBLIC_ID_ROOT`. It is a **folder name, not a secret**, which is why it
has a default — unlike `CLOUDINARY_API_SECRET`, which when it is introduced must
follow `JWT_SECRET`/`DB_PASSWORD` and have none. Nothing in this domain reads a
credential.

Test it by hand, since nothing generates these yet:

```bash
# accepted
-d '{ ..., "receiptPublicId": "myexpense/receipts/<YOUR userId>/abc123" }'
# 400 VALIDATION_ERROR — another user's folder
-d '{ ..., "receiptPublicId": "myexpense/receipts/<OTHER userId>/abc123" }'
# 400 — wrong root, no root, a deeper path, or a trailing slash
-d '{ ..., "receiptPublicId": "receipts/<YOUR userId>/abc123" }'
-d '{ ..., "receiptPublicId": "myexpense/receipts/<YOUR userId>/sub/abc" }'
```

Then claim the *same* accepted value on a second transaction →
`409 RECEIPT_ALREADY_ATTACHED` (and `SELECT count(*) FROM transactions WHERE
receipt_public_id = '...'` stays `1`). Re-sending a transaction's **own**
current value on `PATCH` is **not** a conflict. `"receiptPublicId": null`
clears the column **and nothing else** — the asset is never destroyed, not on a
clear, not on a replace, not on a soft delete (ADR 0020 §9).

**NOT implemented, and deliberately so** (Project Owner, 2026-10-24 — the
Cloudinary plan's signed-delivery-URL support is unconfirmed and there are no
credentials). This is a **sequencing** deferral, not a design one: the column is
one nullable field and lands in this same migration either way, so receipts can
be completed later with **no second migration** (api-overview.md §4.2's own
struck gap note says exactly this).

What remains, precisely:

1. **`POST /api/v1/receipts/upload-signature`** (api-overview.md §4's table,
   ADR 0020 §1) — **empty request body**, `200` with
   `{ uploadUrl, publicId, params }`. Needs: `CLOUDINARY_CLOUD_NAME`,
   `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (the last with **no default**);
   one class that is the only code reading the secret; `503
   RECEIPT_UPLOAD_UNAVAILABLE` when configuration is absent or incomplete; and
   **two independent rate limits** — a ~10-per-10-minute burst limit *and* a
   ~50-per-24-hour cost cap (`security-architecture.md` §11; the existing
   `RateLimiter` expresses both with no new machinery and no new table, the way
   `app.ratelimit.auth.register` is already a 5-per-3600 s bucket). It belongs
   on its own `/api/v1/receipts` controller — it addresses no transaction, which
   is precisely what lets it be called before one exists.
   **It must build its `public_id` from `ReceiptPublicIdPolicy.slotFor(userId)`,
   not its own copy of the format string** — two copies means a silent mismatch
   where every legitimately-uploaded receipt is rejected at claim time.
2. **`receiptSignedUrl` on `GET /transactions/{id}` only** (§4.3, ADR 0020
   §5.2) — short-lived (~10 min), minted fresh per response, `null` when
   `receiptPublicId` is `null`, **never** on the list endpoint, never persisted,
   never logged, and never written into an `activities` row. The prohibition
   that *is* the access control: **no endpoint may accept a `publicId` and
   return a URL for it.** The only path from a stored reference to a readable
   URL runs through the owner-scoped row this endpoint already fetches.
3. **Account-side configuration, which is not code and without which the design
   fails** (ADR 0020 §8): unsigned uploading **disabled**, strict
   transformations on, no public resource listing, the format allow-list and
   max size enforced in the signed params/preset. Flag back rather than working
   around any item the plan cannot deliver — in particular **do not fall back to
   a permanent signed URL or to public assets.**
4. **No `receiptSignedUrlExpiresAt`, and no new dependency** — ADR 0020's §21
   pass concluded the Cloudinary SDK is not needed (both signatures are
   JDK-only string-then-hash constructions).

### 13.10 Key assumptions — Domain 4

Flagged rather than absorbed, since each is a real decision the contract does
not pin:

- **⚠ `paymentMethodUpiId` is declared but always `null` — there is no column
  to source it from.** §4.3 sources it from "{profile's mock/real UPI id}",
  which today exists **only** as the frontend mock
  `profileMocks.js#profileUser.mockUpiId` (ADR 0007 §3.3). `data-model.md` §1.1
  has no `users.upi_id`, and inventing one is exactly what constitution
  §15/§30 forbids. The key is declared so the response shape matches the
  contract and so adding the value later is a one-line change.
  **Needs a decision:** either the Database Architect adds a nullable
  `users.upi_id` (and `PATCH /users/me` gains the field), or the System
  Architect drops `paymentMethodUpiId` from §4.3. Until then the field is
  omitted from every response, which is honest — `@JsonInclude(NON_NULL)`
  means a client never sees a misleading `null`.
- **`paymentMethodDisplay` for premium + `both` stays `"Both"`.** §4.3's table
  describes that cell as *two rows* the client composes from the
  `cashAmount`/`onlineAmount` fields it already has, plus the UPI line — it
  specifies no single replacement string. Derived reading.
- **~~`403 NOT_GROUP_MEMBER` is the answer for every group-scoped write while
  Domain 6 is unbuilt.~~ FIXED 2026-11-03 — THE VACUOUS CHECK IS GONE.** The
  original note read: with no `group_members` table the check §4.2 specifies —
  "is the caller a member of this group" — is *vacuously false* for every input,
  so answering with the code the contract already defines is truthful; a
  `NOT_IMPLEMENTED` or a group-shaped `400` would be inventing contract. That
  reasoning was sound and the **consequence was a reported bug**: the Project
  Owner, as a real member of a real group, got `403 NOT_GROUP_MEMBER` on every
  group expense, which the app surfaces as *"you can only add expenses to groups
  you belong to."* `V10__groups.sql` is applied and `group_members` is
  populated, so `TransactionService#requireScopeAndGroupAgree` now calls
  `GroupMemberRepository#existsByGroupIdAndUserId(groupId, userId)` — the same
  single indexed lookup every §7 endpoint uses, on both `POST` and `PATCH`. What
  survives from the original note is the status code and its justification: the
  code **stays `403`** (§4.2's error table and `V10` contract item 1), the
  `404`-not-`403` convention is not violated because the resource being
  addressed is the caller's own new transaction and `groupId` is an *input* to
  that write, and the anti-enumeration property is preserved anyway because an
  unknown group gets the identical `403`. Test matrix in §13.6(h).
  - **ONE CORRECTION TO THE RECORD.** §15.8's follow-up note claimed
    "`Transaction` deliberately does not map `group_id` at all", and so did
    `TransactionScope`'s Javadoc. **Both were wrong.** `group_id` has been
    mapped since Domain 4 was written — `@Column(name = "group_id") private UUID
    groupId;`, a plain nullable `UUID` — and `TransactionResponse` has always
    read it rather than hardcoding a null. The fix therefore needed **no mapping
    change, no entity change and no migration**: it changed one method, threaded
    the already-injected principal into it, added one repository to the
    constructor, and mapped one constraint. Both stale Javadocs are corrected in
    place.
  - **Only registered membership counts.** The query matches
    `group_members.user_id` and deliberately not `invited_contact_id`: a contact
    placeholder has no account and so can never be an authenticated caller.
  - **`fk_transactions_group_id` → `404 GROUP_NOT_FOUND`**, per `V10` contract
    item 1, in `TransactionService#translateWriteViolation` (full constraint
    name, null-safe, same shape as `GroupService`'s translator). It is the
    **race backstop, not the error path** — the service pre-check resolves the
    group through `group_members`, so a nonexistent group is a `403` long before
    the FK sees it, and no endpoint in this phase can delete a group to open the
    window. Note the near-collision that is not one:
    `chk_transactions_group_id_matches_scope` does *not* contain
    `fk_transactions_group_id`, because the match breaks on the leading `f`.
- **List ordering is `txn_date desc, txn_time desc, created_at desc, id desc`.**
  The contract specifies none and *some* total order is mandatory for stable
  pagination. Newest-first matches the Dashboard's presentation and the leading
  columns of the `transactions(user_id, txn_date)` index; `id` guarantees
  totality. **The frontend should not read meaning into it** beyond
  "newest-first".
- **`size` is capped at 100** (`page` has no cap — an out-of-range page is
  simply an empty one). The contract gives `size`'s default but no maximum.
- **Payment-mode portions must be `>= 0`, not `> 0`.** A zero portion is
  arithmetically legal (the whole amount went the other way); a *negative* one
  is not, or `-100` and `350` would "sum correctly" to `250` and record
  nonsense. The contract gives the sum rule but says nothing about each
  portion's own bounds.
- **`notes` has no length limit**, at the Database Architect's explicit
  instruction (the column is uncapped `text`) and because the contract gives
  none. It is therefore the **one unbounded request field in this domain** —
  flagged honestly: if a body-size limit is wanted, it belongs in server
  configuration (one global limit) rather than as a guessed per-field number.
- **`title` is trimmed; `notes` is not.** Trimming matches Domain 3's handling
  of `name`/`iconName`/`glyph` and the frontend's own `title.trim()`. `notes` is
  free text where whitespace may be deliberate, and clearing is expressed by an
  explicit `null` rather than by a blank string.
- **`txnTime` is accepted as a validated `"HH:mm"` string and returned as one.**
  The entity stores a `LocalTime`; the DTO boundary is a string so the accepted
  and emitted shape is exactly the contract's and is independent of Jackson
  configuration (a `LocalTime` would serialize `"13:45:00"` whenever seconds
  were non-zero). Seconds are not accepted on input.
- **`clientId` is stored but not deduplicated on.** The contract calls it an
  idempotency key, but idempotency is specified for `/sync/push` (Domain 8) and
  the schema carries **no unique index** on `client_id`, so a race-safe dedup is
  not expressible here. Replaying a `POST` with the same `clientId` creates a
  second row today. **Flagged for Domain 8** — if `POST /transactions` should
  itself be idempotent, that needs a unique index (and a decision about whether
  it is scoped per user).
- **A `categoryId` filter naming an unknown or other-user category returns an
  empty page, not a `404`.** §4.1 defines no error for the parameter and a
  `404` would confirm whether an id is real.
- **A reversed date range is a legal empty range**, not a `400`.
- **A valid token whose `user_id` no longer exists returns `401 UNAUTHORIZED`**,
  same as Domains 2–3.
- **The `type`/`scope`/`paymentMode` vocabularies are matched exactly, in
  lowercase.** `"Expense"` is a `400`. The contract's values are lowercase
  literals and the frontend already sends them that way.

### 13.11 Not verified in the session that wrote this

**No shell access, so: not compiled, not run, no live request issued, and
Domains 1–3 not re-run.** The statically-unverifiable items, in rough order of
risk — all but the last two fail **at startup** rather than at request time,
which is the loud-and-safe failure mode this project prefers:

> **Later session, 2026-10-29.** The Project Owner has since run this domain
> live. Item 1 is no longer hypothetical: half of it was confirmed working and
> the other half **actually failed with a `500` and has been fixed**. It is
> rewritten below as the incident record. Nothing else in this list has been
> re-stated.

1. **RESOLVED (2026-10-29) — `findFiltered`'s parameter binding. The enum half
   works; the DATE half was broken and is now fixed. Do not reintroduce the
   idiom.**

   *Verified live:* `(:scope is null or t.scope = :scope)` and
   `(:type is null or t.type = :type)` bind correctly with
   `AttributeConverter`-backed enums (`?type=`/`?scope=` return `200`), the
   explicit `countQuery` alongside the correlated subquery is fine, and the
   `categoryId` clause — same idiom, bare `UUID` — returns `200`. The
   `String`-column fallback described in the original note is **not** needed and
   was not applied.

   *Failed live:* **every** valid `dateFrom` or `dateTo` returned
   `500 INTERNAL_ERROR`. Omitting both returned `200`, and a malformed date
   correctly returned `400 VALIDATION_ERROR` — so Spring's String→`LocalDate`
   conversion was never at fault; the query was rejected by PostgreSQL at parse
   time. From the PostgreSQL server log, verbatim (the same error appeared for
   `$6` and `$8` on this statement, and for `$3` on
   `aggregateSpendByCategory`'s):

   ```
   ERROR:  could not determine data type of parameter $3
   STATEMENT:  select t1_0.category_id,sum(t1_0.amount) from transactions t1_0,categories c1_0
     where c1_0.id=t1_0.category_id and c1_0.user_id=$1 and t1_0.user_id=$2
     and t1_0.deleted_at is null and ($3 is null or t1_0.txn_date>=$4)
     and ($5 is null or t1_0.txn_date<=$6) group by t1_0.category_id
   ```

   **Cause.** `(:param is null or column >= :param)` makes Hibernate emit one
   named parameter as **two** JDBC placeholders. The occurrence inside
   `is null` has no surrounding expression to take a type from, and the
   PostgreSQL JDBC driver binds `date`/`time`/`timestamp` values as strings with
   an **unspecified type OID** on purpose, leaving the server to infer the type
   from context — of which `$3 is null` has none. A `UUID`, a `String` and an
   `AttributeConverter`-backed enum are each bound with a concrete type OID,
   which is exactly why `scope`, `type` and `categoryId` survive the idiom and a
   `LocalDate` cannot. It is also why the all-omitted case worked and the bug
   read as a date-*parsing* problem: a null bind goes through
   `setNull(…, Types.DATE)`, which **is** typed.

   **Fix.** Both clauses, in **all three** query bodies — `findFiltered`'s main
   query, its `countQuery`, and `aggregateSpendByCategory`:

   ```
   and t.txnDate >= coalesce(:dateFrom, t.txnDate)
   and t.txnDate <= coalesce(:dateTo, t.txnDate)
   ```

   The parameter is now bound **once**, inside an expression whose sibling
   column fixes its type, so no untyped placeholder remains. Semantics are
   unchanged and rest on a schema guarantee, not on luck: `txn_date` is
   `DATE NOT NULL` (`V7__transactions.sql`), so an omitted bound degrades to
   `txn_date >= txn_date` — always true, i.e. the clause is disabled exactly as
   `null` disabled it before. Both bounds stay inclusive; a reversed range stays
   a legal empty range here (§13.10) and still a `400` on Statistics (§14.1).
   No schema change, no entity change, no new dependency, no string
   concatenation, and the main query and `countQuery` remain clause-for-clause
   identical.

   **THE RULE, for every repository in this backend:** never place a
   `LocalDate`, `LocalTime`, `OffsetDateTime` or `Instant` parameter inside an
   `is null` check. Use the `coalesce` form above. The idiom is still correct —
   and still in use — for `UUID`, `String`, numeric, boolean and
   converter-backed enum parameters; `ActivityRepository#findFiltered`'s four
   `UUID` filters were audited during this fix and deliberately left alone.

   **Two alternatives considered and rejected.**
   - *An explicit HQL cast on the null-check occurrence*
     (`cast(:dateFrom as LocalDate) is null or …`) also gives the placeholder a
     type and is the smaller diff. Rejected because it keeps the parameter bound
     twice and adds a construct whose cast-target resolution and parameter-type
     inference could only be confirmed by booting — and a bad `@Query` is a boot
     failure. `coalesce` is plain JPQL this codebase can rely on.
   - *Non-null sentinel bounds bound in the service*, making the predicate a
     plain range. Rejected on correctness: `LocalDate.MIN`/`MAX`
     (±999 999 999) are **far outside** PostgreSQL's `date` range (4713 BC –
     5874897 AD) and would themselves fail to bind, and any narrower sentinel
     silently drops rows outside it from an *unfiltered* list — `txn_date` is
     client-supplied and carries no CHECK bounding it. It also puts a magic
     constant in the service for a persistence-layer problem.
2. **That the three new `AttributeConverter`s are picked up** by
   `@Converter(autoApply = true)` for `TransactionType`, `TransactionScope` and
   `PaymentMode`. Same pattern as `VerificationTokenTypeConverter`, which is
   live-verified, so the risk is low; a failure shows up as a `ddl-auto=validate`
   type mismatch or an enum-name value hitting a `chk_transactions_*` CHECK on
   the very first insert.
3. **That the entity matches `V7__transactions.sql` column for column** —
   `ddl-auto=validate` fails startup on any mismatch. The rows worth
   double-checking are `title` (`varchar(255) NOT NULL`, the column the
   Database Architect had to create because `data-model.md` §2.2 never listed
   it), `notes` (uncapped `text`, mapped with no `length`), and `group_id` /
   `split_expense_id` (plain nullable `uuid`, FKs deferred to Domain 6).
4. **That `@Lock(PESSIMISTIC_WRITE)` on
   `findForUpdateByIdAndUserIdAndDeletedAtIsNull` derives correctly** — Spring
   Data ignores the text between `find` and `By`, so this should derive the same
   query as its unlocked sibling with `FOR UPDATE` added. A derivation failure
   is a `PropertyReferenceException` at boot.
5. **That `@Valid @ModelAttribute ListTransactionsQuery` reports failures as a
   `BindException`** (and so lands on the new handler) rather than as something
   else. The fallback is visible: a `500 INTERNAL_ERROR` with a logged stack
   trace on `?size=0` means the thrown type is different, and the fix is one
   more `@ExceptionHandler`.
6. **That `uq_transactions_receipt_public_id` is the real index name** and that
   `getConstraintName()` returns it on a concurrent violation. Reasoned through
   from Domain 3's live-verified equivalent, but reasoning is not a run. Every
   *sequential* duplicate is caught by the pre-check regardless; only the
   concurrent case distinguishes the two.
7. **That field-level `@JsonInclude(NON_NULL)` on a record component omits the
   two enrichment keys.** Worst case they appear as `null` on list rows —
   cosmetic, not a correctness problem.
8. **That the Postman collection's JSON parses** and that requests 45+ chain
   their variables correctly (`transactionId`, `transactionVersion`,
   `incomeTransactionId`, `subcategoryId`/`foodCategoryId` from Domain 3).

### 13.12 Not done / follow-ups — Domain 4

- **Receipts: the signing endpoint, `receiptSignedUrl`, and the Cloudinary
  account configuration** — §13.9's four numbered items.
- **`paymentMethodUpiId` has no data source** — §13.10's first bullet needs a
  Database Architect or System Architect decision.
- **`title` is missing from `data-model.md` §2.2** — created in `V7` by the
  Database Architect from `split_expenses.title`'s shape; the doc amendment is
  the System Architect's.
- **`POST /transactions` is not idempotent on `clientId`** — §13.10; Domain 8.
- **~~Nothing group- or split-related~~ — the group half is DONE (2026-11-03).**
  `scope='group'` from a real member is now a `201`/`200` that stores
  `group_id`, and `fk_transactions_group_id` (`V10`) is mapped. §13.10's first
  group bullet is the record. Two things remain:
  - **`splitExpenseId` is still not settable through §4.2/§4.4, deliberately,
    and this fix does not change that.** The field is absent from both request
    DTOs because §4.2 permits only a split expense to set it — and
    `SplitExpenseService#createConsumptionShareTransaction` **already does**, so
    a split-originated transaction *does* carry its back-link today and
    `TransactionResponse.splitExpenseId` is a genuine read. If the app shows no
    SPLIT badge, the gap is on the read/render side or in which rows the app is
    looking at, **not** a missing column — check a real row before designing
    anything. Making the field client-settable would let a client assert a
    provenance the server never observed and would need `fk_split_expenses_*`
    ownership checks it has no contract for; it is a System Architect decision,
    not an unblocked consequence of this fix.
  - **A group transaction cannot be demoted to `scope='personal'`** — newly
    reachable, because no group-scoped row could exist before. `groupId` on
    `PATCH` has no absent-vs-explicit-`null` distinction (§4.4 gives that
    convention to `notes` and `receiptPublicId` only), so the stored group id
    always survives and `{"version": N, "scope": "personal"}` is a
    `400 VALIDATION_ERROR` from the scope/group "iff". **Not fixed here**:
    extending the presence-flag convention to a third field, or defining the
    demotion, is a contract decision for the System Architect. The frontend's
    Edit flow carries a Personal/Group toggle, so it is reachable from a screen.
  - **DOC GAP — §4.4's error table does not list `403 NOT_GROUP_MEMBER`**,
    although `groupId` is one of its request fields and the gate has always been
    applied on that path (unchanged by this fix; `PATCH` has called the same
    method as `POST` since Domain 4 was written). §4.2's table is the authority
    the implementation follows. **The System Architect should add the row to
    §4.4** — this is a documentation amendment, not a behaviour question.
- **No automated tests**, consistent with Domains 1–3.
- **`exception/PremiumRequiredException.java` is still dead code and should be
  deleted** — unchanged from §12.7; no session has had the shell access to
  remove a file.
- **`docs/api/api-overview.md` §4's Status cells still say "Not started"** and
  `docs/roadmap/backend-build-order.md`'s Domain 4 row is unchanged. Both files
  are System-Architect-owned, so they were deliberately not edited here; they
  need updating once the Project Owner's testing pass confirms this domain.
- **The pessimistic-lock path is untested under real concurrency** — it needs
  two simultaneous `PATCH`es carrying the same `version` for one transaction to
  actually exercise it. Likewise the concurrent duplicate-receipt claim.

---

## 14. Statistics — spend by parent category

**One** endpoint under `/api/v1/statistics`, implemented exactly to
`docs/api/api-overview.md` §14.1 and specified by
`docs/decisions/0022-statistics-expenses-by-parent-category.md`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/statistics/categories` | Expense spend per **parent** category for a date range, subcategory spend **rolled up** |

**No migration, no new table, no new column, no new dependency.** This is a
derived read model over `transactions` (`V7__transactions.sql`) and `categories`
(`V3`/`V4`/`V6`) exactly as they stand. It writes nothing.

Requires `Authorization: Bearer <accessToken>` and follows Domains 2–4's rules
unchanged: the caller comes from `@CurrentUserId` only (§11.1), every row
aggregated is scoped to that id **inside the query**, and the default per-user
rate-limit tier applies automatically (§6 — **no second mechanism was added**).

**It is free.** `403 PREMIUM_REQUIRED` is not a valid response from this path
(ADR 0022 §7), and nothing on it reads `users.is_premium` — not even unused.

> ⚠ **This endpoint sums rows written by Domain 4, which has never been run**
> (§13.11). If a Domain 4 mapping fault exists, the totals below inherit it.
> Verify §13 first — an endpoint that sums unverified rows cannot be verified
> itself, which is exactly the sequencing ADR 0022's "Sequencing" section asks
> for.

Get a token first exactly as in §11.2; every call below uses it as `$TOKEN`.

### 14.1 The roll-up proof — the single most important check

Set up three expenses, which is the smallest shape that exercises every rule.
Reuse the categories and the subcategory from §12/§13 (`Food`, `Food › Snacks`,
`Transport`):

```bash
# (a) 2700 tagged DIRECTLY to the parent, Food
curl -s -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Groceries", "categoryId": "<FOOD id>",
        "txnDate": "2026-10-10", "txnTime": "10:00", "amount": 2700.00,
        "type": "expense", "scope": "personal", "paymentMode": "cash" }'

# (b) 1500 tagged to the SUBcategory, Food > Snacks
curl -s -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Chips run", "categoryId": "<SUBcategory id>",
        "txnDate": "2026-10-11", "txnTime": "17:00", "amount": 1500.00,
        "type": "expense", "scope": "personal", "paymentMode": "cash" }'

# (c) 800 tagged to a second top-level category, Transport
curl -s -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Auto fare", "categoryId": "<TRANSPORT id>",
        "txnDate": "2026-10-12", "txnTime": "09:30", "amount": 800.00,
        "type": "expense", "scope": "personal", "paymentMode": "online" }'

# ...and one INCOME row, which must be invisible to this endpoint
curl -s -X POST http://localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "October salary", "txnDate": "2026-10-01", "txnTime": "09:00",
        "amount": 85000.00, "type": "income", "scope": "personal",
        "paymentMode": "online" }'
```

Now read the breakdown:

```bash
curl -i "http://localhost:8080/api/v1/statistics/categories?dateFrom=2026-10-01&dateTo=2026-10-31" \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` and **exactly** this shape (ids will differ):

```json
{
  "dateFrom": "2026-10-01",
  "dateTo": "2026-10-31",
  "totalSpent": 5000.00,
  "categories": [
    {
      "categoryId": "<FOOD id>",
      "categoryName": "Food",
      "iconName": "cafe-outline",
      "glyph": "F",
      "amount": 4200.00,
      "subcategories": [
        { "categoryId": "<SUB id>", "categoryName": "Snacks",
          "iconName": "...", "glyph": "S", "amount": 1500.00 }
      ]
    },
    {
      "categoryId": "<TRANSPORT id>",
      "categoryName": "Transport",
      "iconName": "car-outline",
      "glyph": "T",
      "amount": 800.00,
      "subcategories": []
    }
  ]
}
```

The seven things to check, each of which is a separate rule:

1. **`Food.amount` is `4200.00`, not `2700.00`** — `2700` direct + `1500` from
   its subcategory. A parent's `amount` is **inclusive of its children**, which
   is the same roll-up `GET /transactions?categoryId=<FOOD id>` and a parent's
   budget cap already use. **Three surfaces, one definition of "spending in this
   category"** — if they ever disagree, a user sees a pie slice that contradicts
   their budget warning. Cross-check it: that `GET /transactions` call returns
   `totalElements: 2`.
2. **The parent's own direct spend is NOT a field.** It is `4200.00 - 1500.00`.
   Shipping all three numbers would be shipping a fact twice (constitution §17);
   the drill-down computes one subtraction.
3. **`totalSpent` (`5000.00`) is exactly `4200.00 + 800.00`** — the sum of the
   **top-level** entries, with `Snacks` counted once inside `Food`. **Not**
   `6500`, which is what double-counting the child would give. This is the
   contract every client-side percentage rests on (ADR 0022 §4), so it is worth
   adding up by hand.
4. **No `percentage` field anywhere**, and no `transactionCount`. Percentages
   are the client's division; the drill-down's "N transactions" is
   `totalElements` on the `GET /transactions` call it is already making.
5. **The income row is absent from every figure** — `totalSpent` is `5000.00`,
   not `90000.00`. There is **no `type` parameter** to ask for income, and
   `?type=income` or `?type=expense` on this path is simply an unknown,
   ignored parameter (it does not error and it changes nothing).
6. **`Transport` carries `"subcategories": []`**, never `null` and never a
   missing key — "no subcategory spend" is not missing data.
7. **Categories with no spend are OMITTED.** An account seeded with 8 defaults
   returns only the 2 that have spend — there are no `amount: 0.00` entries,
   because a pie has no zero slices. (`Misc` is one of the omitted ones until
   something is reassigned into it; after a category delete it starts
   appearing, which is correct and is not a change to this endpoint.)

**The ordering is part of the contract** (`amount` desc, ties by name asc):
`Food` (4200) before `Transport` (800). Spend 5000 on `Transport` and re-read —
the array flips. Run the same request five times: the order must be
**byte-identical** every time, at both levels. A legend that reshuffles between
two identical requests reads as a bug, and "the order the database happened to
return" is not a contract.

### 14.2 Zero spend is a `200`, never a `404`

Use a brand-new account (or any range with no expenses):

```bash
curl -i "http://localhost:8080/api/v1/statistics/categories?dateFrom=2020-01-01&dateTo=2020-01-31" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "dateFrom": "2020-01-01", "dateTo": "2020-01-31", "totalSpent": 0.00, "categories": [] }
```

`200`, `totalSpent: 0.00` (**two decimal places**, not `0`), `categories: []`.
**Never a `404`, never an empty body, and never a `NO_ACTIVE_PERIOD`-style
error** — "nothing was spent in this range" is a successful answer to a
well-formed question. The contrast with `GET /budget/active-period`'s
`404 NO_ACTIVE_PERIOD` is deliberate: there a *resource* does not exist, here a
computation over an empty set returned zero. The client renders its own empty
state and must guard the division (ADR 0022 §5).

An account with **only income** returns the same empty body. So does one whose
only expenses are soft-deleted.

### 14.3 The date range

```bash
# both bounds are INCLUSIVE — this range includes the 2026-10-12 row
curl -s "http://localhost:8080/api/v1/statistics/categories?dateFrom=2026-10-12&dateTo=2026-10-12" \
  -H "Authorization: Bearer $TOKEN"
# -> totalSpent 800.00, Transport only

# omit BOTH -> all of the caller's history
curl -s "http://localhost:8080/api/v1/statistics/categories" -H "Authorization: Bearer $TOKEN"

# one-sided ranges are legal
curl -s "http://localhost:8080/api/v1/statistics/categories?dateFrom=2026-10-11" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/statistics/categories?dateTo=2026-10-10" -H "Authorization: Bearer $TOKEN"

# REVERSED range -> 400 VALIDATION_ERROR (NOTE: this differs from §4.1 on purpose)
curl -i "http://localhost:8080/api/v1/statistics/categories?dateFrom=2026-10-31&dateTo=2026-10-01" \
  -H "Authorization: Bearer $TOKEN"

# malformed date -> 400 VALIDATION_ERROR, not a 500
curl -i "http://localhost:8080/api/v1/statistics/categories?dateFrom=garbage" -H "Authorization: Bearer $TOKEN"
```

`dateFrom`/`dateTo` are **the same two names, the same `YYYY-MM-DD` format and
the same inclusive semantics as §4.1's**, deliberately — a second spelling for
one concept is drift. `dateFrom` and `dateTo` are **echoed back exactly as
supplied**, and are `null` when omitted (present-and-`null`, the uniform key-set
convention).

**There is no `budgetPeriodId` parameter, and that is a decision** (ADR 0022
§2). The Statistics tab reads `GET /budget/active-period` and passes that
period's `startDate`/`endDate` here, so it aligns with the user's budget period
**by the client's choice of range** rather than a server-side join. Statistics
must still answer for a user who has never saved a period.

**There is no `scope` parameter** this round, and **no `sort`** — adding a
client string to an `ORDER BY` is not how sorting would ever be added here.

### 14.4 The DB checks to run

The point of these is that the endpoint's arithmetic can be reproduced by hand.
Replace `<uid>` with the id from `GET /users/me`.

```sql
-- 1. THE SLICES. This is the endpoint's own query, in plain SQL. Each row must
--    match one subcategories[] entry, or a top-level entry's direct spend.
SELECT c.id, c.name, c.parent_category_id, sum(t.amount) AS amount
FROM transactions t
JOIN categories c ON c.id = t.category_id AND c.user_id = '<uid>'
WHERE t.user_id = '<uid>'
  AND t.deleted_at IS NULL
  AND t.txn_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
GROUP BY c.id, c.name, c.parent_category_id
ORDER BY amount DESC, c.name ASC;

-- 2. THE ROLLED-UP PARENT TOTALS — what categories[].amount must equal.
SELECT coalesce(p.id, c.id)     AS top_level_id,
       coalesce(p.name, c.name) AS top_level_name,
       sum(t.amount)            AS rolled_up_amount
FROM transactions t
JOIN categories c      ON c.id = t.category_id AND c.user_id = '<uid>'
LEFT JOIN categories p ON p.id = c.parent_category_id AND p.user_id = '<uid>'
WHERE t.user_id = '<uid>'
  AND t.deleted_at IS NULL
  AND t.txn_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
GROUP BY 1, 2
ORDER BY rolled_up_amount DESC, top_level_name ASC;

-- 3. THE ONE INVARIANT THAT MATTERS: totalSpent = SUM(slices).
--    This number must equal the response's totalSpent EXACTLY.
SELECT coalesce(sum(t.amount), 0.00) AS total_spent
FROM transactions t
JOIN categories c ON c.id = t.category_id AND c.user_id = '<uid>'
WHERE t.user_id = '<uid>'
  AND t.deleted_at IS NULL
  AND t.txn_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';

-- 4. WHAT THE JOIN EXCLUDES, and why income can never appear. Both counts are
--    excluded from the figures above; the first should be > 0 and the second 0.
SELECT count(*) FILTER (WHERE type = 'income')                          AS income_rows,
       count(*) FILTER (WHERE type = 'expense' AND category_id IS NULL) AS orphaned_expense_rows
FROM transactions WHERE user_id = '<uid>' AND deleted_at IS NULL;
```

**`orphaned_expense_rows` must be `0`.** This API cannot create one: §3.4
reassigns on delete rather than nulling, and **that endpoint now exists and does
exactly that** (§12.10 — this parenthetical used to read "and that endpoint is
not built yet either", which is why the check is worth running *after* a
category delete rather than only before). But
`fk_transactions_category_id` is `ON DELETE SET NULL`, so direct SQL still can,
and so would a reassignment that missed a row. Such a row is silently excluded from both `totalSpent` and the slices —
which is what keeps the sum invariant true by construction. **If you ever see a
non-zero count there, that is a signal about the category-delete path, not a
feature request: the fix is a residual slice in this response, not continued
silent exclusion** (ADR 0022 §5).

Also worth confirming once, with `spring.jpa.show-sql=true`:

- **exactly TWO statements per request** — one `GROUP BY` and one
  `select ... from categories where user_id = ?` — and **nothing per
  category**;
- **exactly ONE statement** when nothing was spent in the range (the categories
  read is skipped);
- **no page query anywhere.** This endpoint never fetches transaction rows.

Then `EXPLAIN ANALYZE` statement 1 against realistic row counts before
proposing the `transactions(user_id, category_id, txn_date)` index — see §14.8.

### 14.5 Implementation notes

- **Layering.** `StatisticsController` is HTTP only (one method, no logic).
  `StatisticsService` folds and sorts. `TransactionRepository` holds the one
  aggregating query. No new repository was created: the aggregate's root entity
  is `Transaction`, so it belongs on that interface, and Domain 4's existing
  code was **extended, not rewritten**.
- **⚠ THE AGGREGATION IS SQL, AND "EXPENSES ONLY" IS STRUCTURAL.** Both are
  contract, not style (ADR 0022 §1/§8; `api-overview.md` §14.1's
  "Implementation constraints that are part of the contract"). The whole
  mechanism is one `GROUP BY` whose `FROM` clause joins `categories`:

  ```
  from Transaction t, Category c
  where c.id = t.categoryId and c.userId = :userId
    and t.userId = :userId and t.deletedAt is null
    and t.txnDate >= coalesce(:dateFrom, t.txnDate)
    and t.txnDate <= coalesce(:dateTo, t.txnDate)
  group by t.categoryId
  ```

  The two date clauses read `coalesce` and **not**
  `(:dateFrom is null or t.txnDate >= :dateFrom)` because the second form made
  this endpoint `500` on every valid range — PostgreSQL could not determine the
  type of the placeholder sitting inside `is null`. Fixed on 2026-10-29;
  §13.11 item 1 carries the verbatim error, the cause and the rule. `txn_date`
  is `DATE NOT NULL`, so an omitted bound degrades to `txn_date >= txn_date`
  and disables its clause exactly as `null` did.

  **Note what is NOT there: any mention of `t.type`.** Income is excluded
  because it *cannot be reached* — every income row carries
  `category_id = NULL` (ADR 0018 §3), and `NULL` matches `c.id = t.categoryId`
  for no `c` whatsoever. The join is not droppable, because §14.1 requires every
  emitted category to be a real, current, caller-owned `categories` row, so the
  join is what the response is built from. A `where t.type = 'expense'` clause
  would be the one line a future reader could relax, parameterise or delete
  while "generalising" the endpoint; there is no such clause to weaken. **Do not
  add one, in either direction.**
- **Never a page-and-sum, never an N+1.** No transaction row is ever fetched by
  this endpoint. The service's only arithmetic is re-adding numbers SQL already
  produced.
- **Two queries, and the second is a reused one.** The roll-up and every display
  value come from `CategoryRepository#findByUserIdOrderByCreatedAtAscNameAsc` —
  the exact method Domain 3's list endpoint already uses, so no new query shape
  was introduced and the parent/child resolution is the same one §4.1's filter
  uses. The aggregate runs **first**, so a zero-spend range short-circuits to
  `{ totalSpent: 0.00, categories: [] }` after one query.
- **Display values come from the CATEGORY row, not from the transaction
  snapshots** (ADR 0022 §3). This is a live aggregate over current categories,
  not a historical record — and grouping by a snapshot *name* would silently
  merge two same-named leaves under different parents, which ADR 0019 §3
  deliberately allows to exist. ~~One visible consequence while ADR 0021's
  rename propagation is unimplemented: rename a category and this endpoint shows
  the NEW name while `GET /transactions` still shows the OLD snapshot.~~
  **CLOSED on 2026-10-25 (§12.10): the propagating `PATCH` has landed, so both
  sources now show the new name** — which is the state ADR 0022 §3 assumed when
  it said the two "agree anyway". Nothing in this endpoint changed to close it.
- **`totalSpent` is summed from the very entries that are returned**, not from a
  second independent query that could drift (ADR 0022 §4). Each leaf group lands
  in exactly one parent slice, and the total adds the *parents* up — so a
  subcategory's amount appears twice in the payload (its own entry and its
  parent's roll-up) but is counted **once** in the total. That is why
  `totalSpent = Σ categories[].amount` holds by construction rather than by
  agreement.
- **Ordering is applied in the service, deliberately, and is a total order.**
  §14.1's order is defined over *rolled-up* amounts, and a parent's amount is
  not known until its children are folded in — so an `ORDER BY` on the leaf
  groups would be a sort whose result is discarded. The comparator is
  `amount desc, categoryName asc (case-insensitive), categoryId asc` at both
  levels. Note the shape: `comparing(...).reversed().thenComparing(...)`
  reverses only the amount key — chaining first and reversing last would reverse
  the tie-breaks too.
- **Two response types, not one recursive type.** `CategorySpend` carries
  `subcategories`; `SubcategorySpend` has no such component at all — which is
  what §14.1's documented JSON shows for a child, and what makes ADR 0019 §2's
  one-level rule structural rather than conventional. A third level is not
  expressible in the DTO.
- **No `percentage`, no `transactionCount`, no currency field, and no "direct
  spend" field.** Each absence is a named decision (ADR 0022 §3/§4/§6,
  ADR 0017's Scope Narrowing banner), recorded in the DTO's own Javadoc so none
  of them is later filed as a gap.
- **Bean Validation on the query DTO, reusing Domain 4's mechanism.**
  `CategoryStatisticsQuery` is a bound `@ModelAttribute`, so failures surface
  through the API-wide `BindException` handler Domain 4 added to
  `GlobalExceptionHandler` for validated **query parameters**. **No second
  mechanism and no new handler were added.** The cross-field
  `dateFrom <= dateTo` rule is an `@AssertTrue` on a derived property, so it is
  reported in the same `fieldErrors` shape as a single-field failure and needed
  no new exception type.
- **Injection hardening** (`security-architecture.md` §12). One fixed,
  developer-written JPQL query; both date bounds are typed bound parameters and a
  `null` disables its clause. No native SQL, no string concatenation, nothing
  from client input becoming a field or table name, and **no `sort` parameter at
  all**.
- **Owner scoping binds `:userId` twice** — once for the transactions and once
  for the categories they join to. The second is not redundant:
  `fk_transactions_category_id` guarantees the category *exists*, not that the
  caller owns it (`V7__transactions.sql`'s own note), so without
  `c.user_id = :userId` one account's category row could supply the grouping key
  for another's spend.
- **Rate limiting.** The default per-user tier, inherited from
  `ApiRateLimitFilter` — **confirmed to cover this path, not assumed** (§6):
  the filter keys off every `/api/v1/**` path except `/api/v1/auth/**`.
  `SecurityConfig` gained one explicit `requestMatchers` line for
  `/api/v1/statistics/**`, matching how `/users/**`, `/categories/**` and
  `/transactions/**` are declared.
- **Nothing on this path logs.** Consistent with every other read in this API,
  and specifically correct here: a per-category spend breakdown and its total
  are **personal financial information**, which constitution §23 forbids
  logging. Unexpected exceptions are still logged centrally by
  `GlobalExceptionHandler`.
- **No premium gate anywhere**, and no `users.is_premium` read at all — not even
  an unused one (ADR 0022 §7, following ADR 0017 §1's precedent).
- **The rollback trap (§3, points 3 and 4) cannot apply** — the single
  `@Transactional` is `readOnly = true` and nothing writes. If anything here
  ever needs to write, that is the signal to re-read ADR 0022 §8: a cached or
  materialized aggregate was explicitly rejected, with a measured-bottleneck
  revisit trigger.
- **No new dependency, no new table, no new column, no migration.**
  `ddl-auto=validate` is on and no entity was touched.

### 14.6 Key assumptions — Statistics

Flagged rather than absorbed, since each is a real decision §14.1 does not pin:

- **Name ties are compared case-insensitively.** §14.1 says "ties by
  `categoryName` ascending" without naming a collation, and plain code-point
  order would put `Zebra` before `apple` in a user-facing legend. Because
  sibling names are unique case-insensitively (ADR 0018 §6, ADR 0019 §3), this
  comparison cannot itself create a tie between two real siblings.
- **`categoryId` is a third, contract-free tie-break** so the output is a
  **total** order. The contract's stated reason for specifying an order is that
  identical requests must not reshuffle, and two keys only achieve that if no
  two entries can tie on both. Same reasoning as Domain 4's trailing `id desc`.
- **`dateFrom`/`dateTo` are echoed back as supplied, i.e. `null` when omitted.**
  §14.1's example shows both populated and its zero case shows the keys present;
  present-and-`null` follows the uniform key-set convention (ADR 0003 §2) rather
  than omitting the keys. Flag back if the server was expected to *resolve* an
  omitted bound to the caller's first/last transaction date — it deliberately
  does not invent one.
- **A reversed range is a `400` here but a legal empty range on `GET
  /transactions`** (§13.10). Not an inconsistency to "fix": §14.1 defines
  `400 VALIDATION_ERROR` for `dateFrom > dateTo` explicitly and §4.1 defines no
  error for it, and ADR 0022 follow-up item 8 asks for the validation by name.
- **The `@AssertTrue` property is named `dateRangeValid`**, so that is what
  appears in `fieldErrors[].field` rather than `dateFrom`/`dateTo`. The message
  (`"dateFrom must not be later than dateTo"`) carries the instruction. A
  dedicated class-level constraint annotation could name the field precisely;
  that is two more files for a cosmetic gain and was declined.
- **Amount scale is whatever `sum(numeric(12,2))` returns** (two decimal places
  in PostgreSQL), passed through untouched. Only the **zero** total is
  constructed, as `0.00`. Deliberately no `setScale`/rounding call anywhere: the
  sum of exact two-decimal values is already exact, and a rounding call on money
  either silently rounds or throws, both worse than passing the exact value
  through.
- **An unresolvable leaf category is skipped; a subcategory with an
  unresolvable parent is emitted as its own top-level slice.** Both are
  impossible through the API (the aggregate's own join requires the leaf to be
  one of the caller's categories, and the composite FK
  `(user_id, parent_category_id) → (user_id, id)` guarantees the parent is too) —
  they would need a category deleted *between* the two queries. The asymmetry is
  deliberate: the first case cannot break the sum invariant because the total is
  summed from the emitted slices, and the second preserves the money rather than
  dropping it, degrading the shape instead. Same "silently absent rather than
  crashing" treatment `CategoryService#toTree` documents for impossible states.
- **Unknown query parameters are ignored**, as everywhere in this API — so
  `?type=income`, `?scope=group`, `?budgetPeriodId=…` and `?sort=amount` are all
  no-ops rather than errors. Worth knowing before reading a passing
  `?type=income` call as income support: **there is no `type` parameter**, and
  the response is identical to the one without it.
- **A valid token whose `user_id` no longer exists returns `401 UNAUTHORIZED`**,
  same as Domains 2–4.
- ~~**⚠ `GET /statistics/categories` shows a renamed category's NEW name while
  `GET /transactions` still shows the OLD snapshot**~~ — **RESOLVED 2026-10-25
  by §12.10**, which implements ADR 0021's rename propagation. Both sources now
  show the new name, which is the state ADR 0022 §3 assumed when it said the two
  "agree anyway". This endpoint is unchanged and still follows §14.1 as written —
  display values come from the category row. Do not "fix" the (now non-existent)
  gap by grouping on the transaction snapshot: that would merge two same-named
  leaves under different parents and freeze deleted categories into the chart.
- **A category DELETE moves spend into `Misc` rather than removing it**
  (§12.10). `totalSpent` over a range is therefore unchanged by a delete — the
  slices redistribute. Worth knowing before filing it as an arithmetic bug.

### 14.7 Not verified in the session that wrote this

**No shell access, so: not compiled, not run, no live request issued, and
Domains 1–4 not run.** The statically-unverifiable items, in rough order of
risk:

> **Later session, 2026-10-29.** The Project Owner has since run this endpoint
> live. Item 2 **actually failed with a `500`** and has been fixed; item 1's
> three parts are confirmed working by the same pass. Both are rewritten below.
> Nothing else in this list has been re-stated.

1. **That `aggregateSpendByCategory`'s JPQL parses, binds and groups as
   intended.** `@Query` JPQL is validated when the context starts, so a mistake
   is a **boot failure**, not a runtime surprise. Three genuinely new parts:
   (a) the **constructor expression** `select new
   com.myexpense.backend.repository.CategorySpendRow(...)` into a **record** —
   Hibernate 6+ supports record dynamic instantiation, but this project has no
   other instance of it. If it fails, the mechanical fallback is a Spring Data
   interface projection with aliased select items, or `List<Object[]>`;
   (b) the **two-root theta join** `from Transaction t, Category c where
   c.id = t.categoryId` — plain JPQL rather than Hibernate's `join … on` entity
   join, chosen precisely because it is the more conservative of the two;
   (c) `sum(t.amount)` typing to `BigDecimal` in the record component.
2. **RESOLVED (2026-10-29) — the `(:dateFrom is null or …)` idiom with
   `LocalDate` parameters DID NOT bind. It is fixed; do not reintroduce it.**
   `GET /statistics/categories?dateFrom=…&dateTo=…` returned
   `500 INTERNAL_ERROR` for every valid range (undated requests were fine, which
   is why the correct roll-up was verified before the bug surfaced). PostgreSQL
   rejected this very statement at parse time with
   `ERROR: could not determine data type of parameter $3` — this aggregate's own
   SQL is the statement quoted verbatim in **§13.11 item 1**, which carries the
   full cause, the fix, the rule and the rejected alternatives. Both clauses are
   now `t.txnDate >= coalesce(:dateFrom, t.txnDate)` /
   `t.txnDate <= coalesce(:dateTo, t.txnDate)`, bound once each and typed by the
   column beside them; `txn_date` is `DATE NOT NULL`, so an omitted bound is a
   no-op clause and both bounds stay inclusive. The response shape, the
   expenses-only join, the `GROUP BY` and the service-side roll-up and ordering
   are untouched. Item 1's parts (a)–(c) — the record constructor expression,
   the theta join and `sum(t.amount)` → `BigDecimal` — are confirmed working by
   the live undated roll-up.
3. **That `@Valid @ModelAttribute CategoryStatisticsQuery` reports failures as a
   `BindException`** and so lands on Domain 4's handler. Same unverified item as
   §13.11 item 5, with the same visible fallback: a `500 INTERNAL_ERROR` with a
   logged stack trace on `?dateFrom=garbage` means the thrown type is something
   neither handler covers. Worth knowing before chasing it: whichever of the two
   it is, **the response is identical** —
   `MethodArgumentNotValidException` is a subclass of `BindException` and
   `GlobalExceptionHandler` maps both to the same
   `400 VALIDATION_ERROR` + `fieldErrors` body.
4. **That the `@AssertTrue` on `isDateRangeValid()` surfaces as a FIELD error**
   rather than a global one. `GlobalExceptionHandler#handleBinding` reads
   `getFieldErrors()`, so if Spring reports it as an object-level error the
   response is still `400 VALIDATION_ERROR` but with an **empty** `fieldErrors`
   array. The status and the error code — the parts clients branch on — are
   correct either way.
5. **That the roll-up arithmetic is right on real rows.** §14.1's seven checks
   and §14.4's four SQL statements exist for exactly this; the `4200/5000` pair
   is the one to compute by hand.
6. **That `0.00` serializes as `0.00`** rather than `0` through Jackson 3's
   `BigDecimal` handling. Cosmetic, not a correctness problem, but the frontend
   formats it.
7. **That `LocalDate` serializes as `"2026-10-01"`** in this response. Already
   true for `txnDate` in Domain 4 — same mapper, same type — but Domain 4 has
   not been run either.
8. **Performance against realistic row counts.** No `EXPLAIN ANALYZE` has been
   run and the deferred index was deliberately **not** requested — see §14.8.
9. **That the Postman collection's JSON parses** and that requests 75+ chain
   their variables correctly (`foodCategoryId`, `transportCategoryId`,
   `subcategoryId` from Domain 3; the three expense rows created in request 75).

### 14.8 Not done / follow-ups — Statistics

- **`transactions(user_id, category_id, txn_date)` is NOT requested.**
  `V7__transactions.sql` already names it as a deliberate deferral — for this
  query, §4.1's `categoryId` filter and Domain 5's sums — and says to measure it
  with `EXPLAIN ANALYZE` rather than guess. ADR 0022 §8 keeps that position:
  **add it once, in its own migration, when one of those three paths is
  measured** — not pre-emptively, and not three times. That is a Database
  Architect request to raise *with a measurement attached*.
- **No cached or materialized aggregate**, rejected for now with a
  measured-bottleneck revisit trigger (ADR 0022 §8). It would need invalidating
  on five write paths — transaction create/edit/delete, category rename,
  category delete — to answer a question one indexed `GROUP BY` answers.
- **Nothing is added to `/sync/push` or `/sync/pull`** (ADR 0022's offline-first
  section). There is nothing to write, and a *pulled* aggregate would be stale
  the moment any local write happened. Offline, the Statistics tab shows its
  offline state rather than a locally computed chart — computing one from a
  paginated local cache is the "derive a total from a page" error §6 forbids.
- **No automated tests**, consistent with Domains 1–4.
- **`docs/api/api-overview.md` §14's Status cell still says "Not started"** and
  `docs/roadmap/backend-build-order.md` has no row for this endpoint. Both files
  are System-Architect-owned, so they were deliberately not edited; they need
  updating once the Project Owner's testing pass confirms this.
- **Open questions that are the Project Owner's / System Architect's, not
  this endpoint's** (ADR 0022's own list): what range the Statistics tab opens
  on (a product default — the contract takes any range), whether this is
  sequenced before Domain 5, and the charting-library §21 evaluation, which is
  the Frontend Engineer's to raise. **A future `/statistics` sibling (spend over
  time, by payment mode) is a new path, never extra fields on this response.**

---

## 15. Domain 6 sub-steps 1 and 2 — Contacts and Groups

**Seven** endpoints, implemented exactly to `docs/api/api-overview.md` §6.1–§6.3
and §7.1–§7.4, against `database/migrations/V9__contacts.sql` and
`V10__groups.sql` as amended by
`docs/decisions/0023-shared-ledger-contract-corrections.md`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/contacts` | List the caller's contacts (owner-scoped) |
| POST | `/api/v1/contacts` | Create a contact — may auto-link, or trigger an SMS invite |
| POST | `/api/v1/contacts/{id}/invite` | Resend an SMS invite (owner-scoped) |
| GET | `/api/v1/groups` | List groups the caller belongs to |
| POST | `/api/v1/groups` | Create a group |
| GET | `/api/v1/groups/{id}` | Fetch one group (membership-gated) |
| POST | `/api/v1/groups/{id}/members` | Add a member (membership-gated) |

**Split expenses (§9) and settle up (§10) are NOT implemented** — sub-steps 3
and 4, their own pass. `individual_balances`, `split_expenses`,
`split_expense_participants` and `settlements` have no entity, no repository and
no endpoint here.

> ⚠ **NO MIGRATION HAS EVER BEEN APPLIED.** Flyway's history ends at `V6`, so
> `V7`–`V13` all run on the next boot and `ddl-auto=validate` will check every
> entity in this section against a schema that has never existed. The schema on
> disk is authoritative but unverified. If the first boot fails, read §15.7
> before changing anything — the entity mappings were written against the
> migration files line by line, so a validate failure is more likely to be a
> missing migration than a wrong `@Column`.

> ⚠ **This section's endpoints sit on top of Domain 4, which has never been run
> either** (§13.11). Nothing here reads or writes `transactions`, so the
> dependency is only the shared `users`/`categories` seed — but `V10` also adds
> `fk_transactions_group_id`, so a `transactions` row carrying a stale
> `group_id` would abort the whole migration. §15.4 has the pre-flight query.

Get a token first exactly as in §11.2; every call below uses it as `$TOKEN`.

### 15.1 Contacts — create, auto-link, and the invite trigger

```bash
# (a) a plain contact — no phone, no email. LEGAL, and it invites nobody.
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Aditi Sharma" }'
```

Expect `201` and `"initials": "AS"`, `"linkedUserId": null`,
`"inviteStatus": null`. Three things to check:

1. **`initials` is derived, not submitted** — first letter of the first word plus
   first letter of the last word, uppercased (`docs/ui/design-system.md`). A
   single-word name gives one letter (`"Aditi"` → `"A"`). Sending
   `"initials": "ZZ"` in the body changes nothing: the DTO has no such property.
2. **`inviteStatus` is `null`, not absent.** No phone was submitted, so no
   invite was applicable (§6.2). The key is always present on this response and
   always absent from `GET /contacts`.
3. **No duplicate rule.** Run the same request twice — both succeed. `V9` adds
   no uniqueness and §6.2 defines no duplicate error; two contacts with one name
   are real data.

```bash
# (b) a contact with an UNMATCHED phone -> the invite fires
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Rahul Mehta", "phone": "+919876500001" }'
```

Expect `201`, `"linkedUserId": null`, **`"inviteStatus": "sent"`**, and this in
the application log:

```
[DEV SMS STUB] Invite SMS would be sent to ****0001 with download link ... at ...
```

**No real SMS is sent.** `LoggingSmsInviteGateway` is a deliberate stub —
see §15.5. It reports success on purpose, so the cooldown it starts is real and
testable.

```bash
# (c) a contact whose phone MATCHES a registered account -> auto-link, no invite
# First give a second account a phone (as that account):
curl -s -X PATCH http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{ "phone": "+919876500002" }'

# Then, as the FIRST account:
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Second Account", "phone": "+919876500002" }'
```

Expect `201`, **`linkedUserId` = account 2's id**, and
**`"inviteStatus": null`** — a linked contact is already a user, so there is
nobody to invite. The log shows no `[DEV SMS STUB]` line for this one.

```bash
# (d) email auto-link — the other independent lookup
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "By Email", "email": "TEST2@EXAMPLE.COM" }'
```

Expect `linkedUserId` set despite the different case: `users.email` is stored
lowercased and the probe is lowercased, while `contacts.email` keeps exactly
what was typed so §6.1 echoes it back. **An unmatched email triggers nothing** —
email invites are explicitly out of scope for ADR 0015.

```bash
# (e) validation
# a local-format phone -> 400 VALIDATION_ERROR (see §15.6, assumption 1)
curl -i -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Local Number", "phone": "09876543210" }'

# a blank name -> 400, before the database's chk_contacts_name_not_blank
curl -i -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "   " }'

# an empty-string phone is treated as ABSENT, not as a bad value -> 201
curl -i -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Empty Phone", "phone": "" }'
```

### 15.2 The invite limits — the part most worth testing

This is the strictest-limited endpoint in the API
(`security-architecture.md` §11), and **four** limits apply. Each one is
observable:

```bash
# THE PER-PHONE COOLDOWN. Re-invite the contact from 15.1(b) immediately:
curl -s -X POST http://localhost:8080/api/v1/contacts/<RAHUL id>/invite \
  -H "Authorization: Bearer $TOKEN"
```

Expect `200` with
`{ "status": "cooldown_active", "nextAllowedAt": "<the first send + 24h>" }` and
**no new `[DEV SMS STUB]` line**.

Now the part that makes this limit different from every other one in the API:

```bash
# As a DIFFERENT account, create a contact with the SAME number.
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{ "name": "Same Number", "phone": "+919876500001" }'
```

Expect `201` with **`"inviteStatus": "cooldown_active"`** — a *second user* is
refused a send to a number *someone else* texted. That is the whole point of
ADR 0015 §4's limit 2, and a per-user cap would not catch it. Note the contact
is still created: an invite never fails its parent request.

```bash
# THE PER-USER CAP. 20 attempts per rolling 24h, counting FAILURES too.
# Create 20 contacts with 20 different unmatched numbers, then a 21st:
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Number 21", "phone": "+919876500021" }'
```

Expect `201` with `"inviteStatus": "cooldown_active"` — **and this is the one
response in this domain that is deliberately imprecise.** The real outcome is
`rate_limited`, which §6.2's enumeration does not contain. See §15.6,
assumption 4. On §6.3 the same condition reports honestly:

```bash
curl -s -X POST http://localhost:8080/api/v1/contacts/<ANY unlinked id>/invite \
  -H "Authorization: Bearer $TOKEN"
# -> { "status": "rate_limited", "nextAllowedAt": "<oldest attempt + 24h>" }
```

```bash
# THE TWO TOKEN BUCKETS, on the explicit endpoint only. Six calls in a row:
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8080/api/v1/contacts/<ANY id>/invite \
    -H "Authorization: Bearer $TOKEN"
done
# -> 200 200 200 200 200 429
```

The 6th is `429 RATE_LIMIT_EXCEEDED`. **The same six calls against
`POST /contacts` must all return `201`** — the buckets are deliberately not on
the implicit paths, because a `429` there would fail a contact creation because
of an invite, which ADR 0015 §4 forbids.

```bash
# THE TWO ERRORS on §6.3
# a contact with no phone -> 400 NO_PHONE_ON_CONTACT (not 404: it exists and is yours)
curl -i -X POST http://localhost:8080/api/v1/contacts/<ADITI id>/invite \
  -H "Authorization: Bearer $TOKEN"

# another user's contact, and a nonexistent one -> 404 CONTACT_NOT_FOUND, identically
curl -i -X POST http://localhost:8080/api/v1/contacts/<ACCOUNT 2's contact id>/invite \
  -H "Authorization: Bearer $TOKEN"

# an already-linked contact -> 200 already_linked, which is NOT an error
curl -i -X POST http://localhost:8080/api/v1/contacts/<SECOND ACCOUNT contact id>/invite \
  -H "Authorization: Bearer $TOKEN"
```

### 15.3 Groups — membership, not ownership

```bash
# (a) a group with one unlinked and one linked member
curl -s -X POST http://localhost:8080/api/v1/groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Goa Trip",
        "memberContactIds": ["<RAHUL id>", "<SECOND ACCOUNT contact id>"] }'
```

Expect `201` and **three** members, which is the first thing to check:

```json
{
  "id": "...", "name": "Goa Trip", "createdByUserId": "<caller>",
  "lastActivity": null,
  "members": [
    { "userId": "<caller>",  "invitedContactId": null,        "name": "Het Patel",     "role": "member" },
    { "userId": null,        "invitedContactId": "<RAHUL id>", "name": "Rahul Mehta",  "role": "member" },
    { "userId": "<account2>","invitedContactId": null,        "name": "Second Account","role": "member" }
  ],
  "yourBalance": 0.00
}
```

Five rules in that one response:

1. **The creator is always a member**, with `role: "member"`. There is no
   `'owner'` role this phase and `createdByUserId` grants nothing.
2. **The linked contact joined as a USER** — `userId` set,
   `invitedContactId` null — while the unlinked one joined as a contact
   placeholder. Which column is filled is the server's decision, never the
   client's (§7.2/§7.4). That asymmetry is the shared ledger working.
3. **`name` is resolved server-side**, from the user's `firstName + lastName` or
   the contact's `name`. Nothing is snapshotted, so a rename shows up here
   immediately — deliberately unlike `split_expense_participants` (V11), where
   the name *is* frozen.
4. **`yourBalance` is `0.00`, viewer-relative, and a real read** of the caller's
   own `group_member_balances` row — not a hardcoded zero. §15.4 proves the row
   exists.
5. **One `[DEV SMS STUB]` line, for Rahul only.** The linked member is already a
   user, and Rahul was mid-cooldown if you ran §15.2 — in which case there is no
   line at all and the member is still added, exactly as §7.2 specifies.

```bash
# (b) the membership gate. As ACCOUNT 2 (a member), the group is visible:
curl -i http://localhost:8080/api/v1/groups/<GROUP id> -H "Authorization: Bearer $TOKEN2"
# -> 200, and account 2's own yourBalance (also 0.00)

# As a THIRD account that is not a member:
curl -i http://localhost:8080/api/v1/groups/<GROUP id> -H "Authorization: Bearer $TOKEN3"
# -> 404 GROUP_NOT_FOUND. NEVER 403, and byte-identical to a nonexistent id:
curl -i http://localhost:8080/api/v1/groups/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN3"
```

**The two responses must be indistinguishable.** A `403` — or a different
message — would confirm to a non-member that the group is real
(`security-architecture.md` §2). The same applies to `GET /groups`, which for
account 3 returns `[]` rather than an error.

```bash
# (c) add a member — and the three errors that are NOT interchangeable
curl -i -X POST http://localhost:8080/api/v1/groups/<GROUP id>/members \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "contactId": "<ADITI id>" }'
# -> 201 GroupMemberResponse

# the SAME contact again -> 409 ALREADY_A_MEMBER
curl -i -X POST http://localhost:8080/api/v1/groups/<GROUP id>/members \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "contactId": "<ADITI id>" }'

# a contact that is not the caller's own -> 400 CONTACT_NOT_FOUND. A 400 HERE,
# where §7.2's equivalent is a 404. Not a typo — V10's mapping table says so.
curl -i -X POST http://localhost:8080/api/v1/groups/<GROUP id>/members \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "contactId": "<ACCOUNT 2's contact id>" }'

# a non-member trying to add anyone -> 404 GROUP_NOT_FOUND, not 403
curl -i -X POST http://localhost:8080/api/v1/groups/<GROUP id>/members \
  -H "Authorization: Bearer $TOKEN3" -H "Content-Type: application/json" \
  -d '{ "contactId": "<account 3 contact id>" }'

# §7.2's own 404: an unknown or other-user id in memberContactIds
curl -i -X POST http://localhost:8080/api/v1/groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Bad Members", "memberContactIds": ["<ACCOUNT 2 contact id>"] }'
# -> 404 CONTACT_NOT_FOUND, and NO group is created (one transaction)
```

```bash
# (d) the de-duplication case §7.2 deliberately does not error on
curl -i -X POST http://localhost:8080/api/v1/groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Duplicates", "memberContactIds": ["<RAHUL id>", "<RAHUL id>"] }'
```

Expect `201` with **two** members (the creator and Rahul once). §7.2's error
table has no `409`, so a duplicate member key is de-duplicated rather than
rejected — see §15.6, assumption 5. The same collapse happens for two
*different* contacts linked to one account, and for a contact linked to the
caller themselves.

### 15.4 The DB checks to run

Connect as in §2 (`psql` is not on the PATH — use pgAdmin or the full binary
path) and run these against the account you tested with.

```sql
-- 0. BEFORE THE FIRST BOOT: V10 adds fk_transactions_group_id and validates it
--    against every existing row. Expect 0; a non-zero count aborts the
--    migration, and V10 says to resolve each row BY HAND rather than nulling it.
SELECT count(*) FROM transactions t
 WHERE t.group_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = t.group_id);

-- 1. The contact. initials is server-derived; phone/email are NOT unique.
SELECT id, name, initials, phone, email, linked_user_id
  FROM contacts WHERE owner_user_id = '<userId>' ORDER BY name;

-- 2. THE INVITE LEDGER — one row per attempt, never updated in place.
--    A 'sent' row has a sent_at; a 'failed' row does NOT. There is no
--    attempt_count column and there must never be one again.
SELECT id, contact_id, phone, status, sent_at, created_at
  FROM contact_invites WHERE invited_by_user_id = '<userId>'
 ORDER BY created_at;

-- 3. "How many times was this contact invited" — now a COUNT(*), because
--    attempt_count was dropped (ADR 0023 §5.3).
SELECT contact_id, count(*) FROM contact_invites
 WHERE contact_id = '<contactId>' GROUP BY contact_id;

-- 4. The cooldown's own query, the one that must never be approximate.
SELECT count(*) FROM contact_invites
 WHERE phone = '+919876500001' AND sent_at >= now() - interval '24 hours';
SELECT max(sent_at) FROM contact_invites WHERE phone = '+919876500001';

-- 5. The per-user cap's query. Counts ATTEMPTS, including failures.
SELECT count(*) FROM contact_invites
 WHERE invited_by_user_id = '<userId>' AND created_at >= now() - interval '24 hours';

-- 6. MEMBERSHIP — exactly one of user_id/invited_contact_id per row.
SELECT id, user_id, invited_contact_id, role, created_at
  FROM group_members WHERE group_id = '<groupId>' ORDER BY created_at;

-- 7. *** THE CHECK THAT MATTERS MOST: ONE BALANCE ROW PER MEMBER, BOTH KINDS ***
--    This is what ADR 0023 §2's reshape exists for. Before it, the contact
--    member's row could not exist at all.
SELECT id, user_id, invited_contact_id, balance, updated_at
  FROM group_member_balances WHERE group_id = '<groupId>';
--    Expect one row per group_members row, every balance 0.00, and the contact
--    member's row carrying invited_contact_id with user_id NULL.

-- 8. THE ZERO-SUM RECONCILIATION QUERY (V10's CONCURRENCY block, check 1).
--    This must return NO ROWS, for every group, always.
SELECT b.group_id, sum(b.balance) AS net
  FROM group_member_balances AS b
 GROUP BY b.group_id
HAVING sum(b.balance) <> 0;

-- 9. The membership/balance row-count agreement the service also asserts.
SELECT g.id,
       (SELECT count(*) FROM group_members m WHERE m.group_id = g.id)          AS members,
       (SELECT count(*) FROM group_member_balances b WHERE b.group_id = g.id)  AS balances
  FROM groups g;
--    The two columns must be equal on every row.
```

Checks 8 and 9 are the two the service runs itself, in the same transaction as
every group write — see §15.5. Running them by hand after a test session proves
the assertion is actually wired, not merely written.

### 15.5 Implementation notes

**1. The balance serialisation mechanism: RELATIVE DELTAS, not row locks.**
`V10`'s CONCURRENCY block offers two options and insists one be picked
deliberately. This implementation uses **(b)**:
`INSERT ... ON CONFLICT (group_id, user_id) DO UPDATE SET balance =
group_member_balances.balance + excluded.balance`. `SELECT ... FOR UPDATE` is
**deliberately absent** from `GroupMemberBalanceRepository` and must not be
added — mixing the two is what `V10` warns against. Three reasons, in the order
that decided it: a delta *removes* the read-modify-write cycle rather than
guarding it, so the classic lost update is unrepresentable instead of merely
unlikely; it is the shape partial settlement already needs (ADR 0023 §4 moves
both sides of a group settlement by the same amount); and it is the same
expression the mandated upsert uses, so resolve-or-create and apply-a-delta are
one statement rather than two code paths that must agree. **The accepted cost:**
a relative write cannot *re-derive* a balance from the ledger, which is the one
case `V10` says option (a) would be necessary for. Nothing in §6–§10 re-derives;
if a "recompute this group from its ledger rows" pass is ever built it must
change this decision explicitly, in one place.

**2. Two upsert statements, one per member kind, and they cannot be merged.** An
`ON CONFLICT` clause names exactly one inference target. A registered member's
row can only collide on `(group_id, user_id)`, a contact member's only on
`(group_id, invited_contact_id)`; a single INSERT over both kinds would leave one
collision unhandled and raise a raw `23505`. Each statement filters with
`IS NOT NULL` so it sees only the rows its own target applies to. Both use a
**bare column list**, which works because `V10`'s two keys are plain `UNIQUE`
constraints rather than partial indexes — there is no predicate to repeat (the
trap `V11` records for `individual_balances`).

**3. Both statements are `INSERT ... SELECT` over `group_members`**, so they are
two statements for any number of members rather than one per member. They are
the first native SQL in this backend, and the reason is specific: `ON CONFLICT`
has no JPQL equivalent. Both are fixed developer-written text with typed bound
parameters — nothing concatenated, nothing from client input. They are also the
one place that departs from the application-assigned-id convention: a multi-row
`INSERT ... SELECT` needs a distinct id *per generated row*, so `id` is omitted
and the column's `DEFAULT gen_random_uuid()` supplies it.

**4. The zero-sum assertion runs in the same transaction as every group write**
(ADR 0023 Backend follow-up item 8), together with a **second** check that is
not optional: *every member has exactly one balance row*. Both are needed because
they catch different bugs — **zero-sum alone cannot detect a missed member while
every balance is `0.00`**, since a sum over fewer rows is still zero, and the
row-count check cannot detect a lost update once real money moves. A violation
throws, which rolls the write back; that is the intended outcome, and it is the
one place in this domain where `noRollbackFor` would be actively wrong.
Configurable via `app.groups.assert-balance-consistency`, default **on**.

**5. Why §6/§7 write balances at all** — a derived decision, flagged in §15.6.
Neither §7.2 nor §7.4 mentions a balance. It follows from ADR 0023 §2: the
invariant "is only checkable if *every* member's share has a row". A row at
`0.00` is not fabricated money, it is the true position of a member who has
participated in nothing, and it makes `yourBalance` a real read rather than a
`coalesce` that would hide a genuinely missing row.

**6. `contact_invites` is written in exactly two statements, in that order.**
`chk_contact_invites_sent_at_matches_status` enforces
`(status = 'sent') = (sent_at IS NOT NULL)`, so a row cannot be inserted as
`'sent'` before the gateway's timestamp exists. `ContactInviteService#dispatch`
INSERTs as `queued` with a null `sent_at`, calls the gateway, then UPDATEs to
`sent` with the gateway's own time or to `failed` leaving `sent_at` null. Nothing
else in the backend writes this table, and no code path ever updates an older
row — one row per attempt (ADR 0023 §5.3). `sent_at` maps to
`OffsetDateTime`, never a primitive: an epoch default written in place of `NULL`
would violate the CHECK *and* poison the cooldown window.

**7. Four limits on the invite path, in two layers, all four required.** The
database counts **sends** (per-phone cooldown, per-user rolling cap); two token
buckets count **requests** on `POST /contacts/{id}/invite` only. They are not
redundant: a call answering `already_linked` or `cooldown_active` writes no row
and is invisible to the caps while still costing a request. The buckets reuse the
existing `RateLimiter` — **no new table and no new dependency** — exactly as
`app.ratelimit.auth.register` already expresses a 5-per-3600 s window. They are
applied *only* to the explicit endpoint, because a `429` on an implicit trigger
would fail a contact or membership write because of an invite, which ADR 0015 §4
forbids.

**8. A PostgreSQL advisory lock closes the cooldown's concurrency window.**
`V9` requires both limits inside the same transaction as the insert, "or two
concurrent requests both pass a check that was true when each read it" — and one
transaction does not achieve that on its own: under `READ COMMITTED` a
`COUNT(*)` cannot see a sibling's uncommitted row, and `V9` forbids the unique
constraint that would otherwise arbitrate. `pg_try_advisory_xact_lock` keyed on
an FNV-1a 64-bit hash of the phone number is taken first; a `false` answer means
a send to that very number is in flight, which *is* `cooldown_active`. The
**`try`** form, not the blocking one, so it cannot deadlock when one
`POST /groups` invites several numbers in a single transaction. **This is the
only lock in this domain and it never touches a balance table** — the two
mechanisms stay unmixed.

**9. The rollback audit, path by path.** `backend/README.md` §3 records how a
method that writes and *then* throws silently broke account lockout and
token-family revocation in Domain 1, and ADR 0023 flagged this domain as the
next place that trap waits. **No `noRollbackFor` is used anywhere in this
domain, and that is a conclusion rather than an omission:** every user-facing
rejection on all seven endpoints is decided *before* the first write (the `429`,
both `CONTACT_NOT_FOUND` forms, `GROUP_NOT_FOUND`, `ALREADY_A_MEMBER`,
`NO_PHONE_ON_CONTACT`, and every Bean Validation failure), and the only things
that can throw afterwards are a constraint violation (the row never landed) and
the balance assertion (where rolling back is the point). **The invite send — the
one irreversible side effect — is therefore fired last on all four triggering
paths**, after the final assertion, so no application-level rejection can follow
a real SMS. The residual risk is a commit-time failure *after* a send, which
loses the cooldown row; the honest fix is an outbox dispatched after commit, and
it is listed in §15.8 rather than improvised.

**10. Constraint name → error code, implemented exactly as `V9`/`V10` specify.**
Matched by **full** constraint name (never a prefix — the `uq_group_members_` and
`uq_group_member_balances_` families are one underscore apart), **null-safe**
(`V6`'s and `V8`'s triggers raise with no constraint name at all, on the
`categories` path in this same application), and case-folded:

| Constraint | Code |
|---|---|
| `uq_group_members_group_id_user_id` | `409 ALREADY_A_MEMBER` |
| `uq_group_members_group_id_invited_contact_id` | `409 ALREADY_A_MEMBER` |
| `fk_group_members_invited_contact_id` | **`400`** `CONTACT_NOT_FOUND` |
| `fk_group_members_group_id` | **`404`** `GROUP_NOT_FOUND` |
| everything else on these tables | rethrown → logged `500` |

The last row is deliberate: `chk_group_members_user_xor_contact` and both
`group_member_balances` uniqueness keys mean *a service rule was skipped*, and
`V10` maps them to `500`. A plausible-looking `400` would hide a real bug.

**11. `GET /contacts` and `GET /groups` are plain arrays, not `PageResponse`.**
The contract specifies `ContactResponse[]` and `GroupResponse[]`, and the
frontend's contact search is a client-side filter over the already-fetched list
(ADR 0006), so paginating would break that search rather than improve anything.
The same call `GET /categories` already made, and the same departure from
constitution §11 — flagged in §15.6.

**12. No N+1, with a fixed query budget.** `GET /groups` is five queries
regardless of how many groups the caller is in: memberships → groups → member
rows → one name lookup per *source table* → one balance read for every group at
once. `V10` contract item 3 names the alternative explicitly, and `V9` item 6
names the other one: `GET /contacts` never resolves `linked_user_id` per row, and
the group write paths resolve every `memberContactIds` entry in one query.

**13. The entity for `groups` is named `ExpenseGroup`.** `GROUP` is a reserved
word in JPQL/HQL, and the entity name is what every derived query resolves
against. The table stays `groups` (non-reserved in PostgreSQL), and the API
surface stays `group`/`groupId`/`GroupResponse` everywhere a client or a reader
meets it.

**14. `group_member_balances` maps a plain `@Id UUID id`** — not an `@IdClass`
and not an `@EmbeddedId` (`V10` contract item 4). Both `user_id` and
`invited_contact_id` are nullable reference types and no code assumes `user_id`
is present; that assumption is the bug ADR 0023 §2's reshape removed. `balance`
is `BigDecimal` against `numeric(12,2)`, never a `double` — it is compared for
equality with zero and reduced to a residual by partial settlement.

**15. No `currency_code` anywhere in this domain.** Not on a contact, not on a
group, not on a balance. Currency is a display symbol only and
`users.default_currency_code` is the single currency column in the whole schema
(ADR 0017's Scope Narrowing banner). `yourBalance` is a single number.

### 15.6 Key assumptions — Domain 6 sub-steps 1 and 2

Each of these is a place the contract was silent, self-contradictory, or
narrower than the implementation needed. **All of them are flagged for the
System Architect rather than resolved unilaterally.**

1. **`contacts.phone` is validated as STRICT E.164, where §6.2 says "E.164
   format recommended".** This can reject a payload that sentence would accept,
   so it is the most consequential assumption here. Two reasons, both
   correctness: (a) the stored string **is the cooldown's bucket key**, so
   `"+919876543210"` and `"+91 98765 43210"` would be two buckets for one
   real-world number and the limit would be bypassable by reformatting — the one
   rule ADR 0015 §4 says "must not be approximate"; (b) a non-E.164 value cannot
   do either job the field exists for, since auto-link compares it against
   `users.phone`, which §2.2 validates strictly. An empty string is normalised
   to "absent" rather than rejected. **If the Project Owner wants local formats
   accepted, that needs a normalisation rule (which country code?), not a looser
   pattern.**
2. **The invite fires only when `linkedUserId` is null**, not on §6.2's literal
   "`phone` is present and does not match any `users.phone`". Read literally, a
   contact that auto-linked by *email* and carries an unmatched number would be
   texted. The narrower rule was chosen because §6.3's own `already_linked`
   outcome is about the contact being linked rather than about the phone, because
   ADR 0015 §3's parenthetical is "(no auto-link)", and because the conservative
   direction is right for a mechanism that texts an uninvolved third party.
3. **A blocked attempt writes no `contact_invites` row.** A row records a
   dispatch attempt *made to the gateway*; `cooldown_active`, `rate_limited` and
   `already_linked` never reached one. Writing one would also be self-defeating,
   since the per-user cap counts rows and a cap-blocked call would consume the
   allowance it was just refused. A **failed** attempt *does* write a row —
   ADR 0023 §5.3 is explicit that the cap must count failures.
4. **§6.2's `inviteStatus` enumeration is missing `rate_limited`, and the gap is
   real.** §6.2 lists `'sent' | 'failed' | 'cooldown_active' | null` while §6.3
   lists five values, yet the per-user cap can block either path. A cap-blocked
   invite on `POST /contacts` is therefore reported as **`cooldown_active`**: it
   never claims a send happened, and it is the only one of §6.2's four values
   that means "not sent now, try later". `'failed'` was rejected (a client reads
   it as "retry now", which will be refused again) and so was `null` (it means
   "no invite was applicable", and one very much was).
   **Recommendation: add `'rate_limited'` to §6.2's enumeration** — it is
   additive, and §6.3 already has it.
5. **A duplicate member key in `POST /groups` is de-duplicated, not rejected.**
   §7.2's error table defines `400` and `404` and **no `409`**, so raising
   `ALREADY_A_MEMBER` there would be inventing an error. Three real inputs
   collapse this way: the same contact id twice; two different contacts linked to
   one account (which `V9` explicitly permits); and **a contact linked to the
   caller themselves** — `V9`'s FLAG 1, still unresolved — where the creator's
   own row is the duplicate. §7.4, which *does* define a `409`, raises it.
6. **Membership writes create a `0.00` balance row per member.** Derived from
   ADR 0023 §2's checkability argument; see §15.5 note 5. If the System Architect
   would rather balance rows appeared only when money first moves, the zero-sum
   check becomes unverifiable again for exactly the reason that ADR rejected.
7. **`memberContactIds` is capped at 50 entries.** §7.2 states no maximum, but
   this is the only field in the API where one request can trigger many SMS
   sends. 50 is well above both any real group and the per-user send cap, so it
   can never bind a legitimate request — the invite caps stay the real control.
8. **List ordering is chosen, not specified.** Contacts by `name, id`; groups by
   `name, id`; members by `created_at, id` (which puts the creator first). Some
   total order is mandatory for a stable list, and `id` is the tie-break because
   neither table has a uniqueness rule on its name. `groups.last_activity` would
   be the natural recency sort but it is free text, not a timestamp.
9. **§7.4's response carries no `inviteStatus`**, although it fires the same
   trigger as §6.2. The contract's shape has no such field, so the outcome is
   logged rather than returned. A real asymmetry, left as the contract has it.
10. **`members[].name` for a registered member is `firstName + " " + lastName`.**
    §7.1 says "the linked user's `firstName + lastName`" without specifying the
    separator.
11. **An unresolvable member name falls back to `""`.** Unreachable by
    construction — both FKs are `NO ACTION`, so neither referenced row can be
    deleted while a membership points at it.
12. **Nothing writes `groups.last_activity`.** It is `null` on every group this
    sub-step creates; `V10` assigns it to the V11/V12 write paths.

### 15.7 Not verified in the session that wrote this

**Nothing in this section has been compiled or run.** There was no shell in that
session, so every statement below is a static reading of the migrations and the
contract, not an observation:

1. **That it compiles.** No `mvn` invocation happened.
2. **That `ddl-auto=validate` passes.** `V7`–`V13` have never been applied, so
   the five new entities have never been checked against a real schema. Column
   names and types were read off `V9`/`V10` line by line, but `validate`
   inspects neither CHECK constraints nor uniqueness nor FK actions, so a
   passing startup proves less than it appears to.
3. **That the two native upserts execute.** Specifically unverified: that
   Hibernate binds `cast(:delta as numeric)` and `cast(:now as timestamptz)` as
   intended, and that `ON CONFLICT` with a bare column list infers `V10`'s plain
   `UNIQUE` **constraints** (as opposed to indexes). The second is the one that
   would fail loudly — as a `23505` instead of an upsert.
4. **That `pg_try_advisory_xact_lock(:lockKey)` maps to a `boolean` return**
   through Spring Data's native-query handling.
5. **That `select max(i.sentAt)` into `Optional<OffsetDateTime>`** returns
   `Optional.empty()` rather than throwing when the table has no matching row.
6. **That JPQL `concat(u.firstName, ' ', u.lastName)`** is accepted with three
   arguments by this Hibernate version.
7. **A `'failed'` invite outcome has never been produced.** The stub gateway
   always reports success; forcing a failure needs a local `throw` inside
   `LoggingSmsInviteGateway`.
8. **Neither limit has been raced.** The advisory lock's `false` branch, and the
   concurrent `409 ALREADY_A_MEMBER` that the two uniqueness constraints (rather
   than the pre-checks) produce, both need two simultaneous requests.
9. **The zero-sum assertion has never fired**, because nothing in this sub-step
   can make a group fail to reconcile. It becomes a live detector in sub-step 3.
10. **That the Postman collection's JSON parses**, and that requests 113+ chain
    their variables correctly.
11. **Performance.** No `EXPLAIN ANALYZE`, and no index was requested.

### 15.8 Not done / follow-ups — Domain 6 sub-steps 1 and 2

- **Split expenses (§9) and settle up (§10) are not started** — sub-steps 3
  and 4, deliberately out of this pass's scope.
- **NO SMS GATEWAY, and selecting one is not this task's call.**
  `LoggingSmsInviteGateway` logs `[DEV SMS STUB]` and reports success. A real
  provider is a **new external dependency** needing constitution §21 clearance
  through the System Architect, and its credentials would be secrets under
  `security-architecture.md` §6 (no default, environment only — the
  `JWT_SECRET`/`DB_PASSWORD` pattern). ADR 0015 §5 says the vendor choice is the
  Backend Engineer's "at implementation time"; this records that the dependency
  decision is raised, not taken.
- **The invite send is not transactionally safe against a commit failure.** It
  is fired last on every path, so no application rejection can follow it, but a
  rollback *after* a successful send loses the ledger row and therefore the
  recipient's cooldown. The honest fix is an outbox row dispatched after commit.
  Not built, because it is a mechanism the contract does not describe.
- **No Domain 7 fan-out from §6/§7, deliberately.** `activities` and
  `notifications` exist as of `V13`, so it is now *possible* here — and neither
  §7.2 nor §7.4 asks for it. data-model.md §5.1/§5.2 scope the required fan-out
  to "the `split_expenses`/`settlements` write path", and §7's steps describe
  three effects only. **A `group_created` activity would need its sentence,
  icon, glyph and tone plus a recipient rule, none of which a backend contract
  states**; the frontend has such an entry (ADR 0008 §2.3,
  `people-outline`/`success`), which is the likely source of the eventual rule.
  **This is a System Architect decision, and it is the one item here most likely
  to be wanted.** When it lands, the rules are already fixed by `V13`'s contract
  item 2/3: one row per affected member in the same transaction, `activities`
  including the actor, `notifications` to every *other* member, **one multi-row
  INSERT per table per event**, and ordering by the `activity_date`/
  `activity_time` pair rather than `created_at`.
- **~~Domain 4's vacuous group-membership check is now unblocked, and was
  deliberately NOT changed here.~~ *** DONE 2026-11-03 — see §13.6(h) and
  §13.10. ***** It was picked up as a reported bug: a real member of a real
  group got `403 NOT_GROUP_MEMBER` on every group expense.
  `TransactionService#requireScopeAndGroupAgree` now calls
  `GroupMemberRepository#existsByGroupIdAndUserId` on both `POST` and `PATCH`,
  `NotGroupMemberException` was reused rather than duplicated, `fk_transactions_group_id`
  is mapped to `404 GROUP_NOT_FOUND` as the race backstop, and the code stayed
  `403` exactly as this note instructed.
  - **This note's one factual error, corrected rather than deleted, because it
    nearly cost a session: it claimed `Transaction` "deliberately does not map
    `group_id` at all".** It always did —
    `@Column(name = "group_id") private UUID groupId;` — so the mapping work
    this note anticipated did not exist, no migration or entity change was
    needed, and the fix was one method plus one injected repository.
    `TransactionScope`'s Javadoc carried the same wrong claim and is corrected
    too. The lesson generalises: **check the entity, not a prose note about
    it.**
  - **The unknown-group case was decided here, and the answer is the same
    `403`** — §4.2's error table defines no `GROUP_NOT_FOUND` for that endpoint,
    and one membership query answers "absent" and "not mine" identically, so
    nothing leaks. `chk_transactions_group_id_matches_scope` keeps its two
    `400`s and remains an unmapped (honest) `500` if ever reached.
- **"A contact becomes a registered user" is undesigned** (ADR 0023 Open
  Question 1). A contact-placeholder member keeps its placeholder membership and
  its placeholder balance row forever, even after that person registers and
  links. Nothing is lost or orphaned, and **no write path here improvises a
  claim** — that pass must cover `group_member_balances`,
  `individual_balances` and `group_members.user_id` together.
- **No member removal, no group delete, no group rename.** §7 defines none, and
  every FK in `V10` is `NO ACTION`, so the database blocks them until a design
  pass decides them (data-model.md Open Question #3). `group_members` has no
  `version` and no `deleted_at` for the same reason.
- **`V9`'s FLAG 1 is still open at the contact level** — a contact may link to
  its own owner. The group paths handle the consequence (see §15.6 assumption 5)
  rather than resolving the flag.
- **`contact_invites(contact_id, created_at)` is NOT requested.** `V9` names it
  as the likely future index and declines it because no endpoint exposes an
  invite count. Still true: §6.3 returns a status, not a count. A Database
  Architect request to raise *with a measurement*, when a surface shows that
  number.
- **The `Tier` record is now duplicated three times**
  (`AuthRateLimitProperties`, `ApiRateLimitProperties`,
  `ContactInviteProperties`), so constitution §25's "duplicate three times →
  extract reusable code" is due. Deliberately not done inside this task
  (constitution §20 — it would touch two already-verified property bindings for
  no behavioural gain). Flagged as a small, separate cleanup.
- **No automated tests**, consistent with Domains 1–4.
- **`docs/api/api-overview.md` §6/§7's Status cells still say "Not started"**
  and `docs/roadmap/backend-build-order.md`'s Domain 6 rows are unchanged. Both
  are System-Architect-owned and were deliberately not edited; they need
  updating once the Project Owner's testing pass confirms this.
- **Frontend wiring has not happened and must not be improvised.** ADR 0014 §2
  and the build order are explicit that reconciling the frontend's single-sided
  stores with this shared-ledger model **needs its own design pass through the
  System Architect first** — `useContactsStore`/`useGroupsStore` have no concept
  of a linked real account, and two linked users with different display symbols
  will see the same number rendered differently.

---

## 16. Domain 6 sub-steps 3 and 4 — Individual balances, Split expenses, Settle up

**Six** endpoints, implemented to `docs/api/api-overview.md` §8.1, §9.1–§9.3 and
§10.1, against `database/migrations/V11__split_expenses.sql`,
`V12__settlements.sql` and `V13__activities_notifications.sql`, and against all
nine items of `docs/decisions/0023-shared-ledger-contract-corrections.md`'s
"Follow-up required from Backend Engineer".

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/splits/individuals` | List the caller's pairwise balances (§8.1) — **both sides, caller-oriented** |
| POST | `/api/v1/split-expenses` | Create a split expense (§9.1) |
| GET | `/api/v1/split-expenses/{id}` | Fetch one split expense (§9.2) |
| GET | `/api/v1/split-expenses` | List by `groupId` **or** `individualBalanceId` (§9.3) |
| POST | `/api/v1/splits/settle` | Record a settlement (§10.1) |

**This sub-step also writes `activities` and `notifications`** — the Domain 7
fan-out §9.1 step 4 and §10.1 step 5 require *in the same transaction* as the
ledger write. `V13` created both tables ahead of its own domain for exactly that
reason. **Domain 7's own endpoints (§11/§12) are NOT implemented**: nothing here
reads either table.

> ⚠ **NO MIGRATION HAS EVER BEEN APPLIED.** Flyway's history still ends at `V6`,
> so `V7`–`V13` all run on the next boot and `ddl-auto=validate` will check six
> brand-new entities against a schema that has never existed. Every mapping was
> written against the migration files line by line; see §16.7 for what that does
> and does not prove.

> ⚠ **Two contract gaps are flagged, not resolved.** `POST /splits/settle` now
> accepts `counterpartUserId`/`counterpartContactId`, which ADR 0023 §4 requires
> and §10.1's request block does not yet list; and §9.1's error table has no
> `CONTACT_NOT_FOUND` row although the endpoint resolves a contact. Both are in
> §16.6.

### 16.1 Individual balances — the both-sides read

```bash
# As ACCOUNT 1: a pairwise split with a contact that is LINKED to account 2.
curl -s -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "title": "Goa Booking",
    "splitDate": "2026-10-27",
    "amount": 500.00,
    "splitMode": "individual",
    "individualCounterpartContactId": "<SECOND ACCOUNT contact id>",
    "splitMethod": "equally",
    "paidByUserId": "<ACCOUNT 1 id>",
    "participants": [
      { "participantUserId": "<ACCOUNT 1 id>", "amount": 250.00 },
      { "participantContactId": "<SECOND ACCOUNT contact id>", "amount": 250.00 }
    ],
    "addToPersonalExpenses": true
  }'
```

Expect `201`. Note `categoryId` was **omitted** — so `categoryName` comes back as
`"Misc"` with `categoryId` **set** to the caller's protected row, not null
(ADR 0023 §3). Then:

```bash
# ACCOUNT 1's view
curl -s http://localhost:8080/api/v1/splits/individuals -H "Authorization: Bearer $TOKEN"
# -> [{ ..., "counterpartUserId": "<ACCOUNT 2 id>", "balance": 250.00 }]

# *** THE TEST THAT MATTERS: ACCOUNT 2's view of the SAME row. ***
curl -s http://localhost:8080/api/v1/splits/individuals -H "Authorization: Bearer $TOKEN2"
# -> [{ ..., "counterpartUserId": "<ACCOUNT 1 id>", "balance": -250.00 }]
```

**Both calls must return one entry, with the same `id`, and opposite signs.**
Four things are being proved at once, and three of them were bugs ADR 0023 §1
fixed:

1. **Account 2 sees the debt at all.** Account 1 created it; account 2 never
   touched it. A read filtered on `user_id = caller` would return `[]` here and
   look perfectly healthy.
2. **It is ONE row, not two.** The `id` is identical in both responses.
   `SELECT count(*) FROM individual_balances` after this is **1**.
3. **The sign is oriented to the reader**, flipped once in
   `IndividualBalanceService#orientToCaller`. The client negates nothing.
4. **`counterpartUserId` resolves to the OTHER party** in both directions, which
   is not positional: for whichever account is the canonical
   `counterpart_user_id`, the counterpart named in the response is the row's
   `user_id`.

```bash
# A pair with an UNLINKED contact stays private — account 2 sees nothing of it.
curl -s -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Cab fare", "splitDate": "2026-10-27", "amount": 300.00,
        "splitMode": "individual",
        "individualCounterpartContactId": "<RAHUL id>",
        "splitMethod": "equally", "paidByUserId": "<ACCOUNT 1 id>",
        "participants": [
          { "participantUserId": "<ACCOUNT 1 id>", "amount": 150.00 },
          { "participantContactId": "<RAHUL id>", "amount": 150.00 } ],
        "addToPersonalExpenses": false }'
```

### 16.2 Split expenses — the five rejections worth checking

```bash
# (a) THE PARTICIPANT SUM — the one rule no constraint can express
curl -i -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Bad sum", "splitDate": "2026-10-27", "amount": 500.00,
        "splitMode": "group", "groupId": "<GROUP id>", "splitMethod": "unequally",
        "paidByUserId": "<ACCOUNT 1 id>",
        "participants": [ { "participantUserId": "<ACCOUNT 1 id>", "amount": 200.00 } ],
        "addToPersonalExpenses": false }'
# -> 400 VALIDATION_ERROR "participants[].amount must sum exactly to amount."

# (b) a SUB-PAISE share -> 400 naming the field, never a silent rounding
#     ... "amount": 250.005 ... -> 400 with fieldErrors

# (c) a participant who is NOT a member of the named group -> 400, not 404
#     (the caller is a member and can read the member list through §7.3)

# (d) a NON-MEMBER creating a group split -> 404 GROUP_NOT_FOUND, never 403

# (e) a contact that is LINKED TO THE CALLER THEMSELVES -> 400, never a 500
#     (V9's FLAG 1: your own number in your own address book)
curl -i -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Self", "splitDate": "2026-10-27", "amount": 100.00,
        "splitMode": "individual",
        "individualCounterpartContactId": "<a contact linked to ACCOUNT 1>",
        "splitMethod": "equally", "paidByUserId": "<ACCOUNT 1 id>",
        "participants": [ { "participantUserId": "<ACCOUNT 1 id>", "amount": 100.00 } ],
        "addToPersonalExpenses": false }'
```

**The consumption-share check, which is invisible in every response:** after
16.1's first call with `addToPersonalExpenses: true`, the created transaction's
`amount` must be **250.00 — the caller's own share — and never 500.00**.
`V11` contract item 3 calls this "the single most valuable assertion to put in an
integration test for this sub-step, because getting it wrong inflates the user's
own spending by the whole group's bill". §16.4 query 4 proves it.

### 16.3 Settle up — the derived direction and the two-sided bound

```bash
# INDIVIDUAL, partial. Account 2 owes account 1 250.00 after 16.1.
curl -i -X POST http://localhost:8080/api/v1/splits/settle \
  -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{ "target": "individual", "individualBalanceId": "<id from 16.1>",
        "amount": 100.00, "method": "marked_paid" }'
```

Expect `201` with **`"remainingBalance": -150.00`** — account 2's residual, from
account 2's point of view. **Not `0.00`.** §10.1 step 3 calls zeroing it "the
single most likely implementation error now that a partial amount is legal".
Re-reading §8.1 as account 1 must now show `150.00`.

```bash
# The over-amount -> rejected, never clamped
curl -i -X POST http://localhost:8080/api/v1/splits/settle \
  -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{ "target": "individual", "individualBalanceId": "<same>",
        "amount": 999.00, "method": "upi" }'
# -> 400 AMOUNT_EXCEEDS_BALANCE, and the balance is UNCHANGED at -150.00

# The same code when there is nothing outstanding: settle a 0.00 balance -> 400
```

```bash
# GROUP. Requires a counterpart (ADR 0023 §4 — see §16.6 flag 1).
curl -i -X POST http://localhost:8080/api/v1/splits/settle \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "target": "group", "groupId": "<GROUP id>",
        "counterpartUserId": "<ACCOUNT 2 id>",
        "amount": 100.00, "method": "marked_paid" }'
```

Four group-specific rejections, none interchangeable:

- **a counterpart who is not a member** → `404 GROUP_NOT_FOUND`, **never `403`**
  and never a message that distinguishes it from an unknown group
  (ADR 0023 item 6);
- **no counterpart at all** → `400 VALIDATION_ERROR` (the request-shape rule
  `chk_settlements_counterpart_matches_target` backstops);
- **both parties owing, both owed, or either at `0.00`** →
  `400 VALIDATION_ERROR` — *the ledger contradicts the request*, and it is
  rejected rather than guessed (ADR 0023 item 5);
- **more than the lesser of the two positions** → `400 AMOUNT_EXCEEDS_BALANCE`,
  because paying a creditor more than they are owed would push *them* into debt.

### 16.4 The DB checks to run

```sql
-- 1. *** ONE ROW PER PAIR, CANONICALLY ORDERED. *** user_id must ALWAYS be the
--    lesser uuid on a registered pair. This is the check that catches a wrong
--    canonical comparison in the service (see §16.5 note 2).
SELECT id, user_id, counterpart_user_id, counterpart_contact_id, balance
  FROM individual_balances;
SELECT count(*) FROM individual_balances WHERE counterpart_user_id IS NOT NULL
   AND user_id >= counterpart_user_id;              -- must be 0

-- 2. THE MIRROR-ROW DETECTOR (V11's FLAG 1 query). Must return NO ROWS, ever.
SELECT a.id AS row_a, b.id AS row_b
  FROM individual_balances AS a
  JOIN individual_balances AS b
    ON b.user_id = a.counterpart_user_id AND b.counterpart_user_id = a.user_id
 WHERE a.counterpart_user_id IS NOT NULL;

-- 3. THE CATEGORY SNAPSHOT — four values, never null, and category_id SET even
--    when the request omitted it (ADR 0023 §3).
SELECT id, category_id, category_name, parent_category_name, category_icon_name,
       category_glyph, category_tone
  FROM split_expenses;
SELECT count(*) FROM split_expenses s
  JOIN categories c ON c.id = s.category_id
 WHERE c.is_protected;                              -- the uncategorized ones

-- 4. *** THE CONSUMPTION SHARE — the error that is invisible in every API
--    response. *** The transaction's amount must equal the CALLER's participant
--    share, never the split total.
SELECT t.id, t.amount AS transaction_amount, s.amount AS split_total,
       p.amount AS caller_share
  FROM split_expenses s
  JOIN transactions t ON t.id = s.personal_transaction_id
  JOIN split_expense_participants p
    ON p.split_expense_id = s.id AND p.participant_user_id = s.created_by_user_id;
--    transaction_amount MUST equal caller_share and MUST NOT equal split_total.

-- 5. BOTH DIRECTIONS OF THE CIRCULAR REFERENCE AGREE (V11's own query).
SELECT t.id AS transaction_id, t.split_expense_id
  FROM transactions AS t
  LEFT JOIN split_expenses AS s ON s.personal_transaction_id = t.id
 WHERE t.split_expense_id IS NOT NULL
   AND (s.id IS NULL OR s.id <> t.split_expense_id);        -- must be empty

-- 6. THE ZERO-SUM INVARIANT — now a LIVE detector, because money has moved.
SELECT b.group_id, sum(b.balance) AS net
  FROM group_member_balances AS b
 GROUP BY b.group_id
HAVING sum(b.balance) <> 0;                         -- must return NO ROWS

-- 7. A GROUP SETTLEMENT MOVED BOTH SIDES. Compare before/after; the debtor's
--    balance rises by `amount` and the creditor's falls by it, and the group
--    still sums to zero (query 6).
SELECT id, user_id, invited_contact_id, balance, updated_at
  FROM group_member_balances WHERE group_id = '<groupId>';

-- 8. THE SETTLEMENT AUDIT ROW — a group settlement records WHO WAS PAID.
SELECT id, group_id, individual_balance_id, initiated_by_user_id,
       counterpart_user_id, counterpart_contact_id, amount, method, settled_at
  FROM settlements;
--    group rows: exactly one counterpart column set.
--    individual rows: BOTH counterpart columns NULL.

-- 9. *** THE FAN-OUT. One activity row per affected member INCLUDING the actor;
--    notifications to every OTHER member. ***
SELECT user_id, type, activity_date, activity_time,
       description_prefix, entity_name, description_suffix, related_split_expense_id
  FROM activities ORDER BY activity_date DESC, activity_time DESC;
SELECT user_id, type, message, read FROM notifications
 ORDER BY notif_date DESC, notif_time DESC;
--    For 16.1's first call: TWO activities rows (accounts 1 and 2) and ONE
--    notification (account 2 only). Account 1's sentence reads "You paid ...";
--    account 2's reads "<name> paid ... to you for ...".
--    ORDER BY the date/time PAIR, never created_at (V13 contract item 3).

-- 10. NO ORPHANED FAN-OUT: every activities/notifications row belongs to a real
--     user, and no row exists for an unregistered member (structurally
--     impossible — both user_id columns are NOT NULL FKs to users).
SELECT count(*) FROM activities a
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id);   -- 0
```

### 16.5 Implementation notes

**1. Pair resolution lives in exactly ONE method.**
`IndividualBalanceService#resolvePair(callerId, contact)` is the only
implementation of ADR 0023 §1.3 and the only caller of either resolve-or-create
statement. It reads the contact's `linked_user_id`, and **non-null → the shared
canonical user-pair row; null → the caller's private contact row**. `V11`'s own
warning is the reason it is one method: "two implementations of this rule is how
two rows per pair come back."

**2. Canonical ordering is the service's job — and `UUID.compareTo` IS WRONG.**
This is the single most dangerous detail in this sub-step and it is not in any
document. Java's `UUID.compareTo` compares the two 64-bit halves as **signed**
longs; PostgreSQL compares a `uuid` as 16 **unsigned** bytes. The two orders
disagree for any pair whose most-significant bits differ in the top bit — and
`gen_random_uuid()` is version 4, so that bit is random. Using
`UUID.compareTo` would have ordered **roughly half of all real pairs backwards**,
violating `chk_individual_balances_canonical_pair_order` and surfacing as a `500`
on a perfectly legal request — and no test with two hand-picked low uuids would
ever have shown it. `IndividualBalanceService#compareCanonical` uses
`Long.compareUnsigned` on the high half then the low half, which is exactly
PostgreSQL's byte-wise comparison. §16.4 query 1 is the check.

**3. `GET /splits/individuals` reads BOTH SIDES and negates once.** The query is
`WHERE user_id = :caller OR counterpart_user_id = :caller` — served by a BitmapOr
over `idx_individual_balances_user_id` and
`idx_individual_balances_counterpart_user_id`, the second of which `V11` created
specifically for this. The flip is `orientToCaller`, **one method, called from
both §8.1 and §10.1's `remainingBalance`** so the same pair can never read
differently on two endpoints. Nothing outside
`IndividualBalanceService`/`IndividualBalanceRepository` assumes `user_id` is the
caller — ADR 0023 §1.2 states that as a rule because the schema cannot.

**4. The balance serialisation mechanism is RELATIVE DELTAS, for both tables.**
`V11` contract item 4 requires one mechanism "for both tables, not one each", and
sub-step 2 had already chosen deltas for `group_member_balances`. `individual_balances`
now uses the same: `INSERT ... ON CONFLICT ... DO UPDATE` to resolve, then
`SET balance = balance + ?` to move. **`SELECT ... FOR UPDATE` is absent from both
tables and must not be added.**

**5. The `ON CONFLICT` clauses on `individual_balances` REPEAT THE INDEX
PREDICATE, and the group ones do not.** `V11`'s keys are *partial* unique indexes,
so `ON CONFLICT (user_id, counterpart_user_id) WHERE counterpart_user_id IS NOT
NULL` is required — a bare column list does not match a partial index and raises a
raw `23505`. `V10`'s keys are plain `UNIQUE` **constraints**, so the group upserts
use a bare list. Getting these two backwards is exactly the trap `V11` flags.

**6. HOW THE SETTLEMENT BOUND IS SERIALISED — THE BOUND IS IN THE UPDATE'S OWN
`WHERE` CLAUSE.** `V12` contract item 3 is the one place in this domain where
a **read** must be protected, not just a write: two members settling the same
balance can both pass an `amount <= outstanding` check against the same pre-read
value and together over-settle it, flipping the sign §10.1 forbids. Three
candidates were considered:

- *`SELECT ... FOR UPDATE` on the balance rows* — **rejected**: `V10`'s CONCURRENCY
  block and §15.5 both forbid adding it to `group_member_balances`, and mixing it
  with deltas is what they warn against.
- *A PostgreSQL advisory transaction lock keyed on the target*, the mechanism
  `ContactInviteRepository#tryLockPhone` already proves in this domain —
  **rejected, but it was close.** It would have worked and it touches no balance
  table; it was passed over because it needs the *blocking* form here (a
  settlement must not be refused because another is in flight), and because it
  adds a second serialisation mechanism to a domain that deliberately has one.
- **Chosen: a conditional relative UPDATE.**
  `UPDATE ... SET balance = balance - :amount WHERE id = :id AND balance >= :amount`
  for the creditor side, and `... + :amount ... AND balance <= :negatedAmount` for
  the debtor side. PostgreSQL evaluates that predicate against the **committed**
  row under the row lock the UPDATE itself takes, so the second of two concurrent
  settlements re-reads and matches **zero rows**. A zero affected-row count is
  answered `400 AMOUNT_EXCEEDS_BALANCE` and the transaction rolls back.

Consequences, stated so none of them is a surprise: **the service's pre-read is
advisory** (it derives the direction and chooses which `400` to raise) and the
predicate is authoritative; **the two-sided bound is never computed as a
`min()` that gets written** — the conjunction of the two per-side guards *is*
`amount <= min(|debtor|, creditor)`; and **a group settlement issues its two
UPDATEs in ascending `group_member_balances.id` order**, which makes a lock cycle
impossible for any number of concurrent settlements without knowing their
directions.

**7. The direction of a group settlement is DERIVED, never supplied.** The request
names a counterpart, not a payer. `SettlementService#deriveDirection` reads both
rows' signs; zero on either side or two positions with the same sign is
`400 VALIDATION_ERROR`. That is also why `V12` needs no
`CHECK (counterpart_user_id <> initiated_by_user_id)`: one row cannot be both
debtor and creditor.

**8. Membership is checked for the COUNTERPART as well as the caller**, with
`404 GROUP_NOT_FOUND` and never `403` (ADR 0023 item 6). The counterpart may be an
**unregistered contact member** — permitted, because `V10`'s reshape gives them
real balance rows and forbidding it would create balances that can never be
cleared (ADR 0023 Open Question 2: refusing it is one guard in
`SettlementService`, not a schema change).

**9. The zero-sum assertion is called from inside
`GroupBalanceService#applySplitExpenseDeltas` and `#applySettlement`**, not from
their callers — so "after every group write" cannot be forgotten at a call site.
**This sub-step is where it becomes a live detector**, because it is the first
code that moves a balance away from `0.00`. It was not weakened, and the
`app.groups.assert-balance-consistency` flag still defaults to **on**.

**10. The balance arithmetic, stated once.** Group: every participant's position
moves **down** by their own share, and the payer's moves **up** by the full
`amount`; those cancel exactly because the shares sum to `amount`. Pair: one row,
one signed delta of `amount − payerShare`, positive iff the payer is the row's
`user_id` side — which on a contact row is always the caller and on a canonical
pair row is the lesser uuid. **The sign depends on which side of the row the payer
is, never on who the caller is**, which is the mistake
`SplitExpenseService#signedPairDelta` exists to make impossible.

**11. Four statements per group split, independent of participant count.** Two
`INSERT ... SELECT`s over the `split_expense_participants` rows just written (one
per participant kind, because `ON CONFLICT` names exactly one inference target),
plus one for the payer's credit. **The payer's credit is a separate statement on
purpose: the payer is usually also a participant**, and one statement covering
both would hit the same conflict key twice and abort with "ON CONFLICT DO UPDATE
command cannot affect row a second time".

**12. WHERE THE DOMAIN 7 FAN-OUT IS WRITTEN.** `ActivityFanoutService`
is the only writer of `activities` and `notifications`. Both of its methods are
`@Transactional(propagation = MANDATORY)`, so neither can start a transaction of
its own; they are called from `SplitExpenseService#createGroupSplit` /
`#createIndividualSplit` and `SettlementService#settleGroup` / `#settleIndividual`,
**after** the ledger write and the balance recalculation and **inside the same
transaction**. The rules, as implemented:

- **`activities` gets a row for the actor too; `notifications` go to every *other*
  affected member.** The subtraction happens once, in
  `ActivityFanoutService#notificationRecipients`.
- **One multi-row INSERT per table per event** — `insert into ... select ... from
  users where u.id in (:userIds)`. Driving it from `users` also means a recipient
  id that is not a real account inserts no row instead of raising
  `fk_activities_user_id`, and a short count is a loud `500`.
- **`activities` takes two statements, not one, and three in one case.** The
  sentence is viewer-relative (ADR 0008 §2.2), so the member who *paid* reads "You
  paid ₹X…" and everyone else reads "{payer} paid ₹X…"; on a pair even
  `entity_name` differs, because each side's highlighted name is the *other*
  party. A third statement appears only when the actor did **not** pay, because
  **`related_transaction_id` must land on the actor's row and on nobody else's** —
  `transactions` are owner-scoped, unlike groups/contacts/split expenses, so
  `V13`'s "a fanned-out row may reference a contact owned by a different member"
  sanction does not extend to that column. Every count is independent of member
  count, which is what `V13` contract item 2 is about ("a five-member group
  settlement is two INSERTs, not ten").
- **Ordering is by the `activity_date`/`activity_time` pair.** Both are derived
  from one `OffsetDateTime` per event, so the pair can never disagree with
  `created_at` (`V13` FLAG 2's first consequence).
- **`entity_name` is the snapshot; the four `related_*` ids are navigation only.**
  `related_settlement_id` does not exist (`V13` FLAG 1), so a settlement activity
  points at its group or contact and not at the settlement row.
- **Nothing writes a `group_created` row.** Still out of scope, still a System
  Architect decision (§15.8).

**13. The sentences are quoted from ADRs, and the three derived ones are flagged.**
`ActivitySentences` holds every template with its source. ADR 0008 §2.2's four
`split_saved` templates and ADR 0009 §6.3's `settlement` template are verbatim;
ADR 0012 §3's seed messages are taken as the intended notification phrasing. The
**derived** ones are the counterpart's half of a settlement sentence and the group
notification message — both by substituting the actor's name into wording that
already exists, and the pairwise form is byte-identical to ADR 0012 §3's own seed
row ("Aditi Sharma settled up with you — ₹450."). Amounts are formatted with
Indian grouping to match the frontend's `toLocaleString('en-IN')` exactly. The
`₹` symbol and the `⇄` glyph are written as `\uXXXX` escapes so the source file is
pure ASCII and cannot be corrupted by a platform-default source encoding.

**14. `Misc` is resolved by `is_protected`, through the method that already did
it.** `CategoryService#resolveProtectedCategory` became `public` for one caller:
`CategorySnapshotResolver#resolveForSplitExpense`. **No second lookup was
written** — that method's own Javadoc explains why ("two implementations of this
lookup is how a by-name match creeps back in"). `category_id` is **set** to the
`Misc` row rather than left null, and `parent_category_name` resolves to `null`
through the same `parentNameOf` as any other leaf rather than being hardcoded.
**No snapshot value is ever written null.**

**15. `added_to_personal_expenses` stores what HAPPENED.** When the caller's own
share is `0.00` (or they are not a participant), no transaction is written and the
column stays `false` — which keeps §4.6's "`personal_transaction_id` set iff the
flag is true" true in *both* directions, the half no CHECK can hold (`V11` FLAG
5(b)). The shipped frontend skips the write in exactly this case, so rejecting the
request would have broken a legal payload. See §16.6 assumption 5.

**16. The write order for the circular reference is `V11`'s, and it is the only
one that works.** Insert `split_expenses` with
`added_to_personal_expenses = false` and a null back-reference → insert the
`transactions` row pointing at it → `UPDATE` the back-reference and the flag. A
failed third step throws rather than leaving a transaction nothing links to.

**17. `V11`'s FLAG 5(d) is ANSWERED: `chk_split_expense_participants_amount_non_negative`
is CORRECT and no migration is owed.** ADR 0005 §5.8 constrains every
`'adjustment'` entry to `≥ 0` ("no negative adjustments — the reference's single
`+` prefix, not `±`, is taken as the intentional constraint, not an omission") and
blocks confirmation whenever `remainderForUnadjusted < 0`, so an unadjusted
participant's share can reach `0` but never go below it. The `>= 0` rather than
`> 0` is also right: a zero share is legal (ADR 0005 §5.7's zero-share person).

**18. The rollback audit, path by path — no `noRollbackFor` anywhere, and that is
a conclusion.** §3 records how this trap broke account lockout and token-family
revocation in Domain 1, and ADR 0023 flagged this domain as the next place it
waits. Every user-facing rejection on all six endpoints is decided **before the
first write**: Bean Validation, the target shape, both XORs, the duplicate check,
the participant sum, the caller's *and* every participant's membership, the
category resolution, the self-pair refusal, the derived direction, and the
pre-read bound. **There is no irreversible side effect on any of these paths** —
no SMS, no external call — which is what makes the audit short. Four things can
throw after a write, and a rollback is the *point* in all four: a constraint
violation (the row never landed); the zero-sum assertion (committing an
unreconciled ledger is strictly worse than failing); a bounded settlement UPDATE
matching zero rows on the second of two sides (a one-sided settlement would break
zero-sum permanently); and an incomplete fan-out (an event half the group heard
about is worse than one nobody heard about, because only the former is invisible).
One ordering subtlety: `individual_balances`' resolve-or-create writes before the
*participant* membership checks can run, because those need the resolved pair to
know who the parties are — a later rejection rolls that upsert back, which is
correct, since a balance row for a pair that recorded nothing is not state anyone
is entitled to.

**19. Constraint name → error code, by FULL folded name, never a prefix,
null-safe.** `V6`'s and `V8`'s `categories` triggers raise with **no** constraint
name at all on a path reaching this same application, so every matcher must guard
for null. **No new `DataIntegrityViolationException` translator was added in this
sub-step**, and that is deliberate rather than an omission: every constraint in
`V11`/`V12` that a *legal* request could reach is pre-checked in the service, so
the remaining ones mean a service rule was skipped and are honest `500`s. The full
mapping, as designed:

| Constraint | Code | Where it is pre-empted |
|---|---|---|
| `uq_individual_balances_user_counterpart_user` | `500` if it ever surfaces | it is the `ON CONFLICT` target, so it cannot |
| `uq_individual_balances_user_counterpart_contact` | `500` if it ever surfaces | same |
| `chk_individual_balances_counterpart_xor` | `500` | the service picks the column |
| `chk_individual_balances_canonical_pair_order` | `500` (ordering) / pre-empted as **`400`** (self-pair) | `compareCanonical`; `cannotSplitWithYourself()` |
| `fk_individual_balances_counterpart_contact_id` | `404 CONTACT_NOT_FOUND` | contact resolved owner-scoped first |
| `fk_split_expenses_group_id` | `404 GROUP_NOT_FOUND` | membership check |
| `fk_split_expenses_individual_balance_id` | `404 INDIVIDUAL_BALANCE_NOT_FOUND` | the row is resolved in the same transaction |
| `fk_split_expenses_category_id` | `404 CATEGORY_NOT_FOUND` | `CategorySnapshotResolver`, owner-scoped |
| `chk_split_expenses_amount_positive` | `400 VALIDATION_ERROR` | `@DecimalMin(0, exclusive)` |
| `chk_split_expenses_title_not_blank` | `400 VALIDATION_ERROR` | `@NotBlank` + trim |
| `chk_split_expenses_split_mode_valid` | `400 VALIDATION_ERROR` | `@Pattern` + `SplitMode` |
| `chk_split_expenses_target_matches_mode` | `400 VALIDATION_ERROR` | `validateTargetShape` + two explicit nulls |
| `chk_split_expenses_paid_by_user_xor_contact` | `400 VALIDATION_ERROR` | `exactlyOnePayerRequired()` |
| `chk_split_expenses_personal_transaction_requires_flag` | `500` | the flag is set from what happened |
| `uq_split_expenses_personal_transaction_id` | `500` | one transaction per split by construction |
| `chk_split_expense_participants_user_xor_contact` | `400 VALIDATION_ERROR` | `exactlyOneParticipantIdentityRequired()` |
| `chk_split_expense_participants_name_not_blank` | `500` | name is server-resolved; guarded by `requireName` |
| `chk_split_expense_participants_amount_non_negative` | `400 VALIDATION_ERROR` | `@DecimalMin("0")` |
| ~~`uq_split_expense_participants_expense_user` / `..._expense_contact`~~ | — | **Dropped by V19 (2026-11-12).** Replaced by `uq_split_expense_participants_expense_revision_user` / `..._expense_revision_contact`, which map to a logged `500` (V19 CONTRACT item 4, ADR 0028 §10): `duplicateParticipant()` always rejects first, before the first write. No matcher exists on either old or new name; match FULL names only if one is ever added, never the shared `uq_split_expense_participants_expense_` prefix. See §22 |
| `fk_transactions_split_expense_id` | `500` | never a request field |
| `chk_settlements_amount_positive` | `400 VALIDATION_ERROR` | `@DecimalMin(0, exclusive)` |
| `chk_settlements_target_xor` | `400 VALIDATION_ERROR` | `targetIdsContradictTarget()` + explicit nulls |
| `chk_settlements_method_valid` | `400 VALIDATION_ERROR` | `@Pattern` |
| `chk_settlements_counterpart_matches_target` | `400 VALIDATION_ERROR` | `exactlyOneSettlementCounterpartRequired()` / `...NotAllowedForIndividualTarget()` |
| `fk_settlements_group_id` | `404 GROUP_NOT_FOUND` | membership check |
| `fk_settlements_individual_balance_id` | `404 INDIVIDUAL_BALANCE_NOT_FOUND` | `requireParty` |
| `fk_settlements_counterpart_user_id` / `..._contact_id` | `404 GROUP_NOT_FOUND` | `requireCounterpartMembership` |
| `fk_activities_*`, `fk_notifications_user_id`, `chk_activities_entity_name_not_blank`, `chk_notifications_message_not_blank` | `500` | everything is server-composed |
| **`400 AMOUNT_EXCEEDS_BALANCE`** | — | **has no constraint behind it and never can**; pure service-layer, enforced in the UPDATE predicate |

**20. No `SELECT *` and a fixed query budget.** `GET /split-expenses` is three
queries regardless of history length: the split rows, **every participant of every
split in one query** (`WHERE split_expense_id = ANY(?)`), and one payer-name
lookup per source table. `participants[].name` and the five category fields cost
**zero** queries — they are on the row, which is the entire point of the
denormalization (`V11` contract item 7). `GET /splits/individuals` is three.

**21. No new dependency, and no new table.** Everything here uses what was already
on the classpath. The two non-ASCII literals are `\uXXXX` escapes rather than a
formatting library, and the Indian-grouping amount format is
`java.text.NumberFormat` with a per-call instance (it is not thread-safe, and a
shared static one is the classic silent corruption under concurrency).

### 16.6 Key assumptions — Domain 6 sub-steps 3 and 4

**All of these are flagged for the System Architect rather than resolved
unilaterally** (constitution §30, ADR 0023 Backend follow-up item 9).

1. **⚠ `POST /splits/settle` accepts two counterpart fields that §10.1's request
   block does not list.** ADR 0023 §4 adds the columns, makes exactly one
   **required** for a group settlement, and `V12` enforces it with
   `chk_settlements_counterpart_matches_target`; ADR 0023's Consequences say
   §10.1 gains "the counterpart fields", but that document's request block still
   shows five fields. **Without them every group settlement would fail with a
   `23514`** — the same class of contradiction ADR 0023 §3 fixed for `categoryId`.
   The fields are named exactly as the columns and as `V12` FLAG 1 candidate (a)
   describes ("`POST /splits/settle` gains a request field").
   **Please amend §10.1's request block, or tell me to take a different shape.**
2. **⚠ `SettlementResponse` does NOT echo the counterpart back.** ADR 0023's
   Consequences also list `SettlementResponse` as changing, and §10.1's response
   block is unchanged. The documented nine fields are implemented exactly;
   echoing a value the client just sent would be inventing a response field.
3. **§9.1's error table has no `CONTACT_NOT_FOUND` row**, although the endpoint
   resolves `individualCounterpartContactId` owner-scoped. `404 CONTACT_NOT_FOUND`
   is reused rather than invented — it is this API's existing code for exactly
   this condition (§6.3, §7.2) — but §9.1's table should gain the row.
4. **"Every affected member" is read as "whose balance this write moved, plus the
   actor".** For a group split that is every participant plus the payer; for a
   group settlement it is the two parties, not the whole group. An **unregistered**
   member can never be a recipient: both `activities.user_id` and
   `notifications.user_id` are `NOT NULL` FKs to `users`, so a contact placeholder
   has nowhere to receive anything — structural, not an omission.
5. **A zero caller share with `addToPersonalExpenses: true` stores `false`
   rather than rejecting.** The shipped frontend's own condition is
   `addToExpenses && finalYourShare > 0`, and
   `chk_transactions_amount_positive` would refuse a zero-amount row anyway. The
   alternative (`400`) would break a legal payload; a factory for that rejection
   exists and is deliberately unused, so the decision is visible in code.
6. **Group-mode identities must be named the way `group_members` stores them** — a
   `participantUserId` for a registered member, a `participantContactId` for a
   placeholder. `GET /groups/{id}` returns exactly those two keys per member, so
   the client always has the right value. **Individual mode is more forgiving and
   normalises**: a linked contact's id maps to its `linked_user_id`, mirroring
   §7.2's "a linked contact joins as the real account". §9.1 states neither rule.
7. **A participant or payer who is not a member of the named group is `400`, not
   `404`.** The caller's own membership is already proved and they may read the
   member list through §7.3, so nothing is revealed. Without the check the balance
   upsert would *create* a row for a non-member and the row-count assertion would
   then fail the write with a `500`.
8. **An individual split's participants must be the caller or the counterpart.**
   Derived: the target has exactly two sides, so a third identity's share would
   have nowhere to land.
9. **The split-originated transaction's `paymentMode` is `cash`** and its
   `txnTime` is the moment of save. Neither is in §9.1. Both mirror the shipped
   frontend's own values for this exact write (`paymentMode: 'cash'` with ADR 0005
   §6.2 cited, and "this screen gains no TIME UI of its own"), and
   `transactions.payment_mode`/`txn_time` are both `NOT NULL` with no
   "unspecified" value.
10. **A group split's own transaction is `scope='group'` with `groupId` set; an
    individual split's is `scope='personal'` with `groupId: null`.** The shipped
    frontend's own precedent, and `Transaction`'s Javadoc warns that group scope is
    not a synonym for "came from a split". This was the **first** code to write a
    `scope='group'` transaction row; *(updated 2026-11-03)*
    `POST`/`PATCH /transactions` can now write one too, for a real member —
    §15.8's follow-up is done. **This path still does not go through
    `TransactionService`**, so the two writers must stay consistent by review:
    the split path takes its `groupId` from the split expense, whose own
    membership check already ran.
11. **⚠ The currency symbol in a frozen sentence is hardcoded `₹`.** `V13` accepts
    that a frozen sentence goes stale if a user switches currency, but not the
    *choice* of symbol: currency is a per-user display preference and a fan-out
    writes one row per member. **No ISO-4217-to-symbol table was invented** (the
    backend has none) and no per-recipient formatting was introduced (it would make
    one event read differently per reader). It is a single named constant so the
    fix has one site. **This needs a ruling.**
12. **`related_contact_id` is populated on every row of an individual split**, not
    only the actor's — it is the actor's own contact for the other party (ADR 0008
    §2.2), so the counterpart's row references a contact owned by someone else,
    which `V13` explicitly sanctions at `fk_activities_related_contact_id`. The
    four `related_*` columns are navigation only. `related_transaction_id` is the
    deliberate exception — see §16.5 note 12.
13. **A notification's subject is the actor ("added"); an activity's is the payer
    ("paid").** Not an inconsistency: a notification announces that someone did
    something, an activity records what happened to the money. It is also why
    notifications need one message per event.
14. **`notifications.type` is `'group_expense'` for both split modes.** ADR 0012
    §3's own seed data uses that type for an individual split, so the name is
    narrower than the meaning. Kept because it is that ADR's vocabulary.
15. **`remainingBalance` is oriented to the caller on an individual settlement.**
    §10.1 says "the target balance row's value", which is unambiguous for a group
    (step 1 defines the target as the caller's own row) but not for a pair, where
    the stored sign is relative to `user_id`. Returning it raw would contradict
    §8.1 and make the same pair read differently on two endpoints.
16. **Three list endpoints here are plain arrays, not `PageResponse`** — §8.1,
    §9.3 and the contract shapes say so. The same departure from constitution §11
    that `GET /contacts`, `GET /groups` and `GET /categories` already make.
17. **Ordering is chosen, not specified.** Pairwise balances by `updated_at desc,
    id`; split expenses by `split_date desc, id`; participants by `created_at, id`.
    Some total order is mandatory for a stable list, and `id` is the tie-break
    because neither table has a unique business key.
18. **`participants[]` is capped at 50 entries**, the same number
    `CreateGroupRequest#memberContactIds` uses — a split cannot have more
    participants than a group can have members. §9.1 states no maximum; this bounds
    the one request in the domain that writes an unbounded number of rows.
19. **`split_method` has no database CHECK**, by `V11`'s own decision, so the DTO's
    `@Pattern` is the only vocabulary guard that exists. Same for
    `settlements.method`, except there the CHECK exists too.
20. **Nothing writes `groups.last_activity`, still.** `V10` assigns it to "the
    V11/V12 write paths", and ADR 0009 §6 gives the frontend's own format
    (`'Settled up • Today'`) — but that is a **client-side relative date string**
    frozen into a shared column, and which day "Today" means depends on who reads
    it and when. Writing it would also need a rule for the split case that no
    backend contract states. **Deliberately not written; this is the one item of
    `V10`'s expectation that this sub-step does not discharge.**

### 16.7 Not verified in the session that wrote this

**Nothing in this section has been compiled or run.** There was no shell in that
session, so every statement above is a static reading of the migrations, the
contract and the existing code.

1. **That it compiles.** No `mvn` invocation happened.
2. **That `ddl-auto=validate` passes.** `V7`–`V13` have never been applied, so
   `IndividualBalance`, `SplitExpense`, `SplitExpenseParticipant`, `Settlement`,
   `Activity` and `Notification` have never met a real schema. Column names and
   types were read off `V11`/`V12`/`V13` line by line, but `validate` inspects
   neither CHECK constraints nor uniqueness nor FK actions.
3. **That `ON CONFLICT (a, b) WHERE predicate` binds through Hibernate's native
   query handling** and infers `V11`'s partial unique indexes. This is the single
   most likely thing to fail loudly, as a raw `23505`.
4. **That `in (:userIds)` expands correctly in a NATIVE query** for the two
   fan-out inserts. Derived queries and JPQL `in` are proven in this codebase;
   a native-SQL collection parameter is not.
5. **That the two `INSERT ... SELECT` statements over `split_expense_participants`
   see the rows flushed by `saveAllAndFlush`** in the same transaction, and that
   `-p.amount` binds as `numeric`.
6. **That the unsigned uuid comparison matches PostgreSQL on real
   `gen_random_uuid()` values.** §16.4 query 1 is the check, and it must be run
   with a pair whose top bits differ — two sequentially generated uuids will not
   exercise it.
7. **That no bounded settlement UPDATE has ever been raced.** The zero-affected-row
   branch — the whole reason the bound is in the predicate — needs two simultaneous
   requests against one balance.
8. **That the zero-sum assertion has never actually fired.** It is a live detector
   for the first time in this sub-step, but no code path here is *expected* to
   violate it, so the failure branch is unexercised.
9. **That a group settlement's two UPDATEs cannot deadlock.** The ascending-id
   ordering is an argument, not an observation.
10. **That `split_mode`/`split_method`/`method` round-trip** through
    `SplitModeConverter` and the two plain-String columns.
11. **That Jackson 3 serialises `LocalDate` as `YYYY-MM-DD` and `LocalTime` in the
    two fan-out columns** as expected — the fan-out columns are never serialised to
    a client in this sub-step, so only the `splitDate` half is on an API surface.
12. **That the `₹`/`⇄` escapes render correctly** end to end into a stored sentence.
13. **Performance.** No `EXPLAIN ANALYZE`, and **no index was requested** —
    `V11`/`V13` already create everything these six endpoints read by.
14. **That the Postman collection's JSON parses**, and that requests 143+ chain
    their variables correctly.

### 16.8 Not done / follow-ups — Domain 6 sub-steps 3 and 4

- ~~**Domain 7's own endpoints (§11 Activity log, §12 Notifications) are not
  started.**~~ **Discharged — see §17.** Both tables were written and neither was
  read at the time this bullet was written; §11.1, §12.1, §12.2 and §12.3 are now
  implemented, and both `V13` rules recorded on `NotificationRepository`
  (**explicit `updated_at` on the bulk mark-all-read**, and **writing only
  `WHERE user_id = ? AND read = FALSE`**) are honoured there. The feed orders by
  the `activity_date`/`activity_time` pair and joins none of the four
  `related_*` targets. **The fan-out is still the only writer of either table.**
- **"A contact becomes a registered user" is still undesigned** (ADR 0023 Open
  Question 1), and this sub-step is where it starts to cost something real: a pair
  that has a private contact row keeps using it after the contact links, so the
  two parties will not share a row until that pass lands. **No write path
  improvises a claim** — `resolvePair` resolves and never merges.
- **ADR 0021's two propagations are still not wired for `split_expenses`**
  (`V11`'s note at `fk_split_expenses_category_id`): a category rename does not
  refresh a split expense's snapshot, and a category delete does not reassign its
  `category_id` to `Misc`. Both are owed, and `V11` flags that neither is a
  mechanical copy of the `transactions` UPDATE — these rows are **shared**, so a
  rename by the creator rewrites what other members see (ADR 0021 §2.8) and a
  reassignment points a shared record at one member's private `Misc` row.
  **Deliberately out of scope here**; it is a Domain 3 change with a Domain 6
  consequence.
- **`groups.last_activity` is still never written** — see §16.6 assumption 20. It
  needs a format ruling.
- **No settlement history endpoint**, no `PATCH`/`DELETE` for a split expense, and
  no reversal flow for a settlement. §9/§10 define none, every FK is `NO ACTION`,
  and `V12` is explicit that a correction must be a new compensating row rather
  than an edit.
- **Offline-first: nothing in this domain has a `client_id`** (`V11` FLAG 6,
  `V12` FLAG 4). That is correct today and needs a Domain 8 ruling, and the stakes
  are highest here: **a replayed settlement is a double payment against a shared
  balance**, the most damaging non-idempotent write in the API. The balance tables
  themselves are derived state and need no key.
- **No automated tests**, consistent with Domains 1–4. If one test is ever written
  for this sub-step, `V11` contract item 3 names which: the consumption share.
- **`docs/api/api-overview.md` §8/§9/§10's Status cells still say "Not started"**,
  and §10.1's request block still lacks the counterpart fields. Both are
  System-Architect-owned and were deliberately not edited.
- **Frontend wiring still has not happened and must not be improvised** (§15.8).
  Two additions for that design pass: **`balance` arrives already oriented to the
  caller — do not negate it client-side** — and **a pairwise balance is shared, so
  it can change because the other party acted** (ADR 0023's Frontend follow-up).
- **The `Tier` record is still duplicated three times** (§15.8) — unchanged, and
  still a small separate cleanup.

---

## 17. Domain 7 — Activity log and Notifications

**Four** endpoints, implemented to `docs/api/api-overview.md` §11.1, §12.1, §12.2
and §12.3, against `database/migrations/V13__activities_notifications.sql` and
every item of its CONTRACT block that applies to a read path.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/activities` | The caller's activity feed (§11.1) — **including entries other members caused** |
| GET | `/api/v1/notifications` | The caller's notifications, with the `read` filter (§12.1) |
| PATCH | `/api/v1/notifications/{id}/read` | Mark one read (§12.2) |
| PATCH | `/api/v1/notifications/read-all` | Mark every unread one read (§12.3) |

**This is the last backend gap in the free tier**, and it is the read half of a
domain whose write half already shipped: `V13` created both tables ahead of their
own endpoints so Domain 6's split save and settlement could fan out **in the same
transaction** as the ledger write (§16). **Nothing in this section writes an
`activities` row or creates a `notifications` row** — `ActivityFanoutService` is
still the only producer of either, and the only column anything here mutates is
`notifications.read`.

> ⚠ **`read` IS THE ONLY MUTABLE COLUMN IN THIS DOMAIN.** `activities` rows are
> immutable — §11 is one `GET` and nothing else, there is no `deleted_at` and no
> `version` on either table, and an audit trail that can be rewritten is not an
> audit trail. If a future change adds a write endpoint to §11, it is a contract
> change first.

> ⚠ **NO MIGRATION HAS EVER BEEN APPLIED.** Flyway's history still ends at `V6`,
> so `V7`–`V13` all run on the next boot. **No entity column was added or altered
> for this section** — `Activity` and `Notification` are untouched, so
> `ddl-auto=validate` has exactly the same surface to check as it did after §16.

> ⚠ **Two things `V13` flags that this section answers, and one it does not.**
> §11.1's pagination is that document's own unconfirmed addition — **implemented
> as written** (§17.8 flag 2). The unread badge has **no count endpoint** —
> implemented via `totalElements`, with the dedicated endpoint **recommended and
> not built** (§17.5, §17.8 flag 1). `activity_date`/`activity_time` being
> authoritative for ordering over `created_at` is `V13` FLAG 2's open question;
> this implementation takes contract item 3's ruling (§17.8 flag 3).

### 17.1 The activity feed — including entries the caller did not cause

This read needs no new fixture: §16's requests already fanned rows out to both
accounts. Run §16.1 and §16.3 first, then:

```bash
curl -s "http://localhost:8080/api/v1/activities" -H "Authorization: Bearer $TOKEN"
```

Expect `200` and a `PageResponse<ActivityResponse>` — the five keys `content`,
`page`, `size`, `totalElements`, `totalPages`, never Spring's own `Page` shape.

```bash
# *** THE TEST THAT MATTERS: account 2's feed holds an entry it never caused. ***
curl -s "http://localhost:8080/api/v1/activities" -H "Authorization: Bearer $TOKEN2"
```

**Both accounts must see the split and the settlement, with different
sentences.** Four things are being proved at once:

1. **The fanned-out entry is there at all.** Account 1 created the split; account
   2 never touched it. §11.1's own words: the feed "includes fanned-out entries
   from shared-ledger events other members triggered, not only entries the caller
   personally caused."
2. **And it is produced by NO extra clause.** The query is
   `WHERE user_id = :caller` and nothing else — those entries *are* account 2's
   own rows, because the fan-out wrote one privately-owned row per member. This is
   the opposite of §16.1's `individual_balances` read, where a `user_id`-only
   filter was the bug. **Do not "fix" this read to look like that one.**
3. **The sentence is viewer-relative.** Account 1 reads
   `descriptionPrefix: "You paid ₹500 to "`, account 2 reads
   `"<name> paid ₹500 to you for "` — two rows, two frozen sentences, composed at
   write time by `ActivitySentences` (ADR 0008 §2.2's four templates).
4. **`descriptionSuffix` is legitimately `""`** on any entry whose `entityName` is
   `null`, and `descriptionPrefix` is then the complete sentence. A client that
   treats `""` as missing data renders a broken feed. `entityName` is never blank
   when non-null (`chk_activities_entity_name_not_blank`).

**Ordering is `activityDate` then `activityTime`, both descending, with `id`
breaking ties — and `createdAt` appears in no `ORDER BY` in this domain**
(`V13` contract item 3). Check it on the response:

```bash
curl -s "http://localhost:8080/api/v1/activities?size=50" -H "Authorization: Bearer $TOKEN" \
  | python -c "import json,sys; [print(r['activityDate'], r['activityTime'], r['type']) for r in json.load(sys.stdin)['content']]"
```

### 17.2 The four `related_*` filters, and pagination

```bash
# Each filter on its own. All four are OPTIONAL and they combine as AND.
curl -s "http://localhost:8080/api/v1/activities?splitExpenseId=<SPLIT id>"   -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/activities?groupId=<GROUP id>"          -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/activities?contactId=<CONTACT id>"      -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/activities?transactionId=<TXN id>"      -H "Authorization: Bearer $TOKEN"
```

Four things worth knowing before reading the results:

- **`transactionId` matches at most the ACTOR's row.** `related_transaction_id` is
  written only on the row of the member whose personal transaction was created
  (`transactions` are owner-scoped, unlike groups, contacts and split expenses),
  so this filter returns nothing at all for the counterpart. That is correct, not
  a missing fan-out.
- **`contactId` can match a contact the reader does not own.** On an individual
  split the id written on *every* row is the actor's own contact for the other
  party — which `V13` explicitly sanctions at
  `fk_activities_related_contact_id`. The four ids are navigation only, so the
  worst case is a link that resolves to nothing for that reader.
- **An unknown, other-user or deleted id is an EMPTY PAGE, never a 404.** §11.1
  defines no error for these parameters, and a `404` would confirm whether an id
  is real. A deleted entity's id matches nothing for a second reason too: the FK's
  `ON DELETE SET NULL` has already cleared the column, and the row stays readable
  because its snapshot columns survive.
- **There is NO `settlementId` filter**, because there is no
  `related_settlement_id` column (`V13` FLAG 1). A settlement entry is filterable
  by its group or its contact and by nothing else.

```bash
# Pagination, and the proof that the order is TOTAL. These two pages must be
# DISJOINT and their concatenation must equal the first two rows of ?size=2.
curl -s "http://localhost:8080/api/v1/activities?page=0&size=1" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/activities?page=1&size=1" -H "Authorization: Bearer $TOKEN"

# The bounds. No `sort` parameter exists on this endpoint, by design.
curl -i -s "http://localhost:8080/api/v1/activities?size=0"    -H "Authorization: Bearer $TOKEN"  # 400 VALIDATION_ERROR
curl -i -s "http://localhost:8080/api/v1/activities?size=101"  -H "Authorization: Bearer $TOKEN"  # 400 VALIDATION_ERROR
curl -i -s "http://localhost:8080/api/v1/activities?page=-1"   -H "Authorization: Bearer $TOKEN"  # 400 VALIDATION_ERROR
curl -i -s "http://localhost:8080/api/v1/activities?groupId=not-a-uuid" -H "Authorization: Bearer $TOKEN"  # 400, not 500
```

**Why the tie-break matters more here than on `GET /transactions`:** one fan-out
writes several rows from a *single* computed instant, so two rows sharing a date
*and* a time is the normal case rather than an edge case. Without a total order
those rows would be free to swap pages between two requests, and a user scrolling
a feed would see one entry twice and another not at all. `id` is the primary key,
so appending it makes the order total — **and `created_at` is deliberately not
used for the tie-break**, even though Domain 4's transactions ordering uses it:
contract item 3 forbids mixing it into one read path and not another.

### 17.3 The notification list and the `read` filter

Notifications go to **every OTHER affected member**, never the actor, so account 2
is the one with rows after §16's requests:

```bash
curl -s "http://localhost:8080/api/v1/notifications" -H "Authorization: Bearer $TOKEN2"
```

Expect `200`, `read: false` on every row, and exactly seven fields per entry:
`id`, `type`, `message`, `notifDate`, `notifTime`, `read`, `createdAt`. **No
entity ids at all** — the row does not know which group or split expense it
describes, because `message` is the whole payload. The cost is recorded rather
than hidden: **a notification is not navigable** (`V13` FLAG 3).

```bash
# Both filter values, and the unfiltered page, are three different index paths.
curl -s "http://localhost:8080/api/v1/notifications?read=false" -H "Authorization: Bearer $TOKEN2"
curl -s "http://localhost:8080/api/v1/notifications?read=true"  -H "Authorization: Bearer $TOKEN2"  # [] before 17.4

# A non-boolean is a 400, never a silently ignored filter.
curl -i -s "http://localhost:8080/api/v1/notifications?read=maybe" -H "Authorization: Bearer $TOKEN2"
```

Ordering is the `notifDate`/`notifTime` pair with the same `id` tie-break and the
same prohibition on `created_at`.

### 17.4 Mark read — one, then all

```bash
# (a) ONE. 200 with the updated row, read: true.
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/<NOTIF id>/read" \
  -H "Authorization: Bearer $TOKEN2"

# (b) THE SAME ONE AGAIN -> 200, and it writes NOTHING. Idempotent, which is why
#     this table needs no `version` column. updated_at must NOT move on this call.
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/<NOTIF id>/read" \
  -H "Authorization: Bearer $TOKEN2"

# (c) *** 404, NEVER 403 *** — account 1 reaching for account 2's notification.
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/<NOTIF id>/read" \
  -H "Authorization: Bearer $TOKEN"
# -> 404 NOTIFICATION_NOT_FOUND, and byte-identical to:
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/00000000-0000-0000-0000-000000000000/read" \
  -H "Authorization: Bearer $TOKEN2"

# (d) a malformed id -> 400 VALIDATION_ERROR, not a 500 and not a 404.
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/not-a-uuid/read" \
  -H "Authorization: Bearer $TOKEN2"

# (e) ALL. Note the VERB: PATCH, not POST (§12.3's own endpoint table).
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/read-all" \
  -H "Authorization: Bearer $TOKEN2"
# -> 200 { "message": "All notifications marked as read." }

# (f) ...and again on an account with nothing unread -> the IDENTICAL 200.
#     Zero affected rows is a success, not a 404 and not a 409.
curl -i -s -X PATCH "http://localhost:8080/api/v1/notifications/read-all" \
  -H "Authorization: Bearer $TOKEN2"
```

**`PATCH /read-all` cannot collide with `PATCH /{id}/read`** — one segment versus
two — so `read-all` is never parsed as a notification id.

**The thing that is invisible in every response, and the whole reason this
sub-step is worth a careful read:** `updated_at`. §12.3 is a bulk `UPDATE`, which
bypasses the persistence context and therefore `@UpdateTimestamp` entirely, and
**this schema has no trigger for `updated_at` on any table** (`V7` contract item
2). So the statement sets it explicitly:

```java
update Notification n
   set n.read = true,
       n.updatedAt = :updatedAt
 where n.userId = :userId
   and n.read = false
```

This project has already been bitten by exactly this on the category-rename
propagation; `TransactionRepository#refreshCategorySnapshot` is the pattern and
this follows it deliberately. The failure it prevents is silent: `updated_at` is
the confirmed last-write-wins / sync-cursor column, and `V13` names
`notifications` as the one table in this domain with "a real mutation to
propagate (a mark-read on one device must reach the others)" — so without the
assignment, a notification read on the phone would stay unread on every other
device **forever, with no error anywhere**. §17.6 query 3 is the check.

**`and n.read = false` is not an optimization either.** It is what keeps the
statement from bumping `updated_at` on rows that did not change (contract item 4
asks for it by name): the predicate is exactly what
`idx_notifications_user_id_read` indexes, and a needlessly bumped row would
re-sync to every device for nothing.

**§12.2 takes the other path on purpose.** It goes through the persistence
context, where `@UpdateTimestamp` does run, so nothing is assigned by hand — and
it skips the write entirely when the row is already read, because assigning
`read = true` to a row that already has it would still dirty the entity, still
issue an `UPDATE`, and still bump the timestamp for a no-op.

### 17.5 The unread badge — `totalElements`, and the endpoint that does not exist

ADR 0012 §4 renders an exact count for 1–9 and `"9+"` for 10 or more, on **three**
screens (Dashboard, Split, Profile). **§12 defines no count endpoint** (`V13`
FLAG 3). The contract-supported source is therefore:

```bash
curl -s "http://localhost:8080/api/v1/notifications?read=false&size=1" \
  -H "Authorization: Bearer $TOKEN2" \
  | python -c "import json,sys; print(json.load(sys.stdin)['totalElements'])"
```

**`totalElements` is the badge.** It is correct and it is indexed — the count
query is `select count(*) ... where user_id = ? and read = false`, and both
columns are in `idx_notifications_user_id_read`, so it is an index scan
(index-only when the visibility map allows) and never a heap scan of the user's
rows. `size=1` makes the discarded page one row instead of twenty; `size=0` is a
`400` by the page-size bound, so one is the floor.

**Recommendation, offered and NOT applied** (`V13` FLAG 3 is an API decision, and
inventing an endpoint the contract does not define is what constitution §15/§30
forbids):

> Add **`GET /api/v1/notifications/unread-count`** returning
> `{ "unreadCount": <int> }`. **No schema change and no migration is involved** —
> `idx_notifications_user_id_read` already serves it exactly, with the same
> `(user_id, read)` index scan the count half of §12.1 already performs. It would
> be one repository method (`long countByUserIdAndRead(UUID, boolean)`), one
> service method and one controller method, and it would fit under the existing
> `/api/v1/notifications/**` security matcher and the existing rate-limit tier
> with no change to either.
>
> **What it buys:** three screens stop fetching and discarding a page of
> notification rows on every render of a bell. **What it costs:** one more
> endpoint, and a second source of truth for the same number that must not be
> allowed to disagree with §12.1's `totalElements` (it cannot, since both are the
> same count over the same predicate).
>
> **The decision is the System Architect's**, because it is an addition to
> `api-overview.md` §12. Until it lands, the frontend must use
> `?read=false&size=1` — **not** `content.length`, which is capped at the page
> size and would render `"9+"` as `20` or `9` depending on `size`.

### 17.6 The DB checks to run

```sql
-- 1. *** THE FEED ORDER. *** This is the ordering the two endpoints use; it must
--    match what the API returned in 17.1. NEVER add created_at to this clause
--    (V13 contract item 3).
SELECT user_id, type, activity_date, activity_time, id,
       description_prefix, entity_name, description_suffix
  FROM activities
 WHERE user_id = '<ACCOUNT 1 id>'
 ORDER BY activity_date DESC, activity_time DESC, id DESC;

-- 2. ONE ROW PER MEMBER, PRIVATELY OWNED — the fact that makes a user_id-only
--    read correct. A shared event appears once per affected member, with
--    DIFFERENT sentences and the SAME related_split_expense_id.
SELECT related_split_expense_id, count(*) AS rows, count(DISTINCT user_id) AS owners
  FROM activities
 WHERE related_split_expense_id IS NOT NULL
 GROUP BY related_split_expense_id;        -- rows = owners, always

-- 3. *** THE updated_at PROOF — the one thing §12.3 can silently get wrong. ***
--    Run BEFORE and AFTER the mark-all-read in 17.4(e).
SELECT id, read, created_at, updated_at, updated_at > created_at AS bumped
  FROM notifications
 WHERE user_id = '<ACCOUNT 2 id>'
 ORDER BY notif_date DESC, notif_time DESC, id DESC;
--    After 17.4(e): every row read = true, and every row it ACTUALLY changed has
--    updated_at > created_at. A row that was already read must be UNTOUCHED —
--    compare its updated_at across the two runs.

-- 4. ACTIVITIES ARE IMMUTABLE. Nothing in this domain updates one, so
--    updated_at = created_at for the life of every row. A row where these differ
--    means something wrote an activity that should not have.
SELECT count(*) FROM activities WHERE updated_at <> created_at;      -- must be 0

-- 5. THE SUFFIX/ENTITY PAIRING the API returns verbatim. An empty suffix beside a
--    NULL entity_name is NORMAL; a non-null blank entity_name is impossible
--    (chk_activities_entity_name_not_blank).
SELECT count(*) FROM activities
 WHERE entity_name IS NULL AND description_suffix <> '';   -- expected 0, by convention
SELECT count(*) FROM activities
 WHERE entity_name IS NOT NULL AND btrim(entity_name) = '';  -- 0, by constraint

-- 6. NO ROW LEAKS ACROSS ACCOUNTS. Both endpoints filter on user_id only, so this
--    is the whole access control and it is worth asserting directly.
SELECT count(*) FROM notifications WHERE user_id = '<ACCOUNT 1 id>' AND id = '<a row of ACCOUNT 2>';
-- must be 0, which is why 17.4(c) is a 404

-- 7. THE INDEXES ARE ACTUALLY USED. Three separate plans, three separate indexes.
EXPLAIN ANALYZE SELECT id FROM activities
 WHERE user_id = '<ACCOUNT 1 id>'
 ORDER BY activity_date DESC, activity_time DESC, id DESC LIMIT 20;
--    expect idx_activities_user_id_activity_date_time, scanned BACKWARD
EXPLAIN ANALYZE SELECT count(*) FROM notifications
 WHERE user_id = '<ACCOUNT 2 id>' AND read = false;
--    expect idx_notifications_user_id_read — this is THE BADGE's query
EXPLAIN ANALYZE SELECT id FROM notifications
 WHERE user_id = '<ACCOUNT 2 id>'
 ORDER BY notif_date DESC, notif_time DESC, id DESC LIMIT 20;
--    expect idx_notifications_user_id_notif_date_time, scanned BACKWARD
```

### 17.7 Implementation notes

**1. The feed's `WHERE` clause is one line, and that is the design.**
`ActivityRepository#findFiltered` is `WHERE a.userId = :userId` plus four
null-guarded filter clauses. **No membership check, no join, no second owner
test.** `activities` and `notifications` are fanned out one privately-owned row
per affected member, so `user_id` *is* the right authorization question here —
which is the exact opposite of V10/V11's shared-ledger tables, where
`created_by_user_id = caller` was the bug ADR 0023 §1 fixed. Both facts are worth
holding at once, because a reviewer arriving from §16 will reasonably suspect this
read of the mistake §16 corrected.

**2. Ordering: the pair, then `id`, and `created_at` nowhere.** Both repositories
order by `(date DESC, time DESC, id DESC)`. The pair is authoritative (contract
item 3); `id` is the primary key and is what makes the order *total*, which is
what makes offset pagination stable when a fan-out writes several rows from one
instant. **This is the one place this backend deviates from Domain 4's
`txn_date, txn_time, created_at, id` shape**, and the deviation is required
rather than stylistic.

**3. Notifications use TWO derived queries, not one JPQL with a null guard.**
`V13` built two indexes for this endpoint — `(user_id, read)` for either filter
value and the badge's count, `(user_id, notif_date, notif_time)` for the
unfiltered newest-first page — and a single `(:read is null or n.read = :read)`
query would put a bind where the planner needs a constant and could use neither
well. The branch is three lines in `NotificationService#listNotifications`. It
also avoids binding a null `Boolean`, which this codebase has no precedent for
(the null `UUID` binds in `findFiltered` do have one).

**4. The activity feed stays JPQL because four optional filters cannot be
derived.** Sixteen combinations, one fixed query shape, every filter a typed bound
parameter, and the `countQuery` supplied explicitly as
`TransactionRepository#findFiltered` does. **Both halves carry the same `WHERE`
clause and must change together.**

**5. `related_*` filters got no index, deliberately.** `V13` created none and
that is still right: every filtered read is also scoped by the caller, so the feed
index supplies `user_id` *and* the ordering and the filter is a cheap recheck over
one user's rows. Four extra indexes would be four extra entries per row on every
fan-out insert, to speed up a secondary filter nobody has measured
(constitution §11). The shape named for later is
`(user_id, related_group_id, activity_date)` and its siblings, `EXPLAIN ANALYZE`
first.

**6. `activityTime`/`notifTime` are formatted Strings, not `LocalTime`.** The
contract says `"HH:mm"`, and `LocalTime`'s own serialization emits `"HH:mm:ss"`
whenever seconds are non-zero — which they almost always are, because the fan-out
writes `OffsetDateTime.now(UTC).toLocalTime()`. One `DateTimeFormatter` per
service, matching `TransactionService`'s own; see §17.8 flag 6.

**7. No logger in either service.** Nothing here is an unexpected exception, an
API failure, a sync status or a performance measurement (constitution §23), and
`GlobalExceptionHandler` already logs anything that escapes. There is deliberately
**no debug logging to leave behind in a production build** — and nothing in this
domain may ever be logged carelessly anyway: a `message` or a
`description_prefix` is a rendered sentence containing a real amount and a real
counterpart's name, i.e. personal financial information.

**8. Validation is Bean Validation on the two query DTOs and nothing else.**
`@Min`/`@Max` on `page`/`size`, typed `UUID`/`Boolean` binding for the rest, both
bound with `@Valid @ModelAttribute`, both reported by the **existing** API-wide
`GlobalExceptionHandler#handleBinding` as `400 VALIDATION_ERROR` with the
offending parameter in `fieldErrors`. **No second mechanism and no new handler was
added.** There is no cross-field rule in either DTO to push into a service.

**9. No `sort` parameter anywhere, and no client string reaches an `ORDER BY`.**
The activities ordering is a literal inside the JPQL; the notifications ordering
is part of two derived method names. Nothing a client sends becomes a field name,
a table name or a SQL fragment (security-architecture.md §12.2).

**10. Rate limiting: confirmed, nothing added.** `ApiRateLimitFilter` keys the
default per-user tier off every `/api/v1/**` path except `/api/v1/auth/**`, and
both new prefixes are under it — verified against the filter's own
`API_PATH_PREFIX`/`AUTH_PATH_PREFIX` check, not assumed. Neither mark-read write
has an external side effect (notifications are poll-based, with no push provider
behind them), so neither warrants a stricter tier.

**11. `SecurityConfig` gained two explicit matchers**
(`/api/v1/activities/**`, `/api/v1/notifications/**`), both method-agnostic,
stated for the same reason as every block above them rather than because
`anyRequest().authenticated()` would miss them. One matcher covers both of §12's
`PATCH` paths.

**12. The transactional rollback trap: checked, and it does not arise.** Stated
rather than omitted, because §3 records how it silently broke two Domain 1
features. `listActivities` and `listNotifications` are `readOnly` and write
nothing; `markRead` decides its only rejection — the `404` — **before** it mutates
anything; `markAllRead` issues one statement and cannot throw afterwards. **No
`noRollbackFor` exists anywhere in this domain and none is needed.** Re-check if
either write ever gains a follow-on step that must survive a later rejection.

**13. No new dependency, no entity change, no migration request.** Both entities
and both repositories already existed; this section added read methods, one bulk
update, four DTOs, one exception, two services and two controllers.

### 17.8 Key assumptions and flags — Domain 7

**1. THE UNREAD-COUNT ENDPOINT — recommended, not built (`V13` FLAG 3).** The
badge is served by `GET /notifications?read=false` → `PageResponse.totalElements`,
which is what the contract supports and what `idx_notifications_user_id_read`
serves. The recommendation, with the exact index that would serve it and the
reason no schema change is involved, is in §17.5. **It needs a System Architect
ruling, because it is an addition to `api-overview.md` §12.**

**2. §11.1's PAGINATION IS IMPLEMENTED AS WRITTEN, AND IS STILL THAT DOCUMENT'S
OWN UNCONFIRMED ADDITION (`V13` FLAG 4).** §11.1 says so itself: "pagination is
this document's own addition... flag back if a plain unpaginated array was
actually intended." Implemented, with `page`/`size` defaults `0`/`20`, because an
unpaginated array is the wrong default for **the one table in this schema that
grows without bound and is never deleted from**. If the Project Owner wants a
plain array, it is a controller/service change and no schema impact — but note
that §12.1's pagination is *not* flagged, so dropping §11.1's would leave the two
halves of one screen's data inconsistent. **Related, and inherited:** offset
pagination over a per-user log is fine at this scale and becomes a
keyset-pagination question only if a feed grows into the thousands.

**3. THE DATE/TIME PAIR IS TREATED AS AUTHORITATIVE FOR ORDERING (`V13` FLAG 2,
still unresolved).** `V13` contract item 3 picks the pair and its own FLAG 2 asks
the System Architect to confirm, noting the alternative (order by `created_at`,
keep the pair for display) is "equally defensible and would make the two feed
indexes wrong". This implementation follows contract item 3. **Two consequences
the frontend design pass needs:** `TIME` carries no zone and is **not** a reading
from the user's device — it is the instant the *server* composed the fan-out, in
UTC — so a member in another timezone reads a time that is not theirs, and
`createdAt` is the only field in either response that could be rendered correctly
for a second timezone.

**4. §11.1's FOUR FILTERS COMBINE AS AND, and that is this implementation's
reading.** §11.1 lists them as four optional parameters and states no "exactly one
of" rule — unlike §9.3, which does. AND is the simplest reading and the only one
that needs no invented error code. If "exactly one of" was intended, it is one
guard in `ActivityService` and a new `VALIDATION_ERROR` message.

**5. `MAX_PAGE_SIZE = 100` IS DERIVED, NOT SPECIFIED.** §11.1 and §12.1 give a
default of `20` and no maximum. `100` is Domain 4's number, reused rather than
re-derived so three paginated endpoints cannot drift apart; the reason a cap
exists at all is that an unbounded `size` is a trivially abusable way to make one
request read a whole table. Same flag as §13.10.

**6. THE `"HH:mm"` FORMATTER IS NOW ITS THIRD COPY IN `/backend`**
(`TransactionService`, `ActivityService`, `NotificationService`). Constitution §25
says three duplications is the point to **evaluate** extraction — evaluated and
declined for now: a shared holder would be a new type carrying one field, and the
three contracts could still legitimately diverge. Recorded so the next copy is a
decision rather than an accident.

**7. `activities.type` AND `notifications.type` ARE RETURNED VERBATIM FROM AN
EXTENSIBLE UNION.** Neither column has a vocabulary CHECK, by design, and no
server-side validation of either value was added — there is nothing to validate,
because no request body in this domain carries a `type`. **A client must tolerate
a value it does not know rather than switch exhaustively on it.**

**8. `group_created` ACTIVITIES STILL DO NOT EXIST**, so §11.1's feed can never
return one even though ADR 0008 §1 lists the type. That is §15.8's open System
Architect decision (the sentence, icon, glyph, tone and recipient rule are all
unspecified), inherited here rather than introduced — and the same is true of
`transaction_edited` and of every `notifications` type except `group_expense` and
`settlement`. **The read endpoints are complete; the set of events that feed them
is not.** `overspending` and `reminder` notifications in particular have no
writer anywhere in the backend.

**9. AN UNREGISTERED MEMBER RECEIVES NOTHING, STRUCTURALLY.** Both `user_id`
columns are `NOT NULL` FKs to `users`, so a contact placeholder has nowhere to
receive a row — inherited from §16.6, restated because it is visible from the read
side as "a group of four can produce three activity rows".

### 17.9 Not verified in the session that wrote this

**Nothing in this section has been compiled or run.** There was no shell in that
session, so every statement above is a static reading of `V13`, the contract and
the existing code.

1. **That it compiles.** No `mvn` invocation happened.
2. **That `ddl-auto=validate` passes.** No entity column was added or altered
   here, so the surface is unchanged from §16 — but `V7`–`V13` have still never
   been applied, so `Activity` and `Notification` have still never met a real
   schema.
3. **That the two derived notification method names resolve.**
   `findByUserIdOrderByNotifDateDescNotifTimeDescIdDesc` and
   `findByUserIdAndReadOrderByNotifDateDescNotifTimeDescIdDesc` are the longest
   derived names in this codebase, and `read` is a property whose Lombok accessor
   is `isRead()`. A typo here is a startup failure, not a runtime one — which is
   the good failure mode, but it has not been observed.
4. **That `(:param is null or column = :param)` works for a null `UUID` bind in
   this specific query.** The shape is proven in
   `TransactionRepository#findFiltered`, but that endpoint is itself
   `In progress` — implemented and never run against a server.

   **Update, 2026-10-29.** The shape is now **live-verified for `UUID`**:
   `GET /transactions?categoryId=…` returns `200`, and a `UUID` is bound with a
   concrete type OID, so the placeholder inside `is null` is typed. These four
   filters were audited during the date-parameter fix and deliberately left
   unchanged. **The same idiom is NOT safe for a `LocalDate`, `LocalTime`,
   `OffsetDateTime` or `Instant` parameter** — it produced a hard `500` on two
   endpoints; see §13.11 item 1. If a date filter is ever added to this feed,
   write it as `coalesce`, not as `is null`.
5. **That the explicit `countQuery` and the main query agree** on a real dataset,
   i.e. that `totalElements` matches the number of rows a client can actually page
   through.
6. **That `markAllReadForUser` reports the affected-row count** the way this
   backend's other bulk updates do, and that `read = false` really does make a
   second call write zero rows.
7. **That `@UpdateTimestamp` fires on §12.2's path and does NOT fire on the
   already-read no-op.** §17.6 query 3 is the check and it needs two runs.
8. **That `PATCH /notifications/read-all` is not matched by `/{id}/read`.** The
   segment-count argument is sound for Spring's `PathPatternParser`; it has not
   been observed.
9. **That `/api/v1/activities` (no trailing segment) is matched by the
   `/api/v1/activities/**` security matcher.** The precedent is
   `GET /api/v1/categories` under `/api/v1/categories/**`, which is live-verified —
   so this is an inference from a verified case, not a guess.
10. **That Jackson 3 serialises `LocalDate` as `YYYY-MM-DD` and `OffsetDateTime`
    in `createdAt`** the way §11.1/§12.1 show. This is the **first** time either
    table's rows reach an API surface, so the fan-out's `LocalDate`/`LocalTime`
    columns have never been serialised to a client before.
11. **That the `₹`/`⇄` characters survive the round trip** from a stored sentence
    into a JSON response body.
12. **Performance.** No `EXPLAIN ANALYZE` was run; §17.6 query 7 is the check.
    **No index was requested** — `V13` already creates everything these four
    endpoints read by.
13. **That the Postman collection's JSON parses**, and that requests 165+ chain
    their variables correctly.

### 17.10 Not done / follow-ups — Domain 7

- **`GET /notifications/unread-count` is recommended and not built** (§17.5,
  §17.8 flag 1). It needs a System Architect ruling first. Until then the
  frontend must read `totalElements` from `?read=false&size=1` and **never**
  `content.length`.
- **Two `V13` flags are still open questions for the System Architect, not for
  this agent**: FLAG 2 (is the date/time pair or `created_at` authoritative for
  ordering — contract item 3's answer is implemented) and FLAG 4 (is §11.1
  genuinely paginated). FLAG 1 (`related_settlement_id`) is unchanged and is a
  schema question for the Database Architect: it is one `ALTER` on an **empty**
  table today and an `ALTER` over real audit rows later.
- **Nothing writes a `group_created`, `transaction_edited`, `overspending` or
  `reminder` row**, so four of the six documented types can never appear in these
  responses (§17.8 flag 8). Each needs its sentence/icon/glyph/tone and recipient
  rule specified before a writer can exist. **`transaction_edited` is the one the
  frontend's own Activity Log already renders against mocks**, so it is the most
  likely next ask.
- **Neither table has a `client_id` and neither is in `/sync/pull` yet**
  (`V13`'s closing block). The Domain 8 ruling it asks for is now easier to make,
  because the read shapes exist: both tables are **pull-only** candidates and
  `updated_at` is the cursor column, but `notifications` has a real mutation to
  propagate (mark-read) and `activities` has none, so they may well want
  different cursor treatment.
- **No automated tests**, consistent with Domains 1–6. If one test is written for
  this section, it should be the `updated_at` bump on §12.3 — it is the only
  failure here that is completely invisible from the API.
- **`docs/api/api-overview.md` §11/§12's Status cells still say "Not started"**,
  and §12's endpoint table should gain a count row if flag 1 is accepted. Both are
  System-Architect-owned and were deliberately not edited.
- **Frontend wiring has not happened and must not be improvised.** Four things
  that design pass needs: `descriptionSuffix: ""` is normal and must not be
  treated as missing; the four `related_*` ids may each be `null` and a row must
  render anyway; a notification is **not navigable**; and `notifTime`/`activityTime`
  are server-zone values, not the device's.

---

## 18. Domain 5 — Budget

**Three** endpoints, implemented to `docs/api/api-overview.md` §5.1, §5.2 and
§5.3, against `database/migrations/V14__budget.sql` and every item of its
CONTRACT block.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/budget/active-period` | The caller's most recently **created** period (§5.1) — `404 NO_ACTIVE_PERIOD` when there is none |
| PUT | `/api/v1/budget/periods` | Upsert: `201` for a new period, `200` when an `id` was edited in place (§5.2) |
| GET | `/api/v1/budget/periods/{id}` | One period by id, owner-scoped (§5.3) — the Budget Summary retrospective's read |

**This is the last free-tier backend domain without tables.** After `V14` every
table in `data-model.md`'s approved 20 exists.

> ⚠ **`404 NO_ACTIVE_PERIOD` IS A NORMAL ANSWER, NOT AN ERROR.** ADR 0011's
> post-auth gate calls §5.1 before it can route anywhere, and this `404` is what
> sends a user to Budget Settings. `V14` backfills nothing, so **immediately
> after it applies, every existing account gets this answer** until it saves a
> period. It is deliberately not logged as a failure, and nothing in
> `SecurityConfig` should ever be changed to treat it as a 401/403 condition.

> ⚠ **"THE ACTIVE PERIOD" IS THE MOST RECENTLY *CREATED* ROW, NOT THE ONE
> COVERING TODAY.** `data-model.md` §3.1, §5's intro and ADR 0011 all define it
> that way, and all three leave the "has it ended" comparison to the **client**
> (`endDate` vs. today). There is no `isEnded`/`isActive` field in the response
> to disagree with the client's clock, and **editing an old period does not
> promote it to active** — `created_at` is `updatable = false`.
> **`data-model.md`'s own Indexes section contradicts this**; see §18.6 flag 1.

> ⚠ **THE PERIOD RANGE IS INCLUSIVE ON BOTH ENDS.** `V14` uses
> `daterange(start_date, end_date, '[]')`, so two periods sharing a single day
> **do** overlap while adjacent periods (Jan 31 / Feb 1) **do not**. The service's
> own pre-check matches that exactly — §18.2 is the proof, and an off-by-one here
> is either a user-visible rejection of a legal save or a silently double-counted
> day.

> ⚠ **`V14` IS NEW AND APPLIES ON THE NEXT RESTART. IT NEEDS ONE EXTENSION.**
> `CREATE EXTENSION IF NOT EXISTS btree_gist` is the first statement in the file,
> and without it the migration fails, Flyway rolls the whole file back, and **the
> backend does not boot**. `V1` already does the same thing with `pgcrypto`
> against this exact database, so the role is known to be able to — but
> `ddl-auto=validate` cannot warn about it, and it is the one thing in `V14` that
> can stop a startup. Recovery is one statement from a privileged role plus a
> restart; no data fix, no `flyway repair`.

### 18.1 The `404` for a fresh account, and the first save

Register a brand-new account (so the 8 default categories exist — §12) and read
the gate's first question before saving anything:

```bash
curl -i "http://localhost:8080/api/v1/budget/active-period" -H "Authorization: Bearer $TOKEN"
```

Expect **`404`** with `"error": "NO_ACTIVE_PERIOD"` — and **nothing in the app
log**: no stack trace, no `WARN`. That is the whole assertion. A logged failure
per app launch for the app's own happy path would train a reader to ignore the
log (constitution §23).

Now the first save. `categoryCaps` names **top-level** category ids (take
`foodCategoryId`/`transportCategoryId` from `GET /categories`):

```bash
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
        "periodType": "automatic",
        "startDate": "2026-11-01",
        "endDate": "2026-11-30",
        "amount": 20000.00,
        "categoryCaps": [
          { "categoryId": "<FOOD id>", "monthlyCap": 3000.00 },
          { "categoryId": "<TRANSPORT id>", "monthlyCap": 1500.00 }
        ]
      }'
```

Expect **`201 Created`** and a `BudgetPeriodResponse`. Four things worth checking
on the body rather than assuming:

1. **`categoryCaps[].categoryName` is present and correct**, and **no request
   field supplied it**. The server resolved and snapshotted it from
   `categoryId` (§5.2 — "the client should not be trusted to supply, or be
   burdened with knowing, the current category name").
2. **`amount` and every `monthlyCap` serialise as exact decimals**
   (`20000.00`, not `20000.0` and not a float), because both are `BigDecimal`
   against `numeric(12,2)`.
3. **There is no currency field anywhere** — not on the period, not on a cap. The
   client applies the symbol from §2.1's `defaultCurrencyCode`.
4. **There is no `spent`, `remaining` or `savings` field.** §5.1 defines none; see
   §18.7 for the one that was reported and deliberately not built.

Then re-read §5.1 — it must now be `200` with that same period — and read it back
by id (§5.3):

```bash
curl -s "http://localhost:8080/api/v1/budget/active-period"      -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/budget/periods/<PERIOD id>" -H "Authorization: Bearer $TOKEN"
```

**Both bodies must be identical, including the ORDER of `categoryCaps`.** All
three endpoints read the caps through one repository method ordered by the frozen
name, so the array is byte-stable between calls and between endpoints.

**The edit-in-place half** — same request with the `id` present:

```bash
# 200 OK, NOT 201. Same row, new figures; createdAt must NOT move.
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "id": "<PERIOD id>", "periodType": "custom", "startDate": "2026-11-01",
        "endDate": "2026-11-30", "amount": 25000.00,
        "categoryCaps": [ { "categoryId": "<FOOD id>", "monthlyCap": 4000.00 } ] }'
```

Two assertions that are easy to miss and both matter:

- **`createdAt` is unchanged and `updatedAt` has moved.** `created_at` is the
  read key for "the active period", so an edit must not touch it — otherwise
  editing a historical period would silently make it the current one.
- **Transport's cap is GONE, not merged.** `categoryCaps` is the **complete new
  set** (`V14` contract item 3): a category absent from the array has no cap for
  that period (§3.2's omission-over-null-entry convention). The period's cap rows
  are deleted and re-inserted inside the one transaction.

**`404` for another user's period id**, byte-identical to a nonexistent one:

```bash
# as a SECOND account (§15.1's test2 token)
curl -i "http://localhost:8080/api/v1/budget/periods/<ACCOUNT 1's PERIOD id>" -H "Authorization: Bearer $TOKEN2"
curl -i "http://localhost:8080/api/v1/budget/periods/11111111-1111-1111-1111-111111111111" -H "Authorization: Bearer $TOKEN2"
```

Both are **`404 BUDGET_PERIOD_NOT_FOUND`** with the same message. **Never a
`403`** — that would confirm the id is real (security-architecture.md §2). The
same applies to a `PUT` carrying another user's `id`: it is a `404`, and it does
**not** silently create a period under a client-chosen primary key.

### 18.2 `400 PERIOD_OVERLAP` — and the adjacent periods that must be ACCEPTED

This is the pair that proves the inclusive bounds. Run them back to back against
the November period from §18.1.

```bash
# (a) GENUINELY OVERLAPPING — shares 2026-11-30 and nothing else.
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2026-11-30", "endDate": "2026-12-15",
        "amount": 5000.00, "categoryCaps": [] }'
# -> 400 PERIOD_OVERLAP. ONE SHARED DAY IS AN OVERLAP.

# (b) ADJACENT — starts the day after the existing period ends. LEGAL.
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2026-12-01", "endDate": "2026-12-31",
        "amount": 5000.00, "categoryCaps": [] }'
# -> 201 Created. ADJACENT PERIODS ARE NOT AN OVERLAP.
```

**(b) is the more important of the two.** A rejection there means the pre-check
is a day too wide, and the user cannot set up next month's budget at all — a
failure the user would read as the feature being broken, while (a) failing merely
permits a double-counted day.

The rule, stated once: two closed intervals intersect **iff each starts no later
than the other ends**, which is exactly
`p.startDate <= :endDate and p.endDate >= :startDate` in
`BudgetPeriodRepository#countOverlapping`. That is ADR 0010 §5's "the new
period's `startDate` must be strictly after the old period's `endDate`" expressed
as an intersection test, and it matches `V14`'s `'[]'` bounds exactly.

**Editing a period against itself must not self-collide:**

```bash
# the SAME dates, the SAME id -> 200, not 400. "Excluding the period being edited."
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "id": "<NOVEMBER id>", "periodType": "automatic", "startDate": "2026-11-01",
        "endDate": "2026-11-30", "amount": 21000.00, "categoryCaps": [] }'
```

**And the one `V14` FLAG 4 warns about, which the frontend cannot predict:** edit
November's `endDate` forward into December's range. The server rejects it with
`400 PERIOD_OVERLAP` even though the client compared only against its single
stored `activePeriod`. **`PERIOD_OVERLAP` must render as a real inline error on
Budget Settings**, never as an impossible response.

```bash
# NOVEMBER stretched into DECEMBER -> 400 PERIOD_OVERLAP
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "id": "<NOVEMBER id>", "periodType": "custom", "startDate": "2026-11-01",
        "endDate": "2026-12-10", "amount": 21000.00, "categoryCaps": [] }'
```

**A reversed range is a `400` before any of this runs:**

```bash
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2026-12-31", "endDate": "2026-12-01",
        "amount": 5000.00, "categoryCaps": [] }'
# -> 400 VALIDATION_ERROR, with fieldErrors[].field = "dateRangeValid"
```

**Why that one is load-bearing rather than tidy.** `daterange()` *raises* on a
reversed range with `SQLSTATE 22000` and **no constraint name**, so if it ever
reached the database it could not be translated into any client error at all.
There are three guards: `@AssertTrue` on the DTO (this `400`, with
`fieldErrors`), the service's own re-check in phase 1, and
`chk_budget_periods_date_order`, which is named and so at worst produces an
honest `500`. A **single-day** period (`startDate == endDate`) is legal and must
be accepted — `>=`, not `>`.

### 18.3 The cap rules — subcategory, duplicate, unowned, and a deleted category

```bash
# (a) A CAP ON A SUBCATEGORY -> 400 VALIDATION_ERROR, never 404.
#     The row resolves and is the caller's own; it is simply not eligible
#     (ADR 0019 §4, §5.2). Use the subcategoryId from §12.9.
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2027-01-01", "endDate": "2027-01-31",
        "amount": 5000.00,
        "categoryCaps": [ { "categoryId": "<SUBCATEGORY id>", "monthlyCap": 500.00 } ] }'
# -> 400 "A subcategory cannot have a monthly cap. Set the cap on its parent
#         category instead." — the IDENTICAL message POST/PATCH /categories use.

# (b) THE SAME CATEGORY TWICE IN ONE ARRAY -> 400 VALIDATION_ERROR
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2027-01-01", "endDate": "2027-01-31",
        "amount": 5000.00,
        "categoryCaps": [ { "categoryId": "<FOOD id>", "monthlyCap": 3000.00 },
                          { "categoryId": "<FOOD id>", "monthlyCap": 4000.00 } ] }'
# -> 400 "categoryCaps must not name the same category more than once."

# (c) ANOTHER USER'S CATEGORY, and a nonexistent one -> 404 CATEGORY_NOT_FOUND,
#     identically. The FK guarantees the category EXISTS, not that it is yours.
curl -i -X PUT "http://localhost:8080/api/v1/budget/periods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "periodType": "custom", "startDate": "2027-01-01", "endDate": "2027-01-31",
        "amount": 5000.00,
        "categoryCaps": [ { "categoryId": "<ACCOUNT 2 CATEGORY id>", "monthlyCap": 100.00 } ] }'

# (d) a non-positive cap, and a non-positive amount -> 400 with fieldErrors
#     (Bean Validation, before the CHECK constraints)
```

**Rejection order is a decision, not an accident:** the duplicate check runs
first (a request-shape rule, no database round trip, reveals nothing about the
ids), then ownership (`404`), then the top-level rule (`400`). And **nothing is
written until all of them pass** — see §18.5's rollback audit.

**(e) A CAP WHOSE CATEGORY IS LATER DELETED — the row survives, the id goes
`null`, the name stays.** This is the one behaviour of this domain a test would
be most likely to get backwards:

```bash
# Save a period capping a disposable category, then delete that category (§12.10).
curl -s -X DELETE "http://localhost:8080/api/v1/categories/<DISPOSABLE id>" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8080/api/v1/budget/periods/<PERIOD id>" -H "Authorization: Bearer $TOKEN"
```

The cap entry is **still there**, with `"categoryId": null` and its **original
`categoryName`**. *(Since ADR 0024 §4.6 the stored `category_id` is kept — check
it in SQL — and the `null` is produced by the read's liveness join; see §12.11.)* Three things that must NOT have happened: it was not reassigned
to `Misc` (that would rewrite a budget the user never set), it was not
cascade-deleted (that would erase a figure the user really chose), and it did not
disappear from the array. A rename behaves the same way — **the saved snapshot
does not change** (`data-model.md` §3.2 as amended by ADR 0021 §2.5). **Any test
asserting that a rename or delete updates a saved cap is asserting the opposite
of the specification.**

### 18.4 The DB checks to run

```sql
-- 1. The extension actually installed (the one thing validate cannot check).
SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'btree_gist');

-- 2. All seven constraints and both indexes exist under the names the service
--    matches on. The two the service translates are the last two rows.
SELECT conname, contype FROM pg_constraint
 WHERE conrelid IN ('budget_periods'::regclass, 'budget_period_category_caps'::regclass)
 ORDER BY conrelid::text, conname;
--  expect, among others: excl_budget_periods_user_period_overlap        (contype 'x')
--                        uq_budget_period_category_caps_period_category (contype 'u')

-- 3. The active-period read is an index scan, not a sort of the whole table.
EXPLAIN ANALYZE
SELECT * FROM budget_periods WHERE user_id = '<USER id>'
 ORDER BY created_at DESC, id DESC LIMIT 1;
--  expect idx_budget_periods_user_id_created_at, scanned backwards.

-- 4. created_at did NOT move on the edit, and updated_at did.
SELECT id, created_at, updated_at, created_at = updated_at AS never_edited
  FROM budget_periods WHERE user_id = '<USER id>' ORDER BY created_at DESC;

-- 5. THE CAP REPLACEMENT LEFT NO ORPHANS. After the §18.1 edit, the November
--    period must hold exactly ONE cap row — not two, and not three.
SELECT p.id, count(c.id) AS caps
  FROM budget_periods p
  LEFT JOIN budget_period_category_caps c ON c.budget_period_id = p.id
 WHERE p.user_id = '<USER id>' GROUP BY p.id ORDER BY p.id;

-- 6. A deleted category's cap: id NULL, name intact (§18.3(e)).
SELECT category_id, category_name, monthly_cap
  FROM budget_period_category_caps WHERE budget_period_id = '<PERIOD id>';

-- 7. NO period of one user overlaps another of the same user. The exclusion
--    constraint guarantees this; the query is here to prove the pre-check and
--    the constraint agree rather than to find a violation.
SELECT a.id, b.id FROM budget_periods a JOIN budget_periods b
    ON a.user_id = b.user_id AND a.id <> b.id
   AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');
--  expect ZERO rows.

-- 8. The adjacency case, stated as SQL so the semantics are checkable without
--    the API: these two must NOT be reported as overlapping.
SELECT daterange('2026-11-01','2026-11-30','[]') && daterange('2026-12-01','2026-12-31','[]') AS adjacent_overlaps,
       daterange('2026-11-01','2026-11-30','[]') && daterange('2026-11-30','2026-12-15','[]') AS shared_day_overlaps;
--  expect false, true.
```

### 18.5 Implementation notes

**Two entities, no association.** `BudgetPeriod` and `BudgetPeriodCategoryCap`
both map their foreign keys as bare `UUID`s, like every other entity in this
codebase: nothing in this domain navigates an object graph, and a lazy
`@OneToMany` would add a proxy that earns its keep nowhere. The caps load in one
query per period (`findByBudgetPeriodIdOrderByCategoryNameAscIdAsc`), never one
per cap.

**`period_type` is a validated `String`, not an enum.** `V14` deliberately puts
no CHECK on the column (V7's test: nothing keys off the literal and it partitions
no money), so the `@Pattern(regexp = "automatic|custom")` on the request DTO is
the **only** vocabulary guard in the system. An enum plus `AttributeConverter`
would add a type with no reader, and Jackson's enum binding is case-sensitive on
the constant name (`AUTOMATIC`) while the contract's values are lowercase — the
same reason `ListTransactionsQuery` validates literals.

**The server does not recompute an `automatic` period's dates.** §5.2 requires
`startDate`/`endDate` on every request regardless of `periodType`, and ADR 0010
§2 puts `getCurrentMonthRange` on the client. `periodType` is recorded as a
display discriminator, nothing more.

**`PUT` is mapped at `/budget/periods`, not at `/{id}`**, exactly as §5.2 defines
it: the optional `id` travels in the body because one request serves both create
and edit, so there is no path variable to disagree with it. The `201`/`200`
choice is the one HTTP fact the body does not carry, so `BudgetService` reports
it via `BudgetPeriodUpsertResult` and `BudgetController` picks the status —
business decision in the service, status code in the controller (constitution
§9).

**The cap replacement is a bulk `DELETE` then inserts, and that order is forced.**
Within one flush **Hibernate issues inserts before deletes**. Loading the old cap
rows and calling `deleteAll` would therefore try to insert the new
`(budget_period_id, category_id)` pairs while the old ones are still present, and
any cap kept across an edit would violate
`uq_budget_period_category_caps_period_category` — a `23505` on a perfectly legal
request. `@Modifying(flushAutomatically = true)` on a JPQL `delete` executes its
own statement at invocation, so the rows are gone before the first insert is
issued. `clearAutomatically` is deliberately **not** set: the caller keeps using
the managed period instance it just saved, whose `created_at`/`updated_at` are
what the response carries.

**`23P01` is mapped by constraint NAME, and no branch in this domain switches on
a SQLSTATE.** `excl_budget_periods_user_period_overlap` raises
`SQLSTATE 23P01` (`exclusion_violation`) — a SQLSTATE this backend had never seen
(every mapped violation so far was 23505 / 23503 / 23514 / 23502, or 23000 from a
trigger). `BudgetService#translateBudgetViolation` walks the cause chain, skips
`null` constraint names (the two `categories` triggers in this same application
raise from plpgsql, where `getConstraintName()` is `null`), folds case and matches
**full** names — never the `chk_budget_`/`fk_budget_` prefixes five of `V14`'s
names share. Because it is organised by name, the new SQLSTATE needed **no new
plumbing at all**; a handler organised by SQLSTATE would have answered `500` for
an ordinary user mistake until someone added a branch.

**The constraint is the race backstop, not the mapping.** `400 PERIOD_OVERLAP`
comes from the service's own pre-check on every sequential request; the
constraint exists for two concurrent `PUT`s that both passed a check taken before
either committed (a double-tapped Save is enough). Same arrangement for the
duplicate-category rule.

**Overlap pre-check, verbatim, because the bounds are the whole correctness
question:**

```
and p.startDate <= :endDate
and p.endDate   >= :startDate
and (:excludeId is null or p.id <> :excludeId)
```

**Date parameters and the `is null` trap.** Neither `LocalDate` appears inside an
`is null` check: each is bound **once**, in a comparison against a
`DATE NOT NULL` column that fixes its type. That is §13.11's rule, and this is the
most date-heavy domain in the backend. `excludeId` **does** use the
`(:param is null or …)` idiom, which is correct for a `UUID` — the driver binds it
with a concrete type OID, which is exactly why `scope`/`type`/`categoryId` survive
the idiom in `TransactionRepository` and the dates could not.

**One query for the whole `categoryCaps` array.** The caller's complete category
list is read once — the same read `GET /categories` performs — and both the name
and the level come out of it, so a 30-entry array costs one round trip instead of
30 (constitution §10). Nothing is read at all when the array is empty.

**Bean Validation only, through the existing handlers.** The request body is
`@Valid @RequestBody`, so failures arrive as `MethodArgumentNotValidException`
and land on the handler Domain 1 added; the cross-field date rule is an
`@AssertTrue` on a derived property (`dateRangeValid`), the pattern
`CategoryStatisticsQuery` established, so it reports through the same
`fieldErrors` shape and needs no new exception type. **No second validation
mechanism was introduced, and no new `@ExceptionHandler` was added** — §5 has no
query parameters at all, so the `BindException` handler is not even reached here.

**Two derived bounds that are NOT contract figures, flagged rather than
smuggled:** `@Size(max = 100)` on `categoryCaps` (§5.2 states no maximum; it
bounds the one request in this domain that writes an unbounded number of rows,
and the duplicate rule makes the real ceiling "one per category" anyway), and the
`id` tie-break on the active-period ordering (`V14` writes the query as
`ORDER BY created_at DESC LIMIT 1` with no tie-break; two periods cannot normally
share a `created_at`, but "normally" is not a guarantee and an endpoint whose
answer could flip between two rows would be a hard bug to see).

**Omitting `categoryCaps` entirely is read as an empty array**, and the
consequence is stated here so a client cannot discover it: **on an edit, omitting
the key CLEARS the period's caps.** That is the correct reading of a `PUT` — the
array is the complete new set — rather than a lenience, and the alternative
("leave the existing caps alone") would smuggle `PATCH` semantics into a `PUT`.
§5.2 marks the field neither required nor optional, so rejecting an omission would
reject a request the contract does not forbid.

**No new dependency, no new column, no schema request.** The entities match
`V14` column for column (8 and 7 columns), which is what `ddl-auto=validate`
checks.

### 18.6 Key assumptions and flags — Domain 5

**1. `data-model.md`'s INDEXES SECTION CONTRADICTS §3.1 AND §5 ABOUT WHAT "THE
ACTIVE PERIOD" IS — flagged, not resolved.** §3.1, §5's intro and ADR 0011 all
say "most recently **created**, regardless of whether `end_date` has passed — the
client determines 'ended' status itself". The Indexes section says
`budget_periods(user_id, end_date)`, labelled "active-period lookup and the 'has
this period ended' check", which describes a *different* definition: an
`end_date` index cannot answer "newest by creation", and the "has it ended" check
is explicitly the client's job in the two sections that define the endpoint. The
Database Architect flagged this (`V14` FLAG 1), built
`idx_budget_periods_user_id_created_at`, and recorded that the brief which
commissioned `V14` described §5.1 as "the period covering today" — a **third**
reading. **This implementation follows `(user_id, created_at)` / most-recently-created**,
because two sections and an ADR outrank one index annotation and because the
endpoint contract is what a client depends on. **The System Architect should amend
whichever of the two documents is wrong.** If "covering today" is what is
actually wanted it is a different endpoint semantics (and now at most one period
can cover today, thanks to the exclusion constraint), it needs §3.1/§5 amended
rather than an index added, and the GiST index `V14` already creates serves it
(`… @> CURRENT_DATE`) with no new object.

**2. ADR 0010 §5's "the period being saved must itself satisfy `endDate >= today`"
IS NOT ENFORCED SERVER-SIDE, and that is a deliberate non-decision.** `V14`'s
comment says the rule "stays service-layer, where ADR 0010 already puts it" — but
ADR 0010 §5 puts it on the **Budget Settings screen** ("blocks Save with an
inline error"), and **§5.2's error table defines no code for it**. Implementing it
would mean rejecting a request the approved contract accepts, which constitution
§15/§30 forbids; not implementing it means a client could save a wholly historical
period. The second is recoverable and the first is a contract change, so the
rule is **left to the client** and flagged here. **If the Project Owner wants it
server-side, it is four lines in `BudgetService`'s phase 1** plus a line in
§5.2's error table — and note it cannot be a CHECK constraint, because
`CURRENT_DATE` is not immutable and a dump/restore would start rejecting rows
that were legal when written.

**3. `PERIOD_OVERLAP` IS REACHABLE FROM A SCREEN THAT BELIEVES IT CANNOT
HAPPEN** (`V14` FLAG 4). The frontend compares a new period only against its
single stored `activePeriod`; the server compares against **all** of the user's
periods, which is §5.2's rule and not a tightening invented here. The Frontend
Engineer needs to render this as a real inline error.

**4. ADR 0021's OPEN QUESTION 3 STAYS OPEN, and nothing here answers it.** Does a
category rename reach a **saved** period's frozen cap name? Today's specified
behaviour is "no" (§3.2 as amended by ADR 0021 §2.5), and that is what is
implemented: **no propagation of any kind touches
`budget_period_category_caps`**, and no read joins `categories` to freshen the
name. If the answer becomes "yes", it is one `UPDATE` added to
`PATCH /categories/{id}`, it needs no schema change, and
`idx_budget_period_category_caps_category_id` already keeps it off a full scan —
but it **cannot be scoped by `user_id`** (this table has no such column), which
that pass must accept rather than discover.

**5. `GET /budget/active-period` is NOT what the Statistics tab aligns against.**
ADR 0022 §2 already settled that: the client reads this endpoint and passes the
period's dates as §14.1's `dateFrom`/`dateTo`. There is deliberately no
`budgetPeriodId` parameter on Statistics and no join between the two domains.

**6. Caps are top-level-only and ONLY THIS SERVICE ENFORCES IT.** `V14` FLAG 3
argues at length for not enforcing it structurally — the fact lives on another
table's row, and the roadmap (ADR 0019 §4, `data-model.md` Open Question #6(a))
already plans to allow per-subcategory caps. So there is no CHECK, no trigger and
no composite FK behind `BudgetService#resolveCaps`; if that check is ever removed,
subcategory caps become storable immediately.

**7. A parent's cap is INCLUSIVE of its subcategories' spending** (ADR 0019 §4,
§5.2). Nothing in this domain computes a comparison yet, so the rule is recorded
rather than exercised — but it is the ruling any future "spent vs cap" endpoint
must follow, and an exclusive reading would mean a user who caps `Food` and tags
everything `Food › Snacks` has a cap that never fires.

### 18.7 REPORTED, NOT BUILT — a server-computed `spent` for a period

**The gap is real.** The Dashboard derives `spent` by summing the transaction
rows it has **loaded**, and `GET /transactions` is paginated, so the figure
silently understates as soon as a period has more transactions than one page.
Every other term of "Monthly Budget → spent → remaining" is now server-authoritative;
this one is a client-side partial sum.

**Budget is the natural owner, and the schema already supports it efficiently.**
The Database Architect confirmed `idx_transactions_user_id_txn_date` (V7, index 1
of 3) is exactly the right shape — equality on `user_id`, range on `txn_date`:

```sql
SELECT coalesce(sum(t.amount), 0) FROM transactions t
 WHERE t.user_id = $1 AND t.type = 'expense' AND t.deleted_at IS NULL
   AND t.txn_date BETWEEN $2 AND $3;   -- the period's start_date, end_date
```

**It is deliberately not built, because adding a field to §5.1's response shape
is an API contract change and therefore the System Architect's call**
(constitution §15/§30). What it would take, so the decision can be made rather
than estimated:

- **One field on `BudgetPeriodResponse`** (`spent`, `numeric(12,2)` → `BigDecimal`)
  and one repository method. No schema change, no new index, no new dependency.
- **A ruling on which endpoints carry it.** §5.1 and §5.3 are both plausible;
  §5.2's response is the same record, so it would carry it too and the figure
  would be computed on a write path.
- **A ruling on income.** The query above excludes it (`type = 'expense'`), which
  matches the Dashboard's behaviour and ADR 0018's rule that `type` is the sole
  money-direction discriminator.
- **The per-cap breakdown is a bigger ask and should not be bundled.** Comparing
  each cap against its own spending adds `AND t.category_id = ANY($4)` with the
  capped category's id **plus its subcategory ids** (the inclusive rule, §18.6
  flag 7), and wants `transactions(user_id, category_id, txn_date)` — an index
  already deferred by name in three places (V7, V8, ADR 0021's Performance
  section) and wanted by ADR 0022's reads too. It should be created **once**,
  after `EXPLAIN ANALYZE` on real rows.
- **A cap whose category was deleted has no spend to compare.** Its `category_id`
  is `NULL` and its transactions now point at `Misc`; attributing that spending
  back would mean matching on the frozen **name**, which this schema refuses to do
  anywhere. Such a cap must render as a historical figure with no live comparison.

**My recommendation: yes, §5.1 (and §5.3) should carry `spent`.** Three reasons.
The period total is one indexed aggregate over a range the response already
states, so the cost is one query on an endpoint called once per app launch. The
client cannot compute it correctly at all without fetching every page of
transactions, which is strictly more expensive and is what the overspend warning
already depends on. And the alternative — a separate `GET /budget/periods/{id}/spent` —
splits one screen's data across two requests on the app's launch path for no
gain. **The per-cap breakdown should wait** for the measured index. This is a
recommendation only; no code was written for it.

### 18.8 Not verified in the session that wrote this

**Nothing in this section has been compiled or run.** There was no shell in that
session, so every statement above is a static reading of `V14`, the contract and
the existing code.

1. **That it compiles.** No `mvn` invocation happened.
2. **That `ddl-auto=validate` passes against `V14`.** Both entities are new, so
   they have never met a real schema. The rows worth double-checking are
   `period_type` (`varchar(10) NOT NULL`, mapped as `String` with `length = 10`),
   both `numeric(12,2)` money columns (`BigDecimal`, `precision = 12, scale = 2`)
   and the **nullable** `category_id` (a reference `UUID`, deliberately).
3. **THAT THE MIGRATION APPLIES AT ALL.** `V14` is the first migration in this
   project to need `btree_gist`. If the role cannot create the extension, Flyway
   rolls the file back and the backend does not boot — which is loud and safe, but
   it has not been observed.
4. **That `getConstraintName()` is populated for `SQLSTATE 23P01` on this
   stack.** It is live-verified for `23505` (the Project Owner confirmed it for
   Domain 3's partial unique indexes), and Hibernate's SQL-state **class** `23`
   handling should treat an exclusion violation identically — but that is
   reasoning, not a run. **If it comes back `null`, the race loser becomes a
   logged `500` instead of a `400 PERIOD_OVERLAP`.** Only the *concurrent* case is
   affected: every sequential overlap is answered by the pre-check. The fix would
   be local to `BudgetService#translateBudgetViolation`.
5. **That `@AssertTrue` on a derived property of a `record` is picked up** by
   Hibernate Validator the way it is on `CategoryStatisticsQuery` (a plain class).
   `isDateRangeValid()` is a JavaBean-style getter, so it should be validated as
   the property `dateRangeValid` — and if it is not, the service's own phase-1
   re-check still answers `400 VALIDATION_ERROR`, just without `fieldErrors`. That
   is the whole reason the service re-checks.
6. **That `findFirstByUserIdOrderByCreatedAtDescIdDesc` derives correctly.** A
   typo in a derived name is a `PropertyReferenceException` at boot, not a runtime
   surprise.
7. **That `@Modifying(flushAutomatically = true)` really does order the `DELETE`
   before the subsequent inserts** on an edit that keeps a cap. This is the single
   most likely place for a `23505` on a legal request, and §18.4 query 5 is the
   check.
8. **That `PUT /api/v1/budget/periods` and `GET /api/v1/budget/active-period` are
   both matched by the `/api/v1/budget/**` security matcher.** The precedent is
   `GET /api/v1/categories` under `/api/v1/categories/**`, which is live-verified.
9. **That `201` vs `200` comes out right on both paths**, and that a `PUT`
   carrying another user's `id` is a `404` rather than a silent create.
10. **Performance.** No `EXPLAIN ANALYZE` was run; §18.4 queries 3 and 7 are the
    checks. **No index was requested** — `V14` already creates everything these
    three endpoints read by.
11. **That the Postman collection's JSON parses**, and that requests 192+ chain
    `budgetPeriodId`/`decemberPeriodId` correctly.

### 18.9 Not done / follow-ups — Domain 5

- **`spent` is reported and not built** (§18.7). It needs a System Architect
  ruling. Until then the Dashboard's figure stays a client-side partial sum, and
  that is a known, named inaccuracy rather than a bug to hunt.
- **`data-model.md`'s Indexes section and §3.1 still contradict each other**
  (§18.6 flag 1). One of them needs amending; this agent implemented the endpoint
  contract and must not be the one to decide.
- **ADR 0010 §5's `endDate >= today` save rule is client-side only** (§18.6
  flag 2). One ruling away from being four lines in the service.
- **ADR 0021's Open Question 3 (does a rename reach a saved cap?) is still the
  Project Owner's** (§18.6 flag 4). Cheap either way, and cheaper now than after
  real periods accumulate.
- **No period DELETE endpoint, and deleting a period with caps is blocked by the
  child FK.** §5 defines no delete, so nothing regresses — but if one is ever
  designed, `ON DELETE CASCADE` on
  `fk_budget_period_category_caps_budget_period_id` is the obvious candidate,
  because a cap has no meaning without its period.
- **`budget_periods` has no `client_id` and no `version`, and is in no sync
  path.** `V14`'s closing block flags this as a **Domain 8 ruling**: a budget
  period is user-authored and therefore a plausible offline write, unlike the
  server-derived balances. If `/sync/push`'s `entityType` list gains
  `budget_period`, this table needs a client-supplied idempotency key, and adding
  one after rows exist is the deferral V7 identified as having a growing cost.
- **No automated tests**, consistent with Domains 1–7. If one test is written for
  this section, it should be the adjacency pair (§18.2 (a) and (b)): it is one
  assertion away from being wrong in either direction, and both directions are
  user-visible.
- **`docs/api/api-overview.md` §5's three Status cells still say "Not started"**,
  and `data-model.md` §3.1/§3.2 carry no "implemented" marker. Both are
  System-Architect-owned and were deliberately not edited.
- **Frontend wiring has not happened and must not be improvised.** Four things
  that design pass needs: the `404 NO_ACTIVE_PERIOD` is the **routing signal**,
  not an error toast; `PERIOD_OVERLAP` must render inline (§18.6 flag 3);
  `categoryCaps` is the **complete set** on every save, so the client must send
  every cap it still wants; and a cap may come back with `categoryId: null`, which
  means its category was deleted and the entry must still render from its frozen
  name.

## 19. ADR 0025 — multiple payers per split expense (2026-11-06)

Source of truth: `docs/decisions/0025-multiple-payers-per-split-expense.md` and
`docs/api/api-overview.md` §9.1 / §9.3 (2026-11-06 changes). Project Owner
ruling: a split expense can have **more than one payer**, in the **free tier**.
There is **no premium gate** anywhere on this path. **No new endpoint, no new
error code, no new dependency.**

> **⚠ V16 AND THIS BACKEND CHANGE MUST SHIP TOGETHER.**
> `database/migrations/V16__split_expense_payers.sql` creates
> `split_expense_payers` and backfills one payer row per existing split.
> - Backend without V16: `ddl-auto=validate` fails on the new `SplitExpensePayer`
>   entity and the server does not boot.
> - V16 without this backend: every split created by the old code has **no payer
>   row**. The read path tolerates that (it answers from `paid_by_*` and logs a
>   `WARN` naming the split id), but the ledger contract assumes one or more rows.
>
> Restart once, with both in place.

### 19.1 What changed

- **Request (§9.1):** optional `payers[]` of `{ payerUserId | payerContactId, amount }`.
  Exactly one payer form per request: the legacy `paidByUserId`/`paidByContactId`,
  **or** `payers[]`. The legacy form is **not** deprecated. It is treated as
  `payers: [{ <that identity>, amount: <amount> }]`, so queued sync payloads keep
  working.
- **Primary payer:** largest `amount`, tie → first in request order. It is written
  to `split_expenses.paid_by_*`, so V11's XOR CHECK still holds on every row.
- **Response (§9.3):** `payers[]` is **always populated, never empty**. Order:
  primary first, then `amount` descending, ties by row id in PostgreSQL's
  **unsigned** uuid order. `paidByUserId`/`paidByContactId`/`paidByName` are
  **deprecated** but still populated with the primary payer, so `payers[0]`
  always matches them.
- **Ledger:** every identity moves by `net = paid − share`.
  - Group: the old single `+amount` payer credit is replaced by two set-based
    `INSERT ... SELECT ... ON CONFLICT DO UPDATE` statements over
    `split_expense_payers` (one per member kind). The zero-sum and row-count
    assertion still runs in the same transaction.
  - Individual: the pair row moves by `paid(left) − share(left)`. "Left" is the
    caller on a contact row, and the stored `user_id` on a canonical row. It is
    read off the row, never re-derived, so the unsigned-uuid trap (§16.5 note 2)
    cannot regress here.
- **Consumption-share transaction: unchanged.** It is still the caller's
  **participant share**, never what they paid. A caller who paid ₹700 of a
  ₹1,000 bill and consumed ₹500 gets a ₹500 transaction.
- **Activity sentences:** single-payer splits are **byte-identical** to before.
  2+ payers use ADR 0025 §6.2 (`You and Raj paid ₹1,000 in Goa Trip for "Dinner".`,
  `Het, Raj and 2 others paid …`, individual: `You and Raj paid ₹1,000 for "Dinner".`).
  Notifications are unchanged.

### 19.2 The payer rules — all `400 VALIDATION_ERROR`

| # | Request | Message |
|---|---|---|
| R1a | `payers` **and** a `paidBy*` field | `Provide either paidByUserId/paidByContactId or payers, not both.` |
| R1b | neither form | `Exactly one of paidByUserId or paidByContactId is required.` (unchanged) |
| R1c | `payers: []` | Bean Validation field error on `payers` |
| R2 | an entry with neither or both ids | `Each payer must have exactly one of payerUserId or payerContactId.` |
| R3 | one identity twice — as sent, **or** after individual-mode normalisation (a linked contact's id + its account's id) | `The same person is listed more than once in payers.` |
| R4 | `Σ payers[].amount ≠ amount` (exact) | `Payer amounts must add up exactly to the split amount.` |
| R5 | an entry `amount <= 0` or > 2 decimals | Bean Validation field error on `payers[n].amount` |
| R6 | group payer who is not a member | existing `notAGroupMember()` message |
| R7 | individual payer who is neither party | existing `notAPartyToThePair()` message |

All are decided **before the first write**, so the rollback audit in
`SplitExpenseService`'s Javadoc still holds. A payer **need not be a
participant**.

**The seven V16 constraint names are backstops only and map to a logged `500`**
through `GlobalExceptionHandler`'s generic handler: the two CHECKs (`23514`), the
two `uq_split_expense_payers_*` UNIQUEs (`23505`) and the three FKs (`23503`).
None is mapped to a `409` or to any client code. Reaching one means a service rule
above was skipped.

### 19.3 Manual test (curl)

Reuses §16's fixtures: `$TOKEN` (account 1), `$GROUP_ID`, `$ME`, `$OTHER`
(account 2's user id), `$LINKED_CONTACT` (account 1's contact linked to account 2),
`$UNLINKED_CONTACT`.

```bash
# (a) GROUP, two payers. ₹900 split three ways; I paid 600, account 2 paid 300.
#     Net: me +300, account 2 0, the unlinked placeholder -300. Sum 0.
curl -s -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "title": "Dinner", "splitDate": "2026-11-06", "amount": 900.00,
  "splitMode": "group", "groupId": "'$GROUP_ID'", "splitMethod": "equally",
  "payers": [
    { "payerUserId": "'$ME'", "amount": 600.00 },
    { "payerUserId": "'$OTHER'", "amount": 300.00 }
  ],
  "participants": [
    { "participantUserId": "'$ME'", "amount": 300.00 },
    { "participantUserId": "'$OTHER'", "amount": 300.00 },
    { "participantContactId": "'$UNLINKED_CONTACT'", "amount": 300.00 }
  ],
  "addToPersonalExpenses": true }'
# -> 201. payers[0] is me (600), payers[1] account 2 (300).
#    paidByUserId == payers[0].payerUserId. The personal transaction is 300, NOT 600.

# (b) INDIVIDUAL, both parties paid. ₹1000 split equally; I paid 700, they paid 300.
#     My view of the pair moves by +200 (they owe me 200 more).
curl -s -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "title": "Dinner", "splitDate": "2026-11-06", "amount": 1000.00,
  "splitMode": "individual", "individualCounterpartContactId": "'$LINKED_CONTACT'",
  "splitMethod": "equally",
  "payers": [
    { "payerUserId": "'$ME'", "amount": 700.00 },
    { "payerContactId": "'$LINKED_CONTACT'", "amount": 300.00 }
  ],
  "participants": [
    { "participantUserId": "'$ME'", "amount": 500.00 },
    { "participantContactId": "'$LINKED_CONTACT'", "amount": 500.00 }
  ],
  "addToPersonalExpenses": false }'

# (c) R3 after normalisation -> 400. Same person spelled two ways:
#     "payers": [ { "payerUserId": "'$OTHER'", "amount": 300.00 },
#                 { "payerContactId": "'$LINKED_CONTACT'", "amount": 700.00 } ]

# (d) Tie-break: payers [{ $OTHER, 450 }, { $ME, 450 }] -> payers[0] and
#     paidByUserId are $OTHER (first in request order).
```

Postman: requests **245-269** in `postman/MyExpense-Auth.postman_collection.json`
cover every case above plus R1a/R1b/R1c/R2/R4/R5/R6/R7, the legacy single-payer
response, a contact-row pair, and the canonical pair recorded from **both**
sides (so one run always has the caller as the right side, whichever uuid is
lesser).

### 19.4 DB checks to run

```sql
-- 1. Every split has >= 1 payer row and the amounts sum exactly. MUST return no rows.
SELECT se.id, se.amount, sum(p.amount_paid) AS paid_total, count(p.id) AS payer_rows
  FROM split_expenses AS se
  LEFT JOIN split_expense_payers AS p ON p.split_expense_id = se.id
 GROUP BY se.id, se.amount
HAVING count(p.id) = 0 OR sum(p.amount_paid) IS DISTINCT FROM se.amount;

-- 2. paid_by_* names ONE OF the split's payer rows with the LARGEST amount_paid
--    (V16 FLAG 1: not "the only payer row"). MUST return no rows.
SELECT se.id
  FROM split_expenses AS se
 WHERE NOT EXISTS (
       SELECT 1 FROM split_expense_payers AS p
        WHERE p.split_expense_id = se.id
          AND p.payer_user_id    IS NOT DISTINCT FROM se.paid_by_user_id
          AND p.payer_contact_id IS NOT DISTINCT FROM se.paid_by_contact_id
          AND p.amount_paid = (SELECT max(p2.amount_paid) FROM split_expense_payers AS p2
                                WHERE p2.split_expense_id = se.id));

-- 3. Zero-sum per group, as in §16.4. MUST return no rows.
SELECT b.group_id, sum(b.balance)
  FROM group_member_balances AS b
 GROUP BY b.group_id
HAVING sum(b.balance) <> 0;
```

### 19.5 Implementation notes

- **New:** `entity/SplitExpensePayer`, `repository/SplitExpensePayerRepository`,
  `dto/request/SplitPayerRequest`, `dto/response/SplitPayerSummary`,
  `service/SplitPayerResolver`.
- **`SplitExpensePayerRepository` extends the bare Spring Data `Repository`**, not
  `JpaRepository`, and declares only `saveAllAndFlush` and
  `findBySplitExpenseIdIn`. It therefore inherits **no** `delete*`, `deleteAll*`
  or `save`-as-update. That is the strictest code-level form of ADR 0024's no-hard-
  delete rule and ADR 0025 §2.5's insert-only rule.
- **`SplitPayerResolver`** holds the pure request-shape rules (R1-R4) and the
  primary-payer choice. It was extracted, as ADR 0025 Backend item 4 asks, so
  `SplitExpenseService` does not grow further. Rules needing the resolved target
  (R6, R7, R3 after normalisation) stay in the service.
- **One definition of payer order:** `SplitExpenseResponseAssembler#orderForResponse`.
  The response and the activity labels both use it. Its id tie-break is
  `IndividualBalanceService#compareCanonical` (unsigned), never `UUID#compareTo`.
- **Response build is 4 queries** for any page size: participants, payers, user
  names, contact names. Payer names are resolved from the payer rows, not from
  `paid_by_*` (ADR 0025 §3's reading rule).
- **Removed:** `GroupMemberBalanceRepository#applyDeltaToRegisteredMember` /
  `#applyDeltaToContactMember`. They had no caller left (constitution §17).
- **`GroupBalanceService#applySplitExpenseDeltas`** now takes
  `(groupId, splitExpenseId, registeredParticipants, contactParticipants,
  registeredPayers, contactPayers)`. It runs at most four statements, independent
  of participant and payer count.
- **Fan-out:** `ActivityFanoutService.SplitSavedFanout` replaced
  `payerUserId`/`payerName` with `List<Payer> payers` (`Payer(userId, name)`), in
  response order. With one payer, the single-payer code path runs unchanged. With
  2+, there is one activity INSERT per registered payer recipient (ADR 0025 §6.3's
  accepted relaxation).
- **Unit tests (no DB):** `ActivitySentencesMultiPayerTest` (joiner, 2+-payer
  templates, single-payer byte identity), `SplitPayerResolverTest` (R1a/R1b/R2/R3/
  R4, tie-break), `SplitPayerOrderTest` (unsigned-uuid tie order). Run with
  `mvnw.cmd -q test -Dtest=ActivitySentencesMultiPayerTest,SplitPayerResolverTest,SplitPayerOrderTest`,
  which avoids `BackendApplicationTests`' database requirement.
- **Security:** the endpoint is unchanged, so the existing rate-limit filter covers
  it. Every new SQL statement is fixed text with bound parameters. Logs carry ids
  and counts only, never an amount or a name.

### 19.6 Key assumptions and flags

1. **A split expense with no payer row** (created by old code after V16) is
   answered from `paid_by_*` with `amount_paid = amount`, plus a `WARN` log. That
   is exactly what V16's backfill would have written. The alternative, a `500` on
   every read of that group's history, was judged worse. Flagged for the System
   Architect.
2. **Individual mode with two payers and a non-payer registered recipient** cannot
   happen (R3 + R7 leave both parties as payers). The fan-out throws
   `IllegalStateException` (→ rolled-back `500`) if it ever does, rather than
   inventing a sentence ADR 0025 §6.2 does not define.
3. **Payers who are not participants** are legal (ADR 0025 §5.1), so a payer may
   end with a positive net and no share. No new rule was added.

### 19.7 Not verified in the session that wrote this

- `mvnw compile` / the unit tests: the session had no shell, so **nothing was
  compiled or run**. Run `backend\mvnw.cmd -q compile` and the test command in §19.5
  first.
- The server was not booted (DB/JWT secrets are per-terminal). `ddl-auto=validate`
  against V16, the Postman block and the §19.4 queries are all unrun.
- Spring Data routing of the selectively-exposed `saveAllAndFlush` on a bare
  `Repository` interface is the documented "selectively exposing CRUD methods"
  pattern. It has not been exercised live in this codebase before.

### 19.8 Follow-ups

- **Frontend (ADR 0025 §8):** send `payers[]` only for 2+ payers and omit
  `paidBy*` then; read `payers[]`; and fix `SplitDetailScreen`'s `netForRow`, which
  is wrong for any multi-payer split.
- **Removing the deprecated `paidBy*` response fields** needs its own ADR, once
  every client reads `payers[]`.

## 20. ADR 0026 — multi-contact individual splits (2026-11-11)

Source of truth: `docs/decisions/0026-multi-contact-individual-splits.md` and
`docs/api/api-overview.md` §8.1 / §9.1–§9.3 (2026-11-11 changes). Project Owner
ruling: an Individual split may include **several contacts** (the caller plus
1..N contacts), **free tier**, and **all debts route through the creator**. There
is **no premium gate** anywhere on this path. **No new endpoint, no new error
code, no new dependency.**

> **⚠ V17 AND THIS BACKEND CHANGE MUST SHIP TOGETHER.**
> `database/migrations/V17__split_expense_individual_balances.sql` creates
> `split_expense_individual_balances` and backfills one link row per existing
> individual split.
> - Backend without V17: `ddl-auto=validate` fails on the new
>   `SplitExpenseIndividualBalance` entity and the server does not boot.
> - V17 without this backend: every individual split created by the old code has
>   **no link row**. It then vanishes from `GET /split-expenses?individualBalanceId=`
>   (which joins through the link table) and from `GET /split-expenses/{id}`'s
>   visibility check. The response assembler tolerates a missing link (it answers
>   `counterparts[]` from `individual_balance_id` and logs a `WARN` naming the
>   split id), but the reads do not.
>
> Restart once, with both in place (same coupling as V15 and V16).

### 20.1 What changed

- **Request (§9.1):** optional `individualCounterpartContactIds[]` (1–49 of the
  caller's own contacts, selection order). In individual mode exactly one
  counterpart form: the legacy `individualCounterpartContactId` (**not**
  deprecated) or the array. A one-element array is exactly equivalent to the
  legacy field.
- **Primary counterpart:** the first in request order. Its pair row is written to
  `split_expenses.individual_balance_id`, so V11's CHECK still holds.
- **Ledger:** for every counterpart `c`, `net_c = paid_c − share_c` (positive = the
  creator owes `c`). The creator↔`c` pair row moves by `−net_c` when the creator is
  the row's left side and `+net_c` when `c` is. The left side is read off the
  **stored** row (contact row: the creator; canonical row: its `user_id`), never
  re-derived with `UUID#compareTo`. With one counterpart this equals ADR 0025's
  `paid(left) − share(left)` exactly, so a one-contact split's ledger result is
  unchanged. There is **no contact↔contact balance**.
- **Zero-sum assertion:** `net_creator + Σ net_c = 0` is checked in `BigDecimal`
  before the first write. A failure is an `IllegalStateException` (logged `500`);
  it is unreachable while the payer and participant sums hold.
- **Lock order:** `IndividualBalanceService#resolvePairs` resolves (and the service
  then moves) the pair rows in one global order: registered user-pair rows first by
  `(lesser, greater)` user id, then contact rows by contact id, all with
  `compareCanonical` (unsigned). Two concurrent multi-contact splits over the same
  pairs cannot deadlock. It delegates to `resolvePair` once per contact.
- **Link rows:** one `split_expense_individual_balances` row per counterpart, in
  request order, in the split's transaction. Insert-only.
- **Reads (§9.2, §9.3):** `?individualBalanceId=` returns every split with a
  **link row** to that pair (join through
  `idx_split_expense_individual_balances_balance_expense`), so a multi-contact
  split appears under every pair it moved. `GET /{id}` of an individual split is
  visible to a party of **any** linked pair. Neither reads
  `split_expenses.individual_balance_id`.
- **Response (§9.3):** new `counterparts[]` of `{ individualBalanceId,
  counterpartUserId, counterpartContactId, name, netAmount }`, creator-relative,
  primary first then `individualBalanceId` ascending (unsigned). `name` is live.
  `netAmount = paid_c − share_c` (positive = the creator owes them). Group splits
  return `[]`. `individualBalanceId` is **deprecated** (primary pair only). Every
  other field keeps its value; a one-contact split gains a one-element array.
- **Consumption-share transaction: unchanged** — the creator's participant share.
- **Activities / notifications:** one counterpart: **byte-identical** to before
  (including ADR 0025's two-payer pair sentence). 2+ counterparts: the creator is
  the subject — `You split ₹900 for "Dinner" with Raj and Amit.` (creator),
  `Het split ₹900 for "Dinner" with you and Amit.` (each registered counterpart),
  notification `Het added "Dinner" (₹900) with you and Amit.`. `related_contact_id`
  is `NULL` on every 2+ row; `related_transaction_id` on the creator's row only.
  One activity INSERT and one notification INSERT per registered recipient (ADR
  0026 §6.4's accepted relaxation, at most 50).
- **`GET /splits/individuals` (§8.1) and settle up: unchanged.**

### 20.2 The counterpart rules

All `400 VALIDATION_ERROR` except C7. Every one is decided **before the first
write** (stricter than before: the pair upsert used to run ahead of
normalisation).

| # | Request | Result / message |
|---|---|---|
| C1 | individual, both forms | `Provide either individualCounterpartContactId or individualCounterpartContactIds, not both.` |
| C2 | individual, neither form | `individualCounterpartContactId is required when splitMode is 'individual'.` (unchanged) |
| C3 | group + `individualCounterpartContactId` | unchanged message |
| C4 | group + `individualCounterpartContactIds` | `individualCounterpartContactIds must be omitted when splitMode is 'group'.` |
| C5 | `[]`, > 49 entries, or a null entry | Bean Validation field error |
| C6 | same contact id twice, **or** two contacts linked to one user | `The same person is listed more than once in individualCounterpartContactIds.` |
| C7 | a contact that is not the caller's own | `404 CONTACT_NOT_FOUND` (one identical 404) |
| C8 | a contact linked to the caller | existing `cannotSplitWithYourself()` |
| C9 | participant/payer neither the caller nor a counterpart | existing `notAPartyToThePair()` |

Order: C1–C4 (target shape) → payer form and sums → category → C6 (same id, as
sent) → C7 (one owner-scoped query) → C8 → C6 (same linked user) → payer
normalisation (C9, duplicate payer) → participant normalisation (C9, duplicate
participant) → zero-sum. For a one-contact request this is today's precedence.

**V17's three constraint names are backstops only and map to a logged `500`**
through `GlobalExceptionHandler`'s generic handler:
`uq_split_expense_individual_balances_expense_balance` (`23505`, C6 rejects first),
`fk_split_expense_individual_balances_split_expense_id` and
`fk_split_expense_individual_balances_individual_balance_id` (`23503`). None is
mapped to a `409` or to any client code.

### 20.3 Manual test (curl)

Reuses §16/§19's fixtures: `$TOKEN` (account 1), `$TOKEN2` (account 2), `$ME`,
`$OTHER`, `$LINKED_CONTACT` (account 1's contact linked to account 2),
`$UNLINKED_CONTACT`.

```bash
# (a) Two contacts, ₹900 equally. I paid 600, account 2 paid 300.
#     net_other = 0, net_unlinked = -300, net_me = +300.
curl -s -X POST http://localhost:8080/api/v1/split-expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "title": "Dinner", "splitDate": "2026-11-11", "amount": 900.00,
  "splitMode": "individual",
  "individualCounterpartContactIds": ["'$LINKED_CONTACT'", "'$UNLINKED_CONTACT'"],
  "splitMethod": "equally",
  "payers": [
    { "payerUserId": "'$ME'", "amount": 600.00 },
    { "payerContactId": "'$LINKED_CONTACT'", "amount": 300.00 }
  ],
  "participants": [
    { "participantUserId": "'$ME'", "amount": 300.00 },
    { "participantContactId": "'$LINKED_CONTACT'", "amount": 300.00 },
    { "participantContactId": "'$UNLINKED_CONTACT'", "amount": 300.00 }
  ],
  "addToPersonalExpenses": true }'
# -> 201. counterparts[0] = account 2's pair (== individualBalanceId), netAmount 0.
#    counterparts[1] = the unlinked contact's pair, netAmount -300.
#    The personal transaction is 300 (my share), never 600.
#    GET /splits/individuals: the canonical pair unchanged, the contact pair +300.

# (b) Account 2 paid all 900 for the same three. My view of the canonical pair
#     moves by -600 (I owe account 2), the contact pair by +300.
#     "payers": [ { "payerUserId": "'$OTHER'", "amount": 900.00 } ]

# (c) List by the NON-primary pair: the split from (a) is returned.
curl -s "http://localhost:8080/api/v1/split-expenses?individualBalanceId=$CONTACT_PAIR_ID" \
  -H "Authorization: Bearer $TOKEN"

# (d) Account 2 reads it: 200. A third account (party to neither pair): 404.
curl -s http://localhost:8080/api/v1/split-expenses/$SPLIT_ID -H "Authorization: Bearer $TOKEN2"

# (e) C6: ["'$UNLINKED_CONTACT'", "'$UNLINKED_CONTACT'"] -> 400 (never 409).
```

Postman: requests **270-289** in `postman/MyExpense-Auth.postman_collection.json`
cover (a), (b), the per-pair balance movements, list by each involved pair, the
registered counterpart's read, activity and notification wording, the one-element
array, and C1, C2, C4, C5, C6 (both forms), C7 and C9. Not covered there (no third
account in the collection): the outsider `404`, and the concurrency case below.

### 20.4 Checks not in Postman

- **Outsider:** with a third account, `GET /split-expenses/{id}` of (a) must answer
  `404 SPLIT_EXPENSE_NOT_FOUND`, and `?individualBalanceId=` of either pair
  `404 INDIVIDUAL_BALANCE_NOT_FOUND`.
- **Concurrency (no `40P01`):** fire two multi-contact splits over the same two
  pairs in **opposite** request orders at once (two terminals, a shell loop of
  ~20 each). Every request must return `201`; the server log must show no
  `deadlock detected`.

### 20.5 DB checks to run

```sql
-- 1. Every individual split has >= 1 link row; no group split has one. MUST return no rows.
SELECT se.id, se.split_mode, count(l.id) AS links
  FROM split_expenses AS se
  LEFT JOIN split_expense_individual_balances AS l ON l.split_expense_id = se.id
 GROUP BY se.id, se.split_mode
HAVING (se.split_mode = 'individual' AND count(l.id) = 0)
    OR (se.split_mode = 'group' AND count(l.id) > 0);

-- 2. individual_balance_id is ONE OF the split's own link rows (V17 FLAG 1: not
--    "the only link row"). MUST return no rows.
SELECT se.id
  FROM split_expenses AS se
 WHERE se.split_mode = 'individual'
   AND NOT EXISTS (SELECT 1 FROM split_expense_individual_balances AS l
                    WHERE l.split_expense_id = se.id
                      AND l.individual_balance_id = se.individual_balance_id);

-- 3. The creator is a party to every linked pair row. MUST return no rows.
SELECT l.id
  FROM split_expense_individual_balances AS l
  JOIN split_expenses AS se ON se.id = l.split_expense_id
  JOIN individual_balances AS b ON b.id = l.individual_balance_id
 WHERE se.created_by_user_id NOT IN (b.user_id, coalesce(b.counterpart_user_id, b.user_id));

-- 4. The consumption-share transaction is the creator's SHARE. MUST return no rows.
SELECT se.id
  FROM split_expenses AS se
  JOIN transactions AS t ON t.id = se.personal_transaction_id
  JOIN split_expense_participants AS p
    ON p.split_expense_id = se.id AND p.participant_user_id = se.created_by_user_id
 WHERE t.amount <> p.amount;

-- 5. Link rows are insert-only. MUST return no rows.
SELECT id FROM split_expense_individual_balances WHERE updated_at <> created_at;
```

### 20.6 Implementation notes

- **New:** `entity/SplitExpenseIndividualBalance`,
  `repository/SplitExpenseIndividualBalanceRepository`,
  `dto/response/SplitCounterpartSummary`, `service/IndividualSplitRules`.
- **`SplitExpenseIndividualBalanceRepository` extends the bare `Repository`**, like
  `SplitExpensePayerRepository`, and declares only `saveAllAndFlush` and
  `findBySplitExpenseIdIn`. No delete, no update (ADR 0024, ADR 0026 §2.4). Both
  timestamps are set by the entity on insert.
- **The list-filter join** is `SplitExpenseRepository#findMovingIndividualBalance`
  (JPQL entity join on the link table). The old derived
  `findByIndividualBalanceIdOrderBySplitDateDescIdAsc` was **removed**, so nothing
  can filter on the deprecated column by accident.
- **`IndividualSplitRules`** is the pure half of the individual path (counterpart
  form, checks, normalisation, `net_c`, zero-sum, `signedPairDelta`), extracted as
  ADR 0026 Backend item 5 asks. `SplitExpenseService#normaliseToPair` and
  `#signedPairDelta` moved there. `SplitExpenseService.Identity`/`PayerEntry`
  became package-private so the two share one identity type.
- **`ContactRepository`:** no new method; the existing owner-scoped
  `findByOwnerUserIdAndIdIn` is the one batch lookup.
- **`IndividualBalanceService`:** `resolvePairs` (MANDATORY), package-private
  `lockOrder`, and `isCallerPartyToAny` (one batched read, the same `isParty`).
- **Response build is 6 queries** for any page size: participants, payers, links,
  linked pair rows (skipped when there are none), user names, contact names.
- **Fan-out:** `ActivityFanoutService.SplitSavedFanout` gained
  `List<Counterpart> counterparts` (request order; empty for groups). One
  counterpart takes the unchanged path.
- **Unit tests (no DB):** `IndividualSplitRulesTest` (C1-C9, one-element
  equivalence, §4.4's worked examples on both canonical orientations with uuids
  whose signed and unsigned orders disagree, ADR 0025 equivalence for one
  counterpart, zero-sum, lock order), `ActivitySentencesMultiContactTest` (ADR
  examples, recipient lists, one-counterpart byte identity). Run with
  `mvnw.cmd -q test -Dtest=IndividualSplitRulesTest,ActivitySentencesMultiContactTest,SplitPayerResolverTest,ActivitySentencesMultiPayerTest,SplitPayerOrderTest -Dsurefire.failIfNoSpecifiedTests=false`.
- **Security:** same endpoint, same rate-limit filter. The 49 cap bounds write
  amplification. Every statement is fixed text with bound parameters. Logs carry
  ids and counts only.

### 20.7 Key assumptions and flags

1. **C6 "same id twice" is decided before the contact load**, so it is a `400`
   rather than a misleading `404` (the owner-scoped query returns one row for two
   equal ids).
2. **An individual split with no link row** (old code after V17) is answered from
   `individual_balance_id` in `counterparts[]` with a `WARN`, mirroring §19.6 item
   1. It is **not** visible through the reads (ADR 0026 §3's binding reading
   rule). Flagged for the System Architect.
3. **`counterparts[].netAmount` is computed from payer and participant rows** by
   identity match. Rows were normalised on write, so a linked counterpart's rows
   carry its user id and match.
4. **`SplitExpenseResponse.counterparts` sits right after `individualBalanceId`**
   in the record, matching the api-overview.md §9.3 shape. JSON key order carries
   no meaning; the change is additive.

### 20.8 Not verified in the session that wrote this

- `mvnw compile` / the unit tests: the session had **no shell**, so nothing was
  compiled or run. Run `backend\mvnw.cmd -q compile` and the test command in
  §20.6 first.
- The server was not booted. `ddl-auto=validate` against V17, the JPQL entity join
  in `findMovingIndividualBalance`, Postman 270-289 and the §20.5 queries are all
  unrun.

### 20.9 Follow-ups

- **Frontend (ADR 0026 §8):** multi-select CONTACT chips, send the array only for
  2+ contacts, read `counterparts[]`, and fix `SplitDetailScreen`'s pair effect.
- **Sync pull (§13.2, undesigned):** must use the same "party to any linked pair"
  visibility.
- **Optional cleanup:** `idx_split_expenses_individual_balance_id` no longer serves
  the list filter (ADR 0026 §2.8). Dropping it is a Database Architect decision.

## 21. ADR 0027 — offline-first write contract and change log (2026-11-11)

Implements BE-1 … BE-10 of `docs/decisions/0027-offline-first-local-cache-and-replay-sync.md`
against `docs/api/api-overview.md` §15 and `V18__offline_sync_change_log.sql`.
**Requires V18** (`ddl-auto=validate` now maps `change_log`, four
`last_client_write_at` columns and `activities.related_change_log_id`).

### 21.1 What was built

| Package | BE | What it is |
|---|---|---|
| BE-1 | `sync/WriteContext`, `sync/WriteContextFilter`, `sync/WriteContextArgumentResolver`, `config/WebMvcConfig` | The four optional headers (`Idempotency-Key`, `X-Client-Updated-At`, `X-Client-Origin`, `X-Device-Id`) parsed once per non-GET `/api/v1/**` request (not `/auth/**`, not `/notifications/**`, whose mark-read writes accept and ignore them). Malformed → `400 VALIDATION_ERROR` with a `fieldErrors` entry naming the header. Controllers take a `WriteContext` parameter. CORS allowed headers extended. Filter sits after `ApiRateLimitFilter`. |
| BE-2 | `entity/ChangeLog`, `repository/ChangeLogRepository`, `repository/EntityInserter`, `sync/IdempotentWriteExecutor`, `sync/ChangeSets`, `sync/FieldChange`, `service/ChangeLogWriter`, `service/ChangeLogSentences` | §4.3: replay lookup by `(user_id, idempotency_key)`, `409 IDEMPOTENCY_KEY_REUSED` on a type/operation/entity mismatch, the write + its `change_log` row + activity (+ `sync_conflict` notification when superseded) in ONE transaction. A `23505` on `uq_change_log_user_idempotency_key` or on a primary key (`*_pkey`, `pk_*`) rolls back and re-runs once in a new transaction, where it becomes a replay. Every other constraint stays what it was (a mapped 4xx or a logged 500). |
| BE-3 | the 7 create paths | Optional `id` on `POST /transactions`, `/categories`, `/contacts`, `/groups`, `/split-expenses`, `/splits/settle`, and `PUT /budget/periods`. Explicit `findById` (soft-deleted included) → caller's row: `201` with the current row, nothing written; someone else's: `409 ID_CONFLICT`. **Inserts go through `EntityInserter.insert` (`EntityManager.persist`), never `save()`**. `clientId` on `POST /transactions` is an alias of `id`; both and different → `400`; `client_id = id` on every new row. |
| BE-4 | transactions, categories, settings, budget update | LWW when `X-Client-Updated-At` is present: `effective = least(header, now)`, row locked (soft-deleted included), deleted → superseded `deleted`, `effective <= last_client_write_at` → superseded `newer_write` (ties lose), whole-write. `version` optional and unchecked in LWW mode, still incremented; legacy mode (no header) unchanged (`version` required, `409 VERSION_CONFLICT`, deleted row `404`). Deletes terminal. Propagations (rename refresh, Misc reassignment, `stampDeletedAt`) never touch `last_client_write_at`. |
| BE-5 | settle | `id`, `individualCounterpartContactId` (exactly one of it / `individualBalanceId` for `target: individual`; resolved by `IndividualBalanceService#findPair`, the split path's rule, never creating a row; no row → `400 AMOUNT_EXCEEDS_BALANCE`; not the caller's contact → `404 CONTACT_NOT_FOUND`), `expectedDirection` (`caller_pays`/`caller_receives`; mismatch or zero balance → `409 SETTLEMENT_DIRECTION_CHANGED`, decided before any write). |
| BE-6 | split create | `id`, `personalTransactionId` (only with `addToPersonalExpenses: true`, else `400`), both checked before any write. `attachPersonalTransaction` still sets `added_to_personal_expenses = true` (unchanged). Logs the split (primary) and the consumption-share transaction (secondary, no key). |
| BE-7 | budget | `PUT /budget/periods` with an `id` that exists nowhere creates it (`201`); another user's id stays `404`; own id → LWW edit (`200`). Replay returns the original `201`/`200`. `BudgetPeriodUpsertResult` is no longer used (replaced by `WriteResult`); left in place, safe to delete. |
| BE-8 | `controller/ChangeLogController`, `service/ChangeLogService`, `dto/request/ListChangeLogQuery`, `dto/response/ChangeLogEntryResponse` | `GET /api/v1/change-log` (owner-scoped, `entityType`+`entityId` both or neither, page/size ≤ 100, `created_at DESC, id DESC`) and `GET /api/v1/change-log/{id}` (`404 CHANGE_LOG_ENTRY_NOT_FOUND`). `ActivityResponse.relatedChangeLogId` added. |
| BE-9 | groups, notifications | `POST /groups/{id}/members` is logged with its key (`entity_type 'group'`, `operation 'update'`); a replay is `201` with the member; a genuine duplicate is still `409 ALREADY_A_MEMBER`. Notification read endpoints: the filter skips them, so headers are accepted and ignored. |
| BE-10 | Postman 290-305, this section | |

**Activities (§6.4).** One actor activity per primary change-log row, linked by
`related_change_log_id`: `transaction_created/edited/deleted`,
`category_created/edited/deleted`, `budget_saved`, `contact_created`,
`group_created` (ADR 0008 §2.3's template — it was not written before),
`group_member_added`, `settings_changed`, `write_superseded`. `split_saved` and
`settlement` link the actor's own fan-out row (`actorChangeLogId` on the two
fan-out records); other members' rows carry `NULL`.

**Superseded commits (§4.3).** Services return `WriteResult` (`CREATED`, `OK`,
`NO_CONTENT`, `SUPERSEDED`); nothing throws inside the transaction for a lost LWW
write. The controller's `toResponseEntity()` throws `WriteSupersededException` only
after commit.

### 21.2 New error codes

`409 WRITE_SUPERSEDED`, `409 ID_CONFLICT`, `409 IDEMPOTENCY_KEY_REUSED`,
`409 SETTLEMENT_DIRECTION_CHANGED`, `404 CHANGE_LOG_ENTRY_NOT_FOUND`. New `400
VALIDATION_ERROR` messages: nil id, `id`≠`clientId`, `version` required (legacy),
`personalTransactionId` without `addToPersonalExpenses` (or equal to `id`), both
individual settle targets, change-log filter pair, unknown `entityType`.

### 21.3 Phase B checklist mapping

| ADR §11 item | Where |
|---|---|
| 1 same POST + key twice | Postman 290-291; DB check 1 below |
| 2 id held by another user | Postman 292; `ClientIdCollisionTest` (all 7 paths) |
| 3 older offline edit superseded | Postman 294-296, 300; `ClientIdCollisionTest#supersededUpdateCommitsItsLogRowAndIsNotRolledBack` |
| 4 rename then older edit applies | manual: rename a category, then PATCH one of its transactions with an `X-Client-Updated-At` older than the rename but newer than the row's last client write → `200` |
| 6 direction flipped | Postman 305 |
| 5, 7-10 | frontend / end-to-end, Project Owner |

### 21.4 DB checks

```sql
-- 1. One change_log row per key. MUST return no rows.
SELECT user_id, idempotency_key, count(*) FROM change_log
 WHERE idempotency_key IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- 2. Every superseded row has an activity and the actor got a sync_conflict.
SELECT c.id FROM change_log c
 WHERE c.outcome = 'superseded'
   AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.related_change_log_id = c.id);
-- 3. Rename propagation did not move the LWW clock (run after a rename).
SELECT id, updated_at, last_client_write_at FROM transactions WHERE category_id = :renamedCategoryId;
```

### 21.5 Deviations, assumptions, flags

1. **`personalTransactionId` that already exists** (split id new) is `409
   ID_CONFLICT` even when the caller owns that transaction: a new split cannot
   adopt an existing row as its consumption share, and ADR §3.3's "201 with the
   current row" has no coherent meaning for a secondary id. Flag for the System
   Architect.
2. **Settings' insert race** used `UserSettingsWriter`'s `REQUIRES_NEW` + retry.
   It is now `MANDATORY` and the executor's single re-run (on `pk_user_settings`)
   does the same job, so the settings write and its log row share one transaction.
3. **LWW is applied only in LWW mode** (header present) on categories, settings and
   budget, mirroring transactions' legacy mode. In legacy mode the effective time is
   server-now and still written to `last_client_write_at`.
4. **`group_created` activity** is now written for the actor only (ADR 0008 §2.3
   template, member count = all member rows incl. the creator). Before, none was
   written; no fan-out to other members was added.
5. **Superseded label / time:** the sentence uses the device's own offset from
   `X-Client-Updated-At` (`d MMM yyyy, HH:mm`), falling back to the effective time.
   Budget dates in `budget_saved` use `d MMM yyyy`. ADR gives no exact format.
6. **Idempotency-Key / X-Device-Id are never logged** (the Backend brief is
   stricter than security-architecture.md §8, which calls them safe). `changes` and
   queued bodies are never logged.
7. **JSONB** is mapped with `@JdbcTypeCode(SqlTypes.JSON)` on a `String` (V18
   contract). Hibernate's JSON type needs a JSON `FormatMapper` (Jackson) on the
   classpath; with Spring Boot 4 / Jackson 3 this is **unverified** — if boot or the
   first insert fails on `changes`, flag to the Database Architect / System
   Architect rather than adding a library (ADR §1.4). Fallback with no dependency:
   `@ColumnTransformer(write = "?::jsonb")` + `columnDefinition = "jsonb"`.
8. **Postman 303** uses Nov 2030 to avoid overlapping the collection's earlier
   periods; **305** needs a pair balance on `unlinkedContactId` (from the ADR 0026
   requests) and a direction opposite to it.

### 21.6 Tests (no DB)

`ClientIdCollisionTest` (7 collision paths + superseded-commits), `SyncPrimitivesTest`
(LWW ties/clamp, change sets, header parsing, race mapping, replay match). Run:
`mvnw.cmd -q test -Dtest=ClientIdCollisionTest,SyncPrimitivesTest,IndividualSplitRulesTest,SplitPayerResolverTest -Dsurefire.failIfNoSpecifiedTests=false`.

### 21.7 Not verified in the session that wrote this

No shell: nothing compiled, no test run, server not booted, V18 not applied,
Postman 290-305 unrun.

---

## 22. ADR 0028 — split expense edit/delete, feeds, balance copy (2026-11-12)

Spec: `docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md`
(BE-1..BE-10), api-overview.md §7.1, §7.5, §8.2, §9.3–§9.6, §10.1, §11.1, §15.
Schema: `database/migrations/V19__split_expense_edit_delete_and_feed.sql`.
**V19 and this code must ship together** (`ddl-auto=validate` maps `revision`,
`deleted_at`, `deleted_by_user_id`, `last_client_write_at`, `initiator_is_payer`).

### 22.1 What was built

| BE | Unit | Notes |
|---|---|---|
| 1 | `SplitLedgerService` (new) | apply/reverse one revision, group (set-based, `:revision`/`:sign`) and pair (one delta per row). Used by create, edit, delete |
| 1 | `SplitLedgerMath` (new, pure) | `net = paid − share`, `Δ = net_{r+1} − net_r`, `D(R_c)`, zero-sum guard |
| 1 | `SplitRevisionWriter` (new) | participants then payers of one revision, names. Extracted from `SplitExpenseService` |
| 1 | `SplitExpenseResponseAssembler` | current-revision reads only (`findCurrentBySplitExpenseIdIn`), `createdBy*`/`deleted*` at no extra query |
| 1 | `GroupMemberBalanceRepository` | the four ADR 0025 statements gain `p.revision = :revision` and `:sign` |
| 2 | `GroupRepository#lockForLedgerWrite` | `FOR NO KEY UPDATE`; first in group split create/edit/delete and group settle |
| 2 | `IndividualBalanceService#lockPairs` | `FOR UPDATE` in `resolvePairs`' order via the shared `PairLockKey` (`compareCanonical`, never `UUID.compareTo`) |
| 3/4 | `SplitExpenseEditService` (new), `PUT`/`DELETE /split-expenses/{id}` | §4.4 order, §2.1 permission, LWW, U1/U2 |
| 3/4 | `PersonalShareTransactionSync` (new) | §5.2 field-level follow, §5.3 delete with the split's instant |
| 5 | `SplitExpenseResponse` | `createdByUserId`, `createdByName`, `deletedAt`, `deletedByUserId`, `deletedByName` |
| 5 | `SplitChangeLogFields` (new) | §6.6 update/delete/superseded fields; arrays sorted by identity |
| 6 | `SettlementService`, `SettlementPartiesResolver` (new) | `initiator_is_payer` on every new row; `payer`/`payee` |
| 7 | `SplitFeedService`, `SplitFeedQueryRepository` (new) | `GET /groups/{id}/feed`, `GET /splits/individuals/{id}/feed` |
| 8 | `GroupResponseAssembler` | `members[].balance`, one batched read |
| 9 | `ActivityFanoutService`, `ActivitySentences`, `SplitEffectClauses` (new) | `split_edited`/`split_deleted`, effect clauses, payer/payee settlement sentences |
| — | `SplitExpenseCreatorOnlyException` | `403 SPLIT_EXPENSE_CREATOR_ONLY` via the existing `ApiException` handler |

Deleted-split filters (ADR 0024 §1.8 / ADR 0028 §3.6): `GET /split-expenses/{id}`,
both list filters, and the category-delete reassignment. The feeds deliberately do
not filter (`...IncludingDeleted`). Idempotent replays of a split create or edit
read the split including a deleted one (`SplitExpenseService#currentIncludingDeleted`).

### 22.2 V19 constraint mapping (V19 CONTRACT item 4)

Every new constraint is a backstop behind a service rule and surfaces as a logged
`500` through the generic handler — **no matcher is keyed on any of these names**,
and none is folded into a `409`:
`fk_split_expenses_deleted_by_user_id`, `chk_split_expenses_revision_positive`,
`chk_split_expenses_deleted_by_iff_deleted`, `chk_split_expense_participants_revision_positive`,
`chk_split_expense_payers_revision_positive`,
`uq_split_expense_participants_expense_revision_user`/`_contact` (rejected first by
`duplicateParticipant()`), `uq_split_expense_payers_expense_revision_user`/`_contact`
(rejected first by `duplicatePayer()`). **Changed:** the dropped participant uniques
were documented as `400` in §16's table; the new ones are `500` (V19 FLAG 4). The
dropped names had no Java matcher, so no dead code was left; the §16 row and the
Javadoc in `GroupMemberBalanceRepository`, `SplitExpenseParticipantRepository`,
`SplitExpensePayerRepository` and `SplitRuleViolationException` now cite the new names.

### 22.3 Deviations, assumptions, flags

1. **`split_expenses.paid_by_*` became updatable** — an edit can change the primary
   payer, and those columns name it (ADR 0025 §3). Not in the ADR text; required by it.
2. **`IndividualBalanceRepository#findForUpdateById`** is the first `FOR UPDATE` on that
   table. It is a lock-ordering device (ADR 0028 §4.5), not a read-modify-write; every
   movement is still a relative delta.
3. **Fan-out statement count.** Split-saved rows are now grouped by effect clause, and
   `split_edited`/`split_deleted`/settlement rows are one INSERT per recipient (each reads
   its own sentence). Bounded by recipients (≤ 50). The existing ADR 0025/0026 sentence
   methods are unchanged; the clause is appended at the fan-out.
4. **Settlement notifications** now carry the same sentence as the recipient's activity,
   flattened (ADR 0028 §9.3: "Notifications use the same full sentence").
5. **Feed `timeZone`** accepts only `ZoneId.getAvailableZoneIds()` entries. Raw offsets
   (`+05:30`) are refused because PostgreSQL reads POSIX offsets with the opposite sign.
6. **Group add-member** (`POST /groups/{id}/members`) also upserts every member's balance
   row (delta 0) without the mutex. ADR 0028 §4.5 does not list it; it can, in theory,
   deadlock with a concurrent split edit (`40P01`, logged `500`, nothing written).
   Flagged for the System Architect; not changed.
7. **Legacy individual split with no link row** (pre-ADR-0026 code after V17): edit and
   delete lock `split_expenses.individual_balance_id`, the same fallback the assembler uses.
8. `SplitExpenseEditService` (~560 lines) is above constitution §26's guideline; the
   pure parts were already extracted (`SplitLedgerMath`, `SplitChangeLogFields`,
   `SplitEffectClauses`, `PersonalShareTransactionSync`, `SplitRevisionWriter`).

### 22.4 Tests (no DB)

`SplitLedgerMathTest` (§4.2/§4.3 worked examples, creator as left and right, contact
row, delete reversal, sign flip after a settlement), `SplitExpenseEditRulesTest`
(§2.1 permission, U1, §4.3 normalisation, §5.2 follow: follow / diverged / `both` /
share → 0 / already deleted), `ActivitySentencesSplitEditTest` (effect clauses,
`split_edited`/`split_deleted`, settlement sentences, `timeZone`),
`SplitFeedQueryShapeTest` (ORDER BY pinned, bound time zone, tombstones not
filtered, link-table pair feed). `ClientIdCollisionTest` updated for the new
constructors. Run:
`mvnw.cmd -q test -Dtest=SplitLedgerMathTest,SplitExpenseEditRulesTest,ActivitySentencesSplitEditTest,SplitFeedQueryShapeTest,ClientIdCollisionTest,IndividualSplitRulesTest,SplitPayerResolverTest,ActivitySentencesMultiPayerTest,ActivitySentencesMultiContactTest -Dsurefire.failIfNoSpecifiedTests=false`.

**Integration tests still owed** (need a database): deadlock (concurrent group edits +
group settle; two edits over the same pairs in opposite orders — no `40P01`), feed order
across a day boundary in `Asia/Kolkata` vs `UTC`, pagination totals, LWW `deleted`,
replayed PUT/DELETE, and V19 FLAG 3's orphaned-revision reconciliation query.

### 22.5 Postman

Requests **306–319**: create → edit (LWW) → U1 `400` → stale edit `409` with its
change-log row → `members[].balance` sums to 0 → group feed → bad `timeZone` `400`
→ pair feed → counterpart edit `403` → delete `204` → delete again `404` → `GET` `404`
→ tombstone in the feed.

### 22.6 Not verified in the session that wrote this

No shell: nothing compiled, no test run, server not booted, V19 not applied,
Postman 306–319 unrun.
