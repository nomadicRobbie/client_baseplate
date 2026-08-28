# Database Operations

## Overview

The production database runs as a single PostgreSQL 16 container (`blnk_postgres`) on the blnk server. It hosts multiple databases — one shared blnk database, one per-client database, and a blnk_auth database.

```
blnk_api    — blnk core data (tenants, billing, users)
blnk_auth   — passkey/OTP config per tenant
blnk_web    — blnk web app data
ting_test   — client-baseplate app data (commerce, profiles, etc.)
wedding     — wedding app data
```

---

## Connecting

### Production (SSH into server first)

```bash
ssh robbie@blnk
docker exec -it blnk_postgres psql -U blnk -d <database>
```

Common targets:

```bash
# blnk core
docker exec -it blnk_postgres psql -U blnk -d blnk_api

# auth config (passkeys, OTP, allowed origins)
docker exec -it blnk_postgres psql -U blnk -d blnk_auth

# client-baseplate app data
docker exec -it blnk_postgres psql -U blnk -d ting_test
```

### Local development

```bash
psql "postgres://ting-test:ting-test@localhost:5435/ting-test"
```

Or via Docker:

```bash
docker exec -it ting-test_postgres psql -U ting-test -d ting-test
```

---

## Useful psql commands

```
\l            — list databases
\dt           — list tables in current database
\d <table>    — describe a table
\q            — quit
```

---

## Finding client details

### Look up a tenant

```sql
-- blnk_api
SELECT id, name, slug, plan, active FROM tenants WHERE slug = 'ting-test';
```

### Look up auth config (passkeys, allowed origins)

```sql
-- blnk_auth
SELECT slug, rp_id, allowed_origins, signup_mode
FROM tenant_auth_config
WHERE slug = 'ting-test';
```

### Update passkey RP ID / allowed origins (e.g. after domain change)

```sql
-- blnk_auth
UPDATE tenant_auth_config
SET rp_id = 'baseplate-app.blnk.nz',
    allowed_origins = '{https://baseplate-app.blnk.nz}'
WHERE slug = 'ting-test';
```

---

## Commerce tables (ting_test database)

```sql
SELECT * FROM commerce_products;
SELECT * FROM commerce_product_variants WHERE product_id = '<id>';
```

### Wipe all commerce data (start fresh)

```sql
TRUNCATE commerce_product_variants, commerce_products RESTART IDENTITY CASCADE;
```

---

## PM2 — API processes

The client API and blnk services run under PM2 on the server.

```bash
pm2 list                        — show all processes
pm2 logs client-api --lines 50  — tail client API logs
pm2 logs blnk-auth --lines 20   — tail auth service logs
pm2 restart client-api          — restart client API after deploy
```

---

## Docker — infrastructure

```bash
docker ps                       — show running containers
docker inspect blnk_postgres    — full container config (env vars, ports, etc.)
```

The postgres container is managed by `~/blnk-data/docker-compose.yml` on the server.
Local postgres is managed by `apps/api/docker-compose.yml`.
