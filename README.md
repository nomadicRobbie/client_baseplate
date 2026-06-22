# client-baseplate

Template monorepo for a blnk client engagement. **Clone this per client.**

```
apps/
  api/      Fastify client_api — backend for one client
  app/      Expo universal frontend (web PWA + iOS + Android)   [Phase 3b]
packages/
  shared/   Isomorphic TypeScript shared by api + app (types, contracts, pure helpers)
```

## The three layers

```
apps/app  ──► apps/api  ──► blnk_auth  (auth, via /auth/* proxy)
                        └─► blnk_api   (email, portal, billing)
```

The frontend talks **only** to `apps/api`. `apps/api` proxies auth to `blnk_auth`
(end users never see blnk) and verifies blnk_auth JWTs locally via cached JWKS.

## Rules

- `packages/shared` is **isomorphic** — runs in Node, React Native, and the browser.
  No `pg`/`fastify`/Node built-ins, no RN-only APIs. Types + zod + pure functions only.
- `apps/api/src/blnk/` is the platform-integration layer. Keep it **self-contained** —
  it will graduate to a versioned `@blnk/sdk` package once we have a few clients.
- Hot-swap features via `FEATURE_*` env flags (see `apps/api/.env.example`):
  `stripe`/`one_off`/`subscriptions` (payments), `commerce` (store), `analytics`
  (website traffic — see `../../docs/analytics.md`).
- **Auth sessions self-heal.** The app holds a 15 min access token + a 7 day refresh
  token; `apps/app/src/lib/api.ts` silently refreshes on a `401` and only routes to
  `/login` when the refresh also fails — screens never show an auth error toast.

## Dev

```
nvm use 22                    # Node 16 breaks corepack/pnpm + native modules
pnpm approve-builds --all     # once per clone — pnpm 11 ignores native build scripts otherwise
pnpm install
pnpm dev          # runs all apps via turbo
pnpm typecheck
```

> Adding a new Expo `dashboard/*.tsx` screen? Run `npx expo start` (CI=1) once to
> regenerate route types, or `tsc` trips on `router.replace`.

Local ports: blnk_api `8000`, blnk_auth `3100`, client_api `4000` (baseplate default).
The blnk-web client runs on `4100` (its own clone).
