---
name: project-vercel-plugin-disabled-restore
description: Vercel plugin is disabled to save context — what it provides and exactly how to turn it back on when deploy debugging needs it
metadata: 
  node_type: memory
  type: project
  status: active
  scope: global
  last_verified: S377 via ~/.claude/settings.json + full-history transcript scan 2026-07-26
  originSessionId: 216e10b9-b505-4e68-a4eb-1559a471bea5
  modified: 2026-07-27T00:57:00.767Z
---

The `vercel@claude-plugins-official` plugin is **disabled** in `~/.claude/settings.json`
(set 2026-07-26, Session 377 `/doctor`). It is **not uninstalled** — it stays cached at
`~/.claude/plugins/cache/claude-plugins-official/vercel/` and re-enables instantly.

**Restore it (no re-authentication, takes seconds):**

1. Run `/plugin`, find `vercel@claude-plugins-official`, enable it — or set
   `.enabledPlugins["vercel@claude-plugins-official"] = true` in `~/.claude/settings.json`.
2. **Start a new session.** The skills listing and the SessionStart knowledge hook only
   load at startup, so an in-flight session will not pick it up.

**Reach for it when:** debugging a production deploy, reading runtime logs or errors,
inspecting deployment/build status, or Vercel env work from inside the agent. It supplies
`list_deployments`, `get_runtime_logs`, `get_deployment`, `get_project`,
`get_runtime_errors`, `get_deployment_build_logs`, plus 48 skills
(`vercel:deploy`, `vercel:env`, `vercel:vercel-cli`, `vercel:nextjs`, `vercel:vercel-functions`, …).

**Not affected by the disable:** the `vercel` CLI itself — **npm-global**, v57.0.0 as of
2026-07-26, not a package.json dependency. Shell-level `vercel deploy` / `vercel env` /
`vercel inspect` keep working. **Update it with `npm i -g vercel`, not brew.**

> **Install-path trap — npm and Homebrew share `/opt/homebrew` on this machine**
> [VERIFIED 2026-07-26 via `readlink`, `npm -g ls --depth=0`, and `brew list --versions`,
> each cross-checked against the other]. npm's global prefix is `/opt/homebrew`, so
> npm-installed CLIs land in `/opt/homebrew/bin` beside Homebrew's and `which` cannot tell
> them apart. Never infer the installer from the path prefix.
>
> | Tool | Installer | Update with |
> |---|---|---|
> | `vercel`, `codegraph` (`@colbymchenry/codegraph`), `codex` (`@openai/codex`), `gemini` | **npm-global** | `npm i -g <pkg>` |
> | `rtk` (0.43.0), `gh`, `node`/`npm` | **Homebrew** | `brew upgrade <formula>` |
> | `jq`, `git` | macOS system (`/usr/bin`) | neither |
>
> Diagnostic, for a tool inside `/opt/homebrew/bin`:
> `readlink /opt/homebrew/bin/<tool>` → `../lib/node_modules/…` = npm, `../Cellar/…` = brew.
> Confirm with `npm -g ls --depth=0` / `brew list --versions <tool>`; a tool resolving to
> `/usr/bin` is a third case (system-shipped) and belongs to neither manager.
>
> An earlier pass in this session asserted "Homebrew-installed" for `vercel` from the path
> prefix alone, labeled it `[VERIFIED]`, and was wrong — Codex had been correcting the owner
> toward `npm` and was right. See [[feedback-falsify-not-confirm]].
For deployment monitoring, `vercel inspect` is the preferred route anyway — see
[[feedback-deployment-monitoring-use-inspect]].

**Why it was disabled:** it costs ~5,200 est. tokens of context in *every* session
(48-skill listing ≈ 3,441 + SessionStart knowledge injection ≈ 1,750), and measured usage
was 37 MCP calls across 11 sessions spanning 2026-06-26 → 2026-07-06, then nothing for the
following 20 days. All 37 calls were deployment monitoring. The cost is continuous; the
need is episodic — so pay it on demand rather than always.

**Method note that produced this:** the first pass called the plugin "unused" from a
14-day transcript window whose boundary happened to fall 20 days after the last real use.
Only a full-history scan of all 506 transcripts surfaced the 37 calls. Usage verdicts must
search full history, never a default scan window — see [[feedback-falsify-not-confirm]].
