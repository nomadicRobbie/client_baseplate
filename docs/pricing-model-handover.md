# blnk — modular pricing: architecture handover

> Findings from a review of `client-baseplate` against the proposed shift from
> one-time build fees to a recurring, modular subscription model.
> Brand and positioning context: `blnk_brand.md`, `blnk_brief.md`.
> Payments reference architecture: `blnk_payments.md`.

| field | detail |
|---|---|
| repo reviewed | `client-baseplate` @ apps/api, apps/app, packages/shared |
| review date | September 2026 |
| verdict | model is market-sound; architecture is not ready |
| blocking items | 5 (see §02) |
| status | Confidential |

---

## 00 — Summary

The proposed revenue model — free tier of people + schedule + one module of the
user's choice, with paid modules added on top — lines up with the market. Pure
per-seat pricing is falling (21% → 15% share in a year); hybrid base-plus-modular
is at ~59% adoption. Recurring revenue is also the standard fix for the actual
problem: an unbounded maintenance and support tail funded by one-time project fees.

The model is not novel. Odoo's "One App Free" plan is close to identical — one app,
unlimited users, free forever. That validates the shape but means the free tier is
not the differentiator.

The architecture is the problem. `client-baseplate` is built as an **agency
template — one clone, one database, one VM per client**. Every assumption in it
points away from self-serve SaaS. Five blockers, below.

---

## 01 — The proposed model

- **Free tier:** people + schedule + one module of the user's choice
  (food compliance, asset manager, or ecommerce).
- **Paid:** every additional module carries a fixed monthly price, priced per module.
- **Intent:** users start free, add progressively, or stay free indefinitely.

Differs from standard freemium in that the free tier is *composable* — the user
picks which module they get free, rather than receiving a fixed cut-down product.

---

## 02 — DEBTS: the five blockers

Mnemonic for the five things that must be resolved before this model can ship.

### D — Dependencies break the proposed free tier

**Schedule hard-depends on asset.** The free tier as proposed (people + schedule)
silently drags in the asset module, or ships a schedule with an empty facility picker.

Evidence:

- `apps/api/src/db/migrations/049_facility_location.sql` — dropped the free-text
  `location_label` and replaced it with `facility_id UUID REFERENCES assets(id)`
  on both `service_templates` and `scheduled_services`. Migration comment:
  *"Nullable in DB so existing rows and history stay intact; **required at API layer**."*
- `apps/api/src/db/migrations/042_template_default_asset.sql` — adds
  `default_asset_id UUID REFERENCES assets(id)` to `service_templates`.
- `apps/api/src/db/queries/schedule.ts:23,57` — base selects join assets:
  `LEFT JOIN assets fa ON fa.id = t.facility_id`.
- `apps/api/src/db/migrations/040_roster_weeks.sql` — `roster_assignments`
  references `scheduled_services`, `people`, **and** `assets`.

**Compliance also reads the assets table**, and asset reaches back into compliance:

- `apps/api/src/db/queries/compliance.ts:303` — `assetImageSub` subquery selects
  `image_url FROM assets WHERE food_control_plan_id = fcp.id`.
- `apps/api/src/db/migrations/031_food_control_plans.sql` — adds
  `food_control_plan_id UUID REFERENCES food_control_plans(id)` to the assets table.
  Asset → compliance and compliance → asset.

**One dependency is already handled by hand**, which shows the pattern but not the system:

```ts
// apps/api/src/server.ts
if (config.features.roster && config.features.schedule) await server.register(rosterPlugin)
```

**Rule this implies:** anything a module depends on is a module you cannot charge
for separately. The dependency graph must be made explicit and enforced before
SKUs can be drawn.

**Needed:** a declared module manifest with `requires: []`, validated at boot and
at entitlement-change time. The graph decides the SKU list, not the other way round.

---

### E — Entitlements live in environment variables

Module access is a build/deploy-time constant, not runtime state.

- `apps/api/src/config.ts` — `config.features` is read from `FEATURE_*` env vars
  via `flag()` at module load.
- `apps/api/src/server.ts` — `build()` conditionally calls `server.register()`
  per flag. A disabled module's routes do not exist.

Consequence: enabling a module means SSH to the VM, edit `.env`, `pm2 reload`.
There is no path for self-serve upgrade, instant downgrade on failed payment,
trial expiry, or a read-only grace state.

**Note the distinction the codebase does not make.** There are two different gates
and only one exists:

| gate | question | status |
|---|---|---|
| user permission | is this *person* assigned to this module? | built — `requireModule()` in `apps/api/src/blnk/auth.ts`, backed by `person_module` (`011_people.sql`) |
| tenant entitlement | has this *tenant* paid for this module? | **does not exist** — only the env flag |

**Needed:** entitlements become data blnk issues, not env vars the client deploys.
A per-tenant entitlement record served by `blnk_api` (or carried in the blnk_auth
JWT), cached in `client_api`, checked by a `requireEntitlement(module)` preHandler
alongside the existing `requireModule`. Flags stop being deploys and become rows.

---

### B — There is no path for blnk to bill the tenant

The entire proposed revenue model has zero code behind it today.

- `apps/api/src/blnk/client.ts` — `getBlnkBillingStatus()` returns
  `{ status: 'not_wired', note: 'blnk billing status integration lands with Phase 4' }`.
- `apps/api/src/modules/payments/subscriptions/service.ts` — bills the **client's
  end users** through the **client's own Stripe account**. Guards against a second
  active subscription per user. This is plumbing built *for* clients, not blnk
  charging clients.
- `apps/app/src/app/dashboard/billing.tsx` —
  `const PRICE_ID = process.env.EXPO_PUBLIC_SUBSCRIPTION_PRICE_ID ?? ''`.
  A single price. No module catalogue, no proration, no dunning.

Additional problem: `EXPO_PUBLIC_*` vars are baked into the web bundle at export
time (see the Metro cache-busting note in `README.md` and `deploy.sh`). **Module
prices as build-time constants means every price change is a rebuild and redeploy
of every client.**

Note also `blnk_payments.md` describes Stripe **Connect** — blnk as platform,
tenants as connected merchants collecting from their customers. That is a
different system from Stripe **Billing** subscriptions charging tenants for
modules. Both are needed; only the first is specified.

**Needed:** a blnk-side module catalogue and subscription system (Stripe Billing),
separate from the Connect work, with prices resolved at runtime rather than baked
into client bundles.

---

### T — Tenancy: one deployment per client

This is the item that kills the free tier outright.

- `README.md` — *"Template monorepo for a blnk client engagement. **Clone this per client.**"*
- `deploy.sh` — `git pull` → `pnpm install` → `expo export` → PM2 start/reload on a VM.
- `apps/api/ecosystem.config.js` — a single PM2 app, one instance.
- `apps/api/src/config.ts` — one `DATABASE_URL`, one `TENANT_SLUG`, one set of
  Stripe keys, one Cloudinary account, all required per deployment.

Each client is a repo clone, a database, a VM, and a manual deploy. **Every free
signup would cost a VM, a database, and an engagement.** At the median freemium
conversion of ~5.6%, that is roughly 19 funded free deployments per paying customer.

Free-tier customer acquisition cost has to be near zero. Here it is an engagement.

**Decision required (§06):** free tier on shared multi-tenant infrastructure, or
no free tier and the entry point is a paid starter.

---

### S — Seats, volume and storage are unmetered

Nothing counts people, records, or uploaded assets. There is no usage table, no
seat cap, no quota check anywhere in `apps/api`.

Because the modules are not cleanly separable (see **D**), the free-tier ceiling
cannot be module count alone — it has to be seats or record volume. Neither is
measurable today.

**Needed:** a metering table and a quota preHandler, plus a decision on what the
free tier's ceiling actually is.

---

## 03 — Secondary findings

### No export path — the brand promise has no code

There are no export or download endpoints anywhere in `apps/api/src/modules`.
Compliance has `voided_at` soft deletes and nothing else.

This matters more than it looks. `blnk_brand.md` promises *"you own the result,
we don't hold the keys."* If the pricing model moves to subscription, the honest
version of that promise becomes **"your data leaves whenever you do"** — and that
clean exit is the genuine differentiator, not the composable free tier (Odoo
already has that). It currently does not exist in code.

### The module list is duplicated in six places

There is no module registry. Adding or renaming a module means touching all of:

1. `apps/api/src/config.ts` — `config.features`
2. `packages/shared/src/index.ts` — `FeatureFlags` interface
3. `apps/api/src/server.ts` — the conditional registration block
4. `apps/app/src/lib/nav.ts` — the `NAV` array and `FeatureKey`
5. `apps/api/src/modules/feed/index.ts:40` — `available_modules` hardcodes
   `['asset', 'compliance']`
6. `person_module.module` — free-text `TEXT`, no constraint or FK (`011_people.sql`)

Once modules are SKUs, this scatter becomes a billing-correctness problem.

### Feature flags and SKUs are not the same list

`FeatureFlags` currently mixes three concerns:

```ts
stripe, oneOff, subscriptions,   // payment capabilities, not sellable modules
commerce, analytics, locations,  // sellable modules
compliance, asset, schedule, roster
```

`stripe` / `oneOff` / `subscriptions` are three flags for one payments module.
The SKU list and the flag list need to stop being the same list.

### The frontend ships everything to everyone

All dashboard screens are in one Expo bundle; `visibleNav()` in
`apps/app/src/lib/nav.ts` only *hides* items. A free-tier user downloads the
compliance, commerce and asset code. Not a security hole — the server enforces
correctly, and disabled modules' routes 404 — but it is bundle weight for free
users and a visible "what you're not paying for" surface.

### Migration naming debt

Migrations 012–034 are `vessel_*`; `035_rename_vessel_to_asset.sql` renamed the
concept but not the history. Cosmetic today, but confusing for anyone new picking
up the dependency mapping in **D**.

---

## 04 — What is *not* a problem

- **Rebranding is cheap.** Theme tokens live in `apps/app/src/theme/tokens.ts`
  with per-tenant overrides via `023_custom_colors.sql` and a `/dashboard/theme`
  screen. The auth proxy (`apps/api/src/routes/auth-proxy.ts`) already keeps blnk
  invisible to end users.
- **API-layer module isolation is clean.** Each module imports only its own query
  file plus `people`. No module imports another module's code. The coupling is at
  the database and product level, not the plugin level — which is the easier of
  the two to fix.
- **Per-user access control is solid.** `requireModule()`, `requireRole()`,
  `requireAppAccess()` and `callerPersonId()` are consistent and server-enforced.
  Cross-tenant reads return 404. The pattern to extend for entitlements already exists.
- **Disabled modules fail closed.** An unregistered plugin means no routes at all,
  so there is no leakage risk from the current flag approach — only an
  operational one.

---

## 05 — Recommended sequence

Order matters. Each step is blocked by the one before it.

1. **Map the dependency graph.** Which modules genuinely stand alone. This decides
   the SKU list and whether the proposed free tier is even constructible.
2. **Build a module registry.** One declaration per module — key, label, `requires`,
   nav entry, whether it is sellable. Collapse the six duplicated lists into it.
3. **Entitlements as data.** `blnk_api` serves per-tenant entitlements;
   `client_api` caches and enforces via `requireEntitlement()`. Add grace and
   read-only states.
4. **Resolve tenancy.** Shared multi-tenant infrastructure, or drop the free tier.
5. **Add metering.** Seats and record volume, so a free-tier ceiling can exist.
6. **Add export.** Before charging subscriptions, make leaving clean and say so.
7. **Wire blnk billing last.** Stripe Billing module catalogue, prices resolved at
   runtime. Billing last, because you cannot bill for a boundary you have not drawn.

---

## 06 — Open decisions

These need Robbie, not engineering.

| # | decision | why it blocks |
|---|---|---|
| 1 | Free tier on shared infrastructure, or no free tier? | Determines whether steps 4–7 are a rebuild or an increment |
| 2 | What is the free-tier ceiling — seats, records, or both? | Metering can't be built without it |
| 3 | Does the brand promise change, or does the business split? | `blnk_brand.md` and `blnk_brief.md` both say *"one cost, no subscriptions"* in writing. A module subscription contradicts that. Either split blnk services (one-cost, owned) from blnk platform (SaaS), or rewrite the promise from "no subscriptions" to "your data leaves whenever you do" |
| 4 | Which modules are actually sellable alone? | Falls out of step 1, but the commercial call is yours |

---

## 07 — Market context

Supporting the direction, briefly:

- Pure per-seat pricing share fell from 21% to 15% in twelve months; analysts
  expect 70% of vendors off pure per-seat by 2028.
- Hybrid pricing (base plus modular/metered) sits at ~59% adoption.
- Freemium free-to-paid conversion runs ~5.6% median; 8–12% is excellent.
- SMB SaaS logo churn is 3–7% per month, against under 1% for enterprise.
  Modular pricing helps here — a client drops a module instead of the account.
- Odoo's "One App Free" is the closest existing analogue: one app, unlimited
  users, free forever. Odoo has since drifted toward per-user tiers, reportedly
  because pure per-module billing made bills unpredictable. Keep module count low
  and prices round.

Sources: SaaS Pricing Statistics 2026 (saasgoodies.com) · Odoo Pricing 2026
(erpresearch.com) · SaaS Pricing Models Guide (revenera.com).

---

*blnk.nz · Confidential · September 2026*
