---
name: project-vercel-plugin-disabled-restore
description: The Vercel plugin was re-disabled 2026-08-12 to save context after being re-enabled; re-check current settings before using these restore instructions.
metadata: 
  node_type: memory
  type: project
  status: active
  scope: global
  last_verified: S387 via ~/.claude/settings.json + plugin cache measurement + transcript scan 2026-08-12
  originSessionId: 216e10b9-b505-4e68-a4eb-1559a471bea5
  modified: 2026-08-12T00:00:00.000Z
---

## Recall Rule

Read this when: deciding whether to re-enable the Vercel plugin or determining
how a globally installed CLI is managed on this machine.

Do:
- Re-check the current plugin setting before claiming it is disabled.
- Use `readlink` plus both package-manager inventories to identify an installer.
- Start a new session after re-enabling a plugin.

Do not:
- Infer npm vs Homebrew ownership from `/opt/homebrew/bin` alone.
- Treat the cached plugin or CLI version recorded below as timeless.

Ground truth: dated 2026-08-12 settings/plugin-cache/transcript/toolchain inspection
(superseding the 2026-07-26 pass). Current machine state requires the same read-only
checks before action.

**Machine snapshot, 2026-08-12 (S387):** `vercel@claude-plugins-official` is
disabled again in `~/.claude/settings.json`, cached (not uninstalled) at
v0.45.1. It had been re-enabled at some point between 2026-07-26 and
2026-08-12 — by what, unknown — so **this setting has flipped back once
already**. Re-check current plugin settings and cache presence before
applying the restore steps; do not assume the disable held.
`swift-lsp@claude-plugins-official` was disabled in the same pass (0 lifetime
uses, no Swift in this repo).

**Restore the skills and knowledge injection (seconds):**

1. Run `/plugin`, find `vercel@claude-plugins-official`, enable it — or set
   `.enabledPlugins["vercel@claude-plugins-official"] = true` in `~/.claude/settings.json`.
2. **Start a new session.** The skills listing and the SessionStart knowledge hook only
   load at startup, so an in-flight session will not pick it up.
3. **For the MCP observability tools, also authenticate** — see the auth note below. The
   S377 version of this file said "no re-authentication"; that was true of the skills but
   never of the MCP server, which is a separate OAuth grant.

**Reach for it when:** debugging a production deploy, reading runtime logs or errors,
inspecting deployment/build status, or Vercel env work from inside the agent. It supplies
`list_deployments`, `get_runtime_logs`, `get_deployment`, `get_project`,
`get_runtime_errors`, `get_deployment_build_logs`, plus — at v0.45.1, counted from
`skills/`, `commands/`, and `agents/` — **30 skills** (`vercel:deploy`, `vercel:env`,
`vercel:vercel-cli`, `vercel:nextjs`, `vercel:vercel-functions`, …), **5 commands**, and
**3 subagents**. Count only the top-level dirs of ONE version: a `find` across
`~/.claude/plugins/cache` spans both cached versions (0.44.0 and 0.45.1) and picks up the
plugin's own 7 internal dev skills under `.claude/skills/` (benchmark-*, release,
plugin-audit) that never reach a session listing — that mistake inflated an S387 draft
of this file to "37 skills / 14 subagents".

> **The MCP tools require auth and were NOT authenticated as of 2026-08-12.**
> With the plugin enabled, the server exposed only `authenticate` and
> `complete_authentication` — none of the six observability tools above. So
> re-enabling alone does not restore deployment monitoring; you must complete
> the OAuth flow first. Until then the plugin's entire delivered value is the
> knowledge injection and the skill listing.

**Not affected by the disable:** the `vercel` CLI itself — **npm-global**, v54.14.2
[VERIFIED 2026-08-12 via `npm -g ls --depth=0`], not a package.json dependency. Shell-level
`vercel deploy` / `vercel env` / `vercel inspect` keep working, and this repo's
`.claude/settings.local.json` already pre-approves `vercel env|logs|inspect|ls|whoami *`,
so the CLI route needs no prompting. **Update it with `npm i -g vercel`, not brew.**
(The S377 note recorded v57.0.0; the installed version today is 54.14.2. Read the
version, never carry it forward.)

> **Install-path trap — npm and Homebrew share `/opt/homebrew` on this machine**
> [RE-VERIFIED 2026-08-12 via `readlink`, `npm -g config get prefix`, and
> `npm -g ls --depth=0`; the table below still holds exactly]. npm's global prefix is `/opt/homebrew`, so
> npm-installed CLIs land in `/opt/homebrew/bin` beside Homebrew's and `which` cannot tell
> them apart. Never infer the installer from the path prefix.
>
> | Tool | Installer | Update with |
> |---|---|---|
> | `vercel`, `codegraph` (`@colbymchenry/codegraph`), `codex` (`@openai/codex`), `gemini` | **npm-global** | `npm i -g <pkg>` |
> | `gh`, `node`/`npm` | **Homebrew** | `brew upgrade <formula>` |
> | `rtk` | **Uninstalled as of 2026-08-30** | Do not invoke or reinstall without an owner decision |
> | `jq`, `git` | macOS system (`/usr/bin`) | neither |
>
> Diagnostic, for a tool inside `/opt/homebrew/bin`:
> `readlink /opt/homebrew/bin/<tool>` → `../lib/node_modules/…` = npm, `../Cellar/…` = brew.
> Confirm with `npm -g ls --depth=0` / `brew list --versions <tool>`; a tool resolving to
> `/usr/bin` is a third case (system-shipped) and belongs to neither manager.
>
> **Fourth case, found 2026-08-12: a second, abandoned npm prefix at `/usr/local`.**
> `/usr/local/lib/node_modules` holds stale globals from an older Node install —
> `@anthropic-ai/claude-code` 2.1.39 (86 MB), `vercel` 50.15.1, `@openai`, `@google`, `npm`
> — all shadowed on PATH by `/opt/homebrew/bin` and `~/.local/bin`, so `which` never reveals
> them. `npm -g <anything>` targets `/opt/homebrew` and will silently miss this tree; reach
> it with `npm --prefix /usr/local -g …`. The `@anthropic-ai` dir and `/usr/local/bin/claude`
> are **root-owned** (installed with `sudo`), so removal needs `sudo` — a plain uninstall
> fails EACCES. Before diagnosing "wrong version installed", check both prefixes.
>
> An earlier pass in this session asserted "Homebrew-installed" for `vercel` from the path
> prefix alone, labeled it `[VERIFIED]`, and was wrong — Codex had been correcting the owner
> toward `npm` and was right. See [[feedback-falsify-not-confirm]].
For deployment monitoring, `vercel inspect` is the preferred route anyway — see
[[feedback-deployment-monitoring-use-inspect]].

**Why it was disabled:** it costs ~4,000 est. tokens of context in *every* session
[MEASURED 2026-08-12 at v0.45.1: skill listing ≈ 2,189 + SessionStart knowledge injection
≈ 1,400 + commands ≈ 179 + agents ≈ 229]. Measured usage at S377 was 37 MCP calls across 11
sessions spanning 2026-06-26 → 2026-07-06, all deployment monitoring, then nothing. At S387
there were **zero** Vercel skill dispatches and zero Vercel MCP calls in every transcript
still on disk. The cost is continuous; the need is episodic — so pay it on demand.

The S377 figure was ~5,200 (3,441 + 1,750). The drop to ~4,000 is the corrected skill count
(30, not 48), not a shrinking plugin — do not read it as a trend.

**Method note that produced this:** the S377 first pass called the plugin "unused" from a
14-day transcript window whose boundary happened to fall 20 days after the last real use.
Only a full-history scan of all 506 transcripts surfaced the 37 calls. Usage verdicts must
search full history, never a default scan window — see [[feedback-falsify-not-confirm]].

> **That method has since lost its footing here.** As of 2026-08-12 only **15** transcripts
> remain on this machine (2026-07-01 → 2026-08-12); the ~506 were disposed of on 2026-07-27
> under the local retention audit. "Full history" is now a thin, moving window, and a
> zero-usage finding for anything episodic is correspondingly weaker evidence than the S377
> note implies. State the available span explicitly instead of claiming full history, and
> for a genuinely episodic tool prefer asking the owner over inferring from silence.
