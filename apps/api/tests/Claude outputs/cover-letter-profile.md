# Cover letter profile — Robbie Jameson

Built from rj_cv.pdf, September 2026. Update as things change.

## Contact
- Robbie Jameson — Dunedin, New Zealand
- robbie.jameson.123@gmail.com · 021 257 1667
- robbiejameson.nz · GitHub · LinkedIn

## Positioning
Full-stack and mobile developer with production experience across web applications,
real-time systems, and native iOS and Android apps shipped to the App Store and
Google Play. Four years professional software experience following a prior career
in professional kitchens and remote operations management.

## Roles

### blnk — Multi-tenant SaaS platform (founder; primary role)
Built end to end. Node.js, Fastify, TypeScript.
- Secure identity service issuing RS256 JWTs with passkey authentication
  (WebAuthn/FIDO2) and email OTP fallback
- Multi-tenant core handling auth delegation, billing and email routing over
  PostgreSQL, Redis and native WebSockets for real-time performance
- Custom CLI provisioning isolated client environments from a Turborepo baseplate,
  automating billing and identity record creation
- Universal Expo dashboard (Web PWA, iOS, Android) from a single codebase, with
  role-based routing and dynamic per-tenant theming
- First-party analytics module for traffic time-series and page views, removing
  third-party tracking scripts
- Handled CI/CD and documented every module

### Beamy Ltd — Real-time POS platform (3 years)
Elixir, Phoenix, Vue 3. Production point-of-sale for high-concurrency retail.
- Real-time UI updates for multi-terminal workflows using WebSockets and CouchDB,
  keeping state synchronised across devices
- Payment processing: Stripe, EFTPOS NZ, Windcave — automated subscription
  management and failed-payment handling
- Native iOS (Swift) and Android (Kotlin) features, full lifecycle through to
  app store release
- Debugged production incidents including a WebSocket state desync across terminals

### Nomadic Media Studios Ltd — Custom client solutions (ongoing, minimal)
FastAPI, MongoDB, React.
- Responsive admin dashboards for inventory and content management
- Front-end applications connected to secure backend services and third-party APIs

## Selected project

### weRecycle — Educational recycling game (in development)
C# on Unity 6.3 LTS, URP, iOS and Android.
- Four namespaced C# layers communicating via events and interface contracts
- ScriptableObject data architecture — region-specific council rules as data assets,
  so a new council is a new file, not a code change
- Event-driven touch input on the Enhanced Touch API
- Real-time accumulation with cross-session persistence
- Unity → Xcode → physical device build pipeline
- Versioned handoff document covering architecture, defects and technical debt

## Skills
- Languages: TypeScript, JavaScript, Python, Elixir, C#
- Front-end: React, Vue 3
- Mobile: React Native, Expo, Swift, Kotlin — shipped to App Store and Google Play
- Backend: Node.js, Fastify, Phoenix, FastAPI, REST APIs, WebSockets
- Data: PostgreSQL, Redis, CouchDB, MongoDB
- Payments/Auth: Stripe, Windcave, EFTPOS NZ, SmartPay, OAuth, SSO, WebAuthn/passkeys
- Tooling: Turborepo, Git, Linux, Sentry
- Testing: three-level API suite on blnk, run from the command line on node:test
  with tsx — unit tests for the compliance rule engine; integration tests against a
  live PostgreSQL instance with migrations applied and parallel-safe per-test
  fixtures; route-level tests via app.inject with real RS256 tokens and a throwaway
  JWKS server, including a cross-tenant rejection test on the isolation boundary.
  Some end-to-end work with Cypress.

## Prior career
- 2017–2022 — Lodge Manager, Chef & Operations, Wilsons Abel Tasman: ran daily
  operations for a remote lodge sleeping up to 34, coordinated supply logistics to a
  remote coastal site with no same-day resupply, maintained safety and compliance
  under strict time constraints
- 2007–2017 — professional kitchens in the UK and NZ, Kitchen Porter to Head Chef;
  Assistant Manager for a wine wholesaler (stock control, suppliers, team management)

## Voice notes
- Plain, first person, direct. Short sentences.
- Concrete over abstract: names the tool, the bug, the constraint.
- Honest about limits rather than papering over them — states what was learnt,
  including what went wrong.
- Dislikes corporate filler and LinkedIn register ("deepened my appreciation",
  "results-driven", "passionate about excellence").
- Comfortable naming the chef-to-engineer pivot as a genuine differentiator:
  operational discipline, calm under pressure, working to non-negotiable deadlines.
- KISS — keep it simple.

## Notes for future letters
- Overlapping dates: blnk was built evenings and weekends while at Beamy, and is
  now the primary role. Nomadic Media Studios is the freelance vehicle.
- "Self-taught" was deliberately removed from the CV summary — let the production
  experience speak instead.
