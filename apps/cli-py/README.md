# surfgen-py — SurfGen Python CLI

Python mirror of the Node CLI (`apps/cli`). Both share `~/.surfgen/config.json`, so a login from either works in both.

```bash
pip install -e apps/cli-py
surfgen-py auth login --email you@example.com   # password: hidden prompt / SURFGEN_PASSWORD / piped stdin
surfgen-py orgs list
surfgen-py orgs use <orgId>
surfgen-py projects create --name demo
surfgen-py projects use <projectId>
surfgen-py videos create --title hello --script "Welcome to SurfGen." --generate
surfgen-py videos status <videoId>
```

Credentials are never accepted as command-line arguments (they leak via shell history and `ps`). Sources, in order: environment variable (`SURFGEN_PASSWORD` / `SURFGEN_API_KEY`), piped stdin, hidden interactive prompt. Config is written atomically with mode `0600`.

Tests: `pip install -e ".[dev]" && pytest` (httpx MockTransport — no server needed).
