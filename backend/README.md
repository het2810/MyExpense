# MyExpense Backend

Spring Boot 4.1.0 / Java 17 / Maven. This README covers **Domain 1 — Auth**
only (`docs/roadmap/backend-build-order.md`): the 8 endpoints under
`/api/v1/auth`. Every other domain (`/users/me`, categories, transactions,
...) is intentionally not implemented yet.

Contract source of truth: `docs/api/authentication-api.md`,
`docs/architecture/authentication.md`, `docs/architecture/security-architecture.md`,
`docs/architecture/data-model.md` §1.

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

Every `/api/v1/auth/**` endpoint is limited per-client-IP (20 requests /
60 seconds by default, per endpoint path). `register`, `login`,
`forgot-password`, and `resend-verification` are additionally limited
per-account (by the submitted email) with tighter windows — see
`app.ratelimit.auth.*` in `application.properties`. Hitting a limit
returns `429` with `error: "RATE_LIMIT_EXCEEDED"`. If you're
scripting repeated test runs against the same account, you may hit these
— they reset on their own after the configured window.

---

## 7. What was implemented

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

## 8. Key assumptions (flagged for the System Architect / Database Architect)

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
- **Category seeding at registration is deliberately NOT implemented.**
  `data-model.md` §2.1 describes seeding 8 default categories at
  registration, but the `categories` table doesn't exist yet (out of
  scope this round per the incremental build order). Flagging so
  whoever implements the Categories domain remembers this hook needs to
  be added back into `AuthService.register()`.
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

## 10. Not done / follow-ups

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
- Category seeding at registration (see §8) needs to be added once the
  Categories domain's migration/entities exist.
- Multi-instance-safe rate limiting (see §9) if/when this backend scales
  beyond one instance.
