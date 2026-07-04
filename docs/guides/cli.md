# SurfGen CLI Guide

**Who this is for:** developers and power users who script SurfGen from a terminal or CI. SurfGen ships two functionally equivalent CLIs — `surfgen` (Node) and `surfgen-py` (Python) — that share the same config file, so you can use either (or both) interchangeably. Concepts like orgs, projects, and video statuses are covered in the [User Guide](user-guide.md) and [API README](../api/README.md).

## Install

**Node CLI** (`apps/cli`, package `@surfgen/cli`, binary `surfgen`) — from the monorepo:

```bash
pnpm install && pnpm --filter @surfgen/cli build
node apps/cli/dist/main.js --help     # or link it: cd apps/cli && npm link
```

**Python CLI** (`apps/cli-py`, package `surfgen-cli`, binary `surfgen-py`) — requires Python ≥ 3.10:

```bash
pip install ./apps/cli-py             # or: cd apps/cli-py && pip install -e .
surfgen-py --help
```

All examples below use `surfgen`; every command exists identically as `surfgen-py` unless noted.

## Configuration

Both CLIs read and write **`~/.surfgen/config.json`** (camelCase keys):

```json
{
  "apiUrl": "http://127.0.0.1:4000",
  "accessToken": "…",
  "refreshToken": "…",
  "apiKey": "…",
  "defaultOrgId": "…",
  "defaultProjectId": "…"
}
```

- The directory is created `0700` and the file `0600`, written atomically — safe for tokens.
- `SURFGEN_API_URL` overrides `apiUrl`. The Node CLI also accepts a global `--api <url>` flag; the Python CLI additionally honors `SURFGEN_CONFIG_HOME` to relocate the config directory.
- Default API URL is the local API on port 4000.
- If both an API key and a JWT are stored, the **API key wins** (sent as `X-Api-Key`); otherwise the access token is sent as `Authorization: Bearer …`. On a 401 with a stored refresh token, the CLI silently refreshes once and retries.

**Secrets never go on argv.** Passwords and API keys are read from an environment variable, piped stdin, or a hidden prompt — there is no `--password` or key argument by design (argv leaks into shell history and `ps`).

## Command reference

JSON results print to stdout (pipe into `jq`); confirmations and errors go to stderr. Failures exit non-zero with `✗ CODE: message`.

### auth

```bash
surfgen auth login --email you@example.com
# Password: ********            ← hidden prompt, or set SURFGEN_PASSWORD, or pipe stdin
# ✓ logged in
```

```bash
surfgen auth use-key            # store an API key instead of a JWT session
# API key: ********             ← hidden prompt, or SURFGEN_API_KEY, or: echo "$KEY" | surfgen auth use-key
# ✓ API key stored
```

```bash
surfgen auth logout             # revokes the refresh token server-side, clears local credentials
# ✓ logged out
```

### orgs

```bash
surfgen orgs list
```

```json
[
  { "id": "cmc…", "name": "Admin Workspace", "slug": "admin-workspace", "role": "owner", "createdAt": "…" }
]
```

```bash
surfgen orgs use <orgId>        # ✓ default org: cmc…   (saved to config)
```

### projects

Project commands require a default org (`orgs use`).

```bash
surfgen projects list
```

```json
[
  { "id": "cmp…", "organizationId": "cmc…", "name": "Launch videos", "description": null, "createdAt": "…" }
]
```

```bash
surfgen projects create --name "Launch videos" [--description "Q3 campaign"]
surfgen projects use <projectId>   # ✓ default project: cmp…
```

### videos

Video commands require both defaults (`orgs use` + `projects use`).

```bash
surfgen videos list
```

```bash
surfgen videos create --title "hello" \
  [--script "Welcome to SurfGen."]   # omit to have the LLM write one
  [--language en]                    # BCP-47 tag, default en
  [--voice <voiceId>] [--avatar <avatarId>]
  [--generate]                       # immediately queue generation
```

Without `--generate` it prints the created video (status `draft`); with it, the queued generation result:

```json
{
  "id": "cmv…",
  "title": "hello",
  "status": "queued",
  "language": "en",
  "output": null
}
```

```bash
surfgen videos status <videoId>     # full video record incl. status and output when ready
surfgen videos generate <videoId>   # queue (or re-queue) a render
surfgen videos cancel <videoId>     # cooperative cancel — workers stop at the next poll
```

That is the complete command set for both CLIs — anything else (scenes, brand kits, webhooks, keys, members) is done in the studio or against the [REST API](../api/README.md) directly.

## A complete session

```bash
surfgen auth login --email admin@surfgen.local
surfgen orgs list                              # find your org id
surfgen orgs use cmc123…
surfgen projects create --name "Demos"
surfgen projects use cmp456…
surfgen videos create --title "First render" --script "Hi from SurfGen." --generate
surfgen videos status cmv789…                  # poll until "status": "ready"
```

For CI, prefer an API key over a login session:

```bash
export SURFGEN_API_KEY=sg_live_…               # from an org admin, shown once at creation
surfgen auth use-key
surfgen videos create --title "nightly" --generate
```
