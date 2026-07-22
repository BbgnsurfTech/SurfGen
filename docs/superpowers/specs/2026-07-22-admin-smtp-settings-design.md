# Admin-Configurable SMTP — Design

**Date:** 2026-07-22
**Status:** Approved for planning
**Relates to:** `docs/superpowers/specs/2026-07-22-hostinger-deployment-design.md`

## Goal

Let a super-admin configure the outbound SMTP relay from the dashboard instead of only through
environment variables, so mail can be set up on a running deployment without a redeploy.

## Why now

The Hostinger deployment ships with `REQUIRE_EMAIL_VERIFICATION=true`, which currently makes
SMTP credentials a hard prerequisite: without a relay, `MailerService` only logs the
verification link and no one can complete signup.

Making SMTP runtime-configurable removes that prerequisite. The seeded admin is pre-verified,
so the bootstrap path becomes: deploy with no SMTP → admin logs in → configures the relay in
`/settings` → public signups work. **Deployment no longer blocks on credentials.**

## Current behaviour

`apps/api/src/auth/mailer.service.ts` reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
and `MAIL_FROM` from `process.env` and builds a nodemailer `Transporter` **once, in the
constructor**. When `SMTP_HOST` is unset, `transport` is `null` and `isConfigured` is false, and
callers log the link instead of sending.

The constructor-time construction is the crux: a database-backed configuration can change while
the process is running, so the transport can no longer be fixed at construction.

## Prior art in this codebase

This follows the established Paystack settings pattern rather than inventing one:

- `PaymentGatewaySetting` (`packages/db/prisma/schema.prisma:748`) — a singleton row keyed by a
  unique string, with the sensitive field stored as `secretKeyEncrypted`.
- `apps/api/src/common/secret-box.ts` — `sealSecret()` / `openSecret()` (AES-256-GCM under
  `SURFGEN_ENCRYPTION_KEY`, format `v1:<iv>:<tag>:<ciphertext>`) and `maskSecret()` for display.
- `/v1/admin/billing/*` controllers behind the `RequireSuperAdmin` guard
  (`apps/api/src/common/guards.ts`).
- The `/payments` admin page as the UI precedent.

## Decisions

| Decision | Choice | Rejected |
| --- | --- | --- |
| Precedence | **DB wins, env is fallback, log-only last** | env-wins (UI could show settings not in effect); DB-only (breaking change for env-based deploys, kills declarative provisioning) |
| UI location | **New `/settings` admin area with an Email section** | card on `/payments` (route name stops matching contents); dedicated `/settings/email` (proliferates one-off routes) |
| Secret storage | `sealSecret()`, same as the Paystack secret key | plaintext column |
| Transport lifetime | Resolved per send, memoised on `updatedAt` | constructor-time (cannot pick up changes); rebuild-per-email (drops the connection pool) |

## Design

### 1. Data model

A singleton row, mirroring `PaymentGatewaySetting`:

```prisma
model MailSetting {
  id                String   @id @default(cuid())
  /// Singleton discriminator — always "smtp". Unique so upsert has a target.
  channel           String   @unique
  enabled           Boolean  @default(false)
  host              String?
  port              Int      @default(587)
  username          String?
  /// AES-256-GCM sealed, same envelope as PaymentGatewaySetting.secretKeyEncrypted.
  passwordEncrypted String?
  fromAddress       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`enabled` is deliberate: it lets an admin save credentials and turn the relay on separately, and
lets them disable a broken relay without destroying the configuration.

### 2. Resolution order

A single `resolve()` in `MailerService` returns the effective configuration:

1. `MailSetting` row where `channel = "smtp"` **and** `enabled = true` **and** `host` is set → use it.
2. Otherwise `process.env.SMTP_HOST` set → use env.
3. Otherwise → unconfigured; callers log the link, exactly as today.

Existing env-configured deployments are unaffected until someone enables a DB setting.

### 3. Transport lifetime

The transport is resolved per send, not at construction. Rebuilding a nodemailer transport on
every email would discard the connection pool, so the resolved `Transporter` is memoised
against a cache key derived from the effective config — the row's `updatedAt` timestamp, or the
literal `"env"` when falling back. When an admin saves, `updatedAt` changes, the key misses, and
the next send builds a fresh transport. No explicit invalidation call and no cross-process
cache-busting is needed.

`isConfigured` becomes async (`isConfigured(): Promise<boolean>`), since it now requires a
database read. Call sites in the signup/verification flow must be updated accordingly.

### 4. API

All behind `RequireSuperAdmin`, alongside the existing admin billing controllers.

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/v1/admin/mail` | Current settings. `password` is **never** returned — a `hasPassword: boolean` plus `maskSecret()` preview instead. Also reports `source: "db" \| "env" \| "none"` so the UI can show what is actually in effect. |
| `PUT` | `/v1/admin/mail` | Upsert. An omitted/empty password leaves the stored one intact, so an admin can edit the host without retyping the secret. |
| `POST` | `/v1/admin/mail/test` | Sends a test email to the requesting admin's own address and returns success or the SMTP error message. |

The test endpoint matters: it turns "did I configure this right?" into a one-click answer
instead of a failed public signup.

### 5. Web

New `/settings` route in the studio's admin section, guarded by the same super-admin gate as
`/payments`, containing an **Email** section: host, port, username, password, from-address,
enabled toggle, and a **Send test email** button.

The page shows which source is live (`db` / `env` / `none`) so a super-admin can tell at a glance
whether a VPS env var or their saved row is in effect.

`/payments` is left where it is. Folding it into `/settings` later is a natural follow-up but is
not in scope.

### 6. Security

- Password sealed with `sealSecret()`; `SURFGEN_ENCRYPTION_KEY` must be set (already required by
  the Paystack path and present in the deployment env).
- The plaintext password is never returned by any endpoint, including after a save.
- All three endpoints require `RequireSuperAdmin` — the same guard that protects plugin toggles
  and the monitor view.
- The test endpoint sends only to the authenticated admin's own address, so it cannot be used as
  an open relay to arbitrary recipients.

## Non-goals

- Making `REQUIRE_EMAIL_VERIFICATION` a dashboard toggle. Related, but a separate decision about
  auth policy rather than mail transport.
- Multiple mail channels or per-organisation SMTP. The model is a singleton by design; YAGNI.
- Templating or a provider API (Resend/Postmark SDKs). Plain SMTP only, as today.
- Migrating `/payments` into `/settings`.

## Impact on the deployment plan

`docs/superpowers/plans/2026-07-22-hostinger-deployment.md` treats SMTP credentials as a blocking
input for Task 6. With this feature, they become optional:

- The `SMTP_*` entries in the deploy environment become optional rather than required.
- Task 6's "Blocking input: SMTP credentials" note is removed.
- Task 7 Step 6 (signup → verification → login) is performed **after** configuring SMTP in
  `/settings`, using the pre-verified seeded admin to get in.

## Testing

- Unit: resolution order (db-enabled → db; db-disabled with env → env; neither → none);
  memoisation rebuilds when `updatedAt` changes; `PUT` with an empty password preserves the
  stored ciphertext.
- Unit: the `GET` response never contains the plaintext password.
- Integration: the three endpoints reject non-super-admin callers.
- Manual: save settings in `/settings`, click **Send test email**, receive it.
