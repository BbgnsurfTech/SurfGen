# Paystack Billing — Design Spec

**Date:** 2026-07-04
**Status:** Approved (scope, key storage, and page placement confirmed with owner)

## Goal

Add Paystack as SurfGen's first payment gateway, powering subscription-plan
billing. The gateway is fully configurable by a super admin through an admin
page in the web studio — including the API keys themselves.

## Decisions (confirmed)

1. **Scope:** full subscription-plan billing — admin-defined plans, Paystack
   redirect checkout, webhooks keeping `Subscription` + `Invoice` in sync.
2. **Key storage:** admin enters public/secret keys in the UI; the secret key
   is AES-256-GCM encrypted at rest in Postgres using a master key from the
   `SURFGEN_ENCRYPTION_KEY` env var. The API never returns the plaintext
   secret — only a masked tail (`sk_live_••••1234`).
3. **Admin surface:** a `/payments` page inside the web studio shell
   (alongside Providers / Monitor / Developer / Plugins), super-admin gated.
   No separate `apps/admin`.

## Architecture

Approach: dedicated NestJS `billing` module + a hand-rolled Paystack REST
client (no third-party SDK — Paystack is plain REST and the npm SDKs are
stale). Reuses existing gateway-agnostic schema (`BillingAccount.provider`,
`Subscription.externalId`, `Invoice.externalId`).

### Data model (packages/db/prisma/schema.prisma)

New models:

```prisma
model PaymentGatewaySetting {
  id                 String   @id @default(cuid())
  gateway            String   @unique            // "paystack"
  enabled            Boolean  @default(false)
  publicKey          String?
  /// AES-256-GCM: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
  secretKeyEncrypted String?
  currency           String   @default("NGN")    // NGN | USD | GHS | ZAR | KES
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model Plan {
  id               String   @id @default(cuid())
  code             String   @unique              // "pro-monthly"
  name             String
  description      String?
  amountCents      Int                            // subunit (kobo/cents)
  currency         String   @default("NGN")
  interval         String                         // "monthly" | "annually"
  paystackPlanCode String?                        // PLN_xxx once synced
  features         Json     @default("[]")
  active           Boolean  @default(true)
  sortOrder        Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

Existing models reused, no changes: `BillingAccount` (created lazily per org,
`provider: "paystack"`), `Subscription` (one active per billing account;
`externalId` = Paystack subscription code), `Invoice` (`externalId` =
transaction reference; lifecycle `open` → `paid`).

### Crypto

`apps/api/src/common/secret-box.ts`: `seal(plaintext)` / `open(sealed)` using
AES-256-GCM. Master key from `SURFGEN_ENCRYPTION_KEY` (32 bytes, base64 or
hex). Fail fast with a clear error if the key is missing/malformed when a
secret must be sealed or opened. Format: `v1:<iv>:<tag>:<ciphertext>`.

### Paystack client

`apps/api/src/billing/paystack.client.ts` — thin fetch wrapper over
`https://api.paystack.co`: `initializeTransaction`, `verifyTransaction`,
`createPlan`, `updatePlan`, `disableSubscription`, `ping` (key check via
`GET /transaction?perPage=1`). Errors surface as domain errors.

### API endpoints (apps/api/src/billing/)

Super admin (`@RequireSuperAdmin`):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/v1/admin/billing/gateway` | Settings with masked secret |
| PUT  | `/v1/admin/billing/gateway` | Update enabled/keys/currency (secret optional — omit to keep) |
| POST | `/v1/admin/billing/gateway/test` | Live key check against Paystack |
| GET  | `/v1/admin/billing/plans` | All plans |
| POST | `/v1/admin/billing/plans` | Create plan (+ sync to Paystack when enabled) |
| PATCH| `/v1/admin/billing/plans/:id` | Update/deactivate plan |

Authed users (org-scoped):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/v1/billing/plans` | Active plans (for the pricing page) |
| GET  | `/v1/billing/subscription` | Current org subscription + gateway public key/currency |
| POST | `/v1/billing/checkout` | `{ planId }` → creates open Invoice, initializes Paystack transaction → `{ authorizationUrl, reference }` |
| GET  | `/v1/billing/verify/:reference` | Post-redirect verification fallback |

Public:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/billing/webhooks/paystack` | Raw-body HMAC-SHA512 verified events |

Webhook handling (idempotent by reference / external id):
- `charge.success` — re-verify amount+currency against the open Invoice; mark
  `paid`; upsert active `Subscription` for the plan.
- `subscription.create` — store `externalId` (subscription code).
- `subscription.disable` / `subscription.not_renew` — mark `canceled`.
- Unknown events: 200 + ignore (Paystack retries non-2xx).
- Bad signature: 401, no detail leaked.

`main.ts` gains `rawBody: true` so the webhook controller can HMAC the exact
bytes Paystack signed.

### Web (apps/web)

- **`/payments` (admin):** gateway card (enable toggle, public key, secret key
  write-only input with masked current value, currency select, "Test
  connection" button) + plan table with create/edit/deactivate. Sidebar entry
  "Payments" in the admin section. Non-admins get a friendly access notice
  (server enforces regardless).
- **`/billing` (users):** plan cards from `GET /v1/billing/plans`, current
  subscription banner, Subscribe → `POST /v1/billing/checkout` → redirect to
  Paystack `authorizationUrl`.
- **`/billing/callback`:** reads `?reference=`, calls verify endpoint, shows
  success/pending/failure.

### Error handling

- Gateway disabled / unconfigured → domain error (`BILLING_DISABLED`) via the
  existing `DomainExceptionFilter`; UI shows "payments not available".
- Paystack API failures → `BILLING_GATEWAY_ERROR` with logged detail,
  user-safe message.
- Encryption key missing → explicit startup-style error on first use, never a
  silent fallback.

### Security

- Timing-safe HMAC compare on webhooks; amount/currency re-verified server
  side; plaintext secret never serialized to clients or logs; admin writes
  audited by the existing `AuditInterceptor`; all admin routes behind
  `RequireSuperAdmin` (JWT principals only — API keys can never pass).

### Testing (apps/api/test/billing.test.ts, node test runner style)

- secret-box seal/open roundtrip + tamper rejection.
- Webhook: valid signature accepted, invalid rejected, replay is a no-op.
- Checkout: creates invoice + returns authorization URL (Paystack mocked).
- Amount-mismatch webhook does not mark invoice paid.
- Admin guard: non-super-admin cannot read/write gateway settings.

## Out of scope (this iteration)

- Multiple gateways at once / gateway fallback chains.
- Proration, refunds, dunning emails, usage-based billing.
- Card management UI (Paystack hosts card entry).
