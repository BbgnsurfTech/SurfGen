# Hostinger Deployment — Handoff (2026-07-22)

Resume point for a fresh session. The deployment is **partially live**; two Dockerfile bugs block completion.

## Live state

`surfgen.io` → `76.13.44.91` (DNS done, propagated, Traefik answering). VPS `1613644`, compose project `surfgen`, built from the git context on `main`.

| Service | State |
| --- | --- |
| postgres, redis, rabbitmq | running, healthy |
| web | running, healthy (Next.js standalone build works) |
| migrate | exited 0 — schema created via `db push`, seed ran |
| **api** | **crash-loop** — `Cannot find module '/app/dist/main.js'` |
| **worker** | **crash-loop** — `Cannot find package '@surfgen/ai-sdk' imported from /app/dist/main.js` |

Co-tenants (`traefik`, `bedrock`, `aso-website`, `postgresql-u6ju`) unaffected.

`https://surfgen.io/healthz` returns 404 because the api container never stays up, so its Traefik
router has no healthy backend. TLS has not been exercised yet for the same reason.

## Root cause 1 — worker (PROVEN)

pnpm does **not** hoist workspace packages to the root `node_modules`. Verified on this checkout:

```
$ ls node_modules/@surfgen          # root — EMPTY
$ ls -la apps/workers/pipeline/node_modules/@surfgen
ai-sdk -> ../../../../../packages/ai-sdk
config -> ../../../../../packages/config
core   -> ../../../../../packages/core
...
```

`infra/docker/Dockerfile.worker` copies `/app/node_modules`, `/app/packages`, `/app/plugins`,
`/app/config` — but **not** `apps/workers/pipeline/node_modules`. Node resolving
`@surfgen/ai-sdk` from `/app/dist/main.js` walks up to `/app/node_modules`, finds no `@surfgen`
scope, and throws `ERR_MODULE_NOT_FOUND`.

`tsup` (`apps/workers/pipeline/tsup.config.ts`) does not bundle these — no `noExternal` — so they
are genuine runtime imports.

## Root cause 2 — api (NARROWED, not proven)

`apps/api/package.json` → `build: tsc -p tsconfig.build.json`. That config sets `rootDir: "src"`,
`include: ["src"]`, inherits `outDir: "dist"`, and flips `noEmit` to `false`. So `src/main.ts`
**should** emit to `dist/main.js`, and the local `apps/api/dist/` confirms that flattened shape
(`app.module.js`, `auth/`, `billing/`, `common/`, …).

The image built successfully, and `COPY --from=build /app/apps/api/dist ./dist` would have failed
the build if that directory were absent — so *something* was copied. Why `main.js` specifically is
missing is unresolved.

**Do this first — one command settles it:**

```bash
docker run --rm --entrypoint sh surfgen-api -c 'ls -la /app/dist | head -30'
```

(Run on the VPS, where images build reliably. Local Docker on the workstation has intermittent
DNS failures — `getaddrinfo EAI_AGAIN registry.npmjs.org` — which defeated two attempts at local
verification. Do not burn time fighting it.)

**The api has root cause 1 as well.** `apps/api/node_modules/@surfgen/` is also a symlink
directory that is never copied, so even once the entrypoint resolves, the api will fail on
`@surfgen/config`. Fix both issues together.

## Recommended fix (both Dockerfiles)

Preserve the build stage's **absolute paths** in the runtime stage, so every relative symlink
still resolves. Rather than flattening `apps/api/dist` → `/app/dist`, keep the original layout:

```dockerfile
WORKDIR /app
COPY --from=build --chown=surfgen:surfgen /app/node_modules ./node_modules
COPY --from=build --chown=surfgen:surfgen /app/packages ./packages
COPY --from=build --chown=surfgen:surfgen /app/plugins ./plugins      # worker only
COPY --from=build --chown=surfgen:surfgen /app/config ./config
COPY --from=build --chown=surfgen:surfgen /app/apps/api ./apps/api    # dist + node_modules
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
```

Because the symlinks are relative (`../../../../packages/core`) and the absolute paths are
unchanged, they resolve exactly as they did at build time. Note `pnpm` also uses
`node_modules/.pnpm`, which the root `node_modules` copy already carries.

The alternative is `pnpm deploy` (self-contained `node_modules` with real files rather than
symlinks). It is the idiomatic answer but pnpm 10 requires `--legacy` or
`inject-workspace-packages=true`, and it was not verifiable here.

**Preserve when editing:** the `mkdir -p /app/storage/local && chown -R surfgen:surfgen
/app/storage` lines in both runtime stages. That fix is correct and proven by negative control —
without it a fresh named volume mounts root-owned and the non-root process cannot write rendered
media. If `WORKDIR` moves, confirm `config/storage.yaml`'s relative `./storage/local` still lands
on the mounted volume path, or make the mount point absolute in the compose file.

## Redeploy loop

```
VPS_createNewProjectV1(virtualMachineId=1613644, project_name="surfgen",
  content="https://raw.githubusercontent.com/BbgnsurfTech/SurfGen/main/infra/docker/docker-compose.hostinger.yml",
  environment=<same env block>)
```

Re-creating replaces the project; named volumes persist. **Push to `main` first** — the compose
file builds from the git context, so unpushed commits are invisible to the VPS. Each cycle is
20-40 minutes.

The env block is already on the VPS at `/docker/surfgen/.env`; retrieve it with
`VPS_getProjectContentsV1(projectName="surfgen")` rather than regenerating secrets, or the
existing Postgres volume will no longer match `POSTGRES_PASSWORD`.

## Remaining work after the fix

1. Task 7 verification gate (`docs/superpowers/plans/2026-07-22-hostinger-deployment.md`) — TLS
   chain, routing split, `www` redirect, signup, and one end-to-end render + playback.
2. Task 8 runbook (the section text is written out in the plan, ready to paste).
3. **Correct three wrong verification criteria in that plan** (found during execution):
   - Task 4 Step 5 is inverted. `docker compose config` re-escapes `$` as `$$` for round-trip
     fidelity, so `$${1}` in its output is *correct*. Verify by inspecting the label on a real
     container instead.
   - Task 4 Step 6a expects `2`; actual is `3` — `config` preserves the `x-app-env` anchor block,
     so the anchor's own `JWT_SECRET` is counted alongside api and worker.
   - Task 1 Step 8's grep can never print `clean`: `BBGNSURF` is also legitimate brand copy
     (`BBGNSURF · AI VIDEO`) in four files. Match the URL literal instead.
4. Admin SMTP feature — spec at `docs/superpowers/specs/2026-07-22-admin-smtp-settings-design.md`,
   **not started**, no implementation plan written yet. `REQUIRE_EMAIL_VERIFICATION` currently
   deploys empty (off) so signups work without a relay; flip it to `true` once SMTP is
   configurable from the dashboard.

## Notes

- `apps/web` renders and is healthy, but has not been checked through Traefik yet (no cert issued
  while the api router has no backend).
- Unrelated but worth closing: co-tenant `postgresql-u6ju` publishes `0.0.0.0:32768`, exposing
  Postgres to the internet. Co-tenant `bedrock` has a live `AUTH_SECRET` in a committed `.env`.
