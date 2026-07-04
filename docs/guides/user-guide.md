# SurfGen User Guide

**Who this is for:** creators, marketers, and anyone who wants to produce AI avatar videos in the SurfGen studio without touching code. You need a running SurfGen deployment (someone on your team ran `./scripts/install.sh`) and login credentials. If you administer the deployment, also read the [Admin Guide](admin-guide.md); if you script against the API, see the [CLI Guide](cli.md) and [API reference](../api/README.md).

## Getting an account

Create an account at **`/signup`** — name, email, and a password of at least 12 characters (a live strength meter guides you; mixing cases, digits, and symbols strengthens it). Signing up provisions a personal workspace (organization) automatically.

**Email verification.** When the deployment enables it (`REQUIRE_EMAIL_VERIFICATION=true`), signup ends with a "check your inbox" screen: click the emailed link within 24 hours to confirm the address — it signs you in directly. Links are single-use; if one expires, use **Resend verification email** on the signup confirmation or sign-in page. Until you verify, sign-in is refused with a resend prompt. On deployments without verification, signup signs you in immediately.

You can also sign in at `/login` with:

- **The seeded admin account** — `admin@surfgen.local` (pre-verified). The install/seed script prints the password when it runs (set `ADMIN_PASSWORD` beforehand to choose it; otherwise a random one is generated and printed once).
- **An account created via the API**:

```bash
curl -X POST http://localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{ "email": "you@example.com", "password": "at-least-12-characters", "name": "Your Name" }'
```

To join a teammate's organization, an org admin adds you by email (see [Admin Guide](admin-guide.md#managing-members)).

Your browser session uses a secure httpOnly cookie; you stay signed in and can log out from the top bar at any time.

## The studio tour

After login you land in the studio shell: a dark sidebar on the left, a top bar, and the current page. The top bar shows a health pill ("All systems operational" when the API is reachable), a log-out button, and the **New Project** button, which opens a picker of starting points (blank project, avatar + script, from template, AI workflow) that routes you to the right page.

The sidebar has two groups:

**Create**

| Page | What it does |
|---|---|
| **Dashboard** (`/`) | Workspace overview: stat cards (videos total, average render time over the last 50 runs, jobs in flight, active workflows) and a grid of recent videos with All / Rendering / Drafts filters. Click a video card to open it in the editor. |
| **Video Editor** (`/editor`) | Edit a video's scenes and script, start renders, watch live progress, and play the finished video. |
| **Avatar & Voice** (`/studio`) | Your organization's avatar and voice library. |
| **Workflows** (`/workflows`) | A visual, node-based view of your automation workflows. |
| **Brand Kits** (`/brands`) | Reusable colors and fonts — built by hand or extracted from a website. |

**Admin** (Providers, GPU & Queues, Developer, Plugins) — covered in the [Admin Guide](admin-guide.md).

## Creating a project and a video

The studio works inside your organization's first project. Today, creating the video record itself happens through the CLI or API — the dashboard's empty state points you to the same one-liner:

```bash
surfgen videos create --title "hello" --generate
```

(See the [CLI Guide](cli.md) for setup — a teammate with API access can also create videos for you.) Once a video exists, it appears on the dashboard and everything else — editing, rendering, watching — happens in the studio. A video creation form in the web UI is on the [roadmap](../roadmap.md).

## Editing scenes and scripts

Open a video from the dashboard (or `/editor?video=<id>`). The editor has four areas:

- **Scene rail** (left) — every scene as a numbered thumbnail with its duration. Click to select, hover and hit the trash icon to delete, or **Add scene** at the bottom to append a new one. If a video has no scenes yet, the generation pipeline creates them from the script.
- **Canvas** (center) — a preview of the active scene with the script overlaid and the assigned avatar badge. When the video's status is **ready**, the canvas becomes a real video player with the rendered output.
- **Inspector** (right) — the scene's script editor. Type your changes and save; scripts save per scene, and a script edit never wipes the scene's avatar or voice assignment. The inspector also shows which avatar and voice the scene uses.
- **Timeline** (bottom) — the scene's tracks, a play toggle, and the **Render** button.

The "AI Rewrite" and "Subtitles" buttons in the canvas toolbar are informational today: AI rewriting runs through the configured LLM provider during generation, and subtitles are produced by the pipeline's subtitle stage — neither is an in-editor action yet.

## Rendering and watching progress

Press **Render** (or use `surfgen videos generate <videoId>`). The request is queued and the pipeline takes over. A video moves through these statuses:

```
draft → queued → generating → rendering → post_processing → ready
                                        ↘ failed / cancelled
```

While a render runs, a live progress pill appears in the editor's toolbar showing the current pipeline stage and overall percentage — it updates in real time over a WebSocket connection scoped to your organization, and studio toasts announce completion or failure. The dashboard's "Rendering" filter and the stat cards reflect the same state.

When the status reaches **ready**, the editor plays the output directly. Playback links are short-lived signed URLs (15 minutes) — reopen the video to get a fresh one.

## Avatars and voices

Open **Avatar & Voice** and switch between the two tabs:

- **Avatars** — a card grid of your organization's avatars, each labeled by kind (Photo, Video, 3D, Animated). **Create avatar** registers a new photo avatar by name; uploading source media for it is a next step on the [roadmap](../roadmap.md).
- **Voices** — the voice list with language, provider, and a "cloned" marker where applicable. New (non-cloned) voices are registered via the API. The **Clone a voice** card is a placeholder: cloning requires a signed consent token and runs through the pipeline's voice-clone stage — the self-serve flow is not wired up yet.

Scenes reference avatars and voices by ID; the editor shows whichever the scene uses (falling back to the first in your library).

## Brand kits

**Brand Kits** stores reusable color + font sets. Each kit has four colors (primary, secondary, ink, surface — hex values) and two fonts (display, body).

Two ways to build one:

1. **Manually** — hit **Create brand kit**, fill in the name, colors, and fonts in the builder, and watch the live preview update. Save when it looks right.
2. **Extract from a website** — in the builder, paste a URL and hit extract. SurfGen fetches the public page and proposes a palette from the site's theme color, page title, and most frequent CSS colors. Everything it proposes stays editable before you save.

Click any existing kit to reopen it in the builder and update it.

## Workflows

**Workflows** shows your organization's automation workflows as a node graph — script, LLM, translate, TTS, avatar, lip-sync, and render nodes connected by animated edges. Pick a workflow in the left rail to view it; each entry shows its version and enabled state.

**Run workflow** queues a run (you'll see "Workflow run queued"). Today the run is recorded as pending — standalone workflow execution by the orchestrator is on the [roadmap](../roadmap.md); video generation pipelines already run end to end. Workflows themselves are created and edited via the API (`POST /v1/orgs/:orgId/workflows`); a drag-and-drop builder is planned.

## Where to go next

- Administering members, providers, plugins, and keys: [Admin Guide](admin-guide.md)
- Scripting and automation: [CLI Guide](cli.md)
- API concepts and the interactive reference at `/docs`: [API README](../api/README.md)
- What's coming: [Roadmap](../roadmap.md)
