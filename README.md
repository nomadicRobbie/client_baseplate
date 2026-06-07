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
- Hot-swap features via `FEATURE_*` env flags (see `apps/api/.env.example`).

## Dev

```
pnpm install
pnpm dev          # runs all apps via turbo
pnpm typecheck
```

Local ports: blnk_api `8000`, blnk_auth `3100`, client_api `4000`.
