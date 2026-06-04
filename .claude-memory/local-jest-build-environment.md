---
name: local-jest-build-environment
description: "S173 fixed Justin's Mac dev env — Rosetta off, Node arm64 via Homebrew, clean node_modules. jest/build work now."
metadata: 
  node_type: memory
  type: project
  originSessionId: 8973a5d9-b293-4f16-b683-f8fa76e1618a
  status: closed
  scope: dev-env
  last_verified: S173 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: local `npx jest` / `npm run build` hangs or behaves oddly on Justin's Mac, or considering whether local test/build is viable vs CI-only.

Do:
- Treat the env as fixed: Rosetta OFF, Node arm64 via Homebrew at `/opt/homebrew/bin/node`, clean `npm ci` tree — jest + build work locally now.
- If a dep breaks on Node 26, fall back: `brew install node@24 && brew unlink node && brew link node@24`.

Do not:
- Re-litigate the S172 "jest hangs" diagnosis or re-chase jest/next config (the cause was a wrong-arch/corrupt `node_modules`, now reset).

Ground truth: historical-only (lesson, not live state); `/opt/homebrew/bin/node`. Related: [[memory-store-propagation]].

Justin's Apple Silicon Mac local dev environment — diagnosed and FIXED in S173 (2026-05-21).

**The S172 "local jest/build hangs" problem is RESOLVED.** Three compounding causes, all addressed:

1. **Terminal ran under Rosetta (x86_64).** The universal `node` binary inherited the shell arch, so everything ran emulated x64. Fixed: unchecked "Open using Rosetta" on Terminal.app.
2. **Wrong-arch / corrupt `node_modules`.** Past installs under Rosetta fetched x64 binaries (`@next/swc-darwin-x64`); several `npm install` runs killed mid-flight left the tree inconsistent. This corrupt tree — not jest/next config — was the actual cause of the jest hang (infinite unsymbolicatable native/JIT recursion; `--listTests`/`--showConfig` worked, only test execution hung).
3. **`.next` was a symlink** (iCloud `.nosync` scheme) — removed; minor, not the main cause.

**Fix applied (the canonical reset):**
- Terminal: Rosetta OFF.
- Node: reinstalled via arm64 Homebrew — `brew install node` → **Node 26.0.0 arm64** at `/opt/homebrew/bin/node`. PATH already had `/opt/homebrew/bin` first, so it shadows the old official-installer `/usr/local/bin/node`.
- Global CLIs reinstalled under new node: `npm i -g @openai/codex @google/gemini-cli vercel`.
- Project: `rm -rf node_modules && npm ci` from the arm64 shell — 727 packages in 8s, pulled correct arm64 SWC automatically.

**Result:** `npx jest` full suite = 43 suites / 540 passed in 3.24s. jest works locally now — CI no longer the only option.

**Watch items:** Node 26 is very new (Vercel CI default is Node 24 LTS); if a dep breaks on 26, `brew install node@24 && brew unlink node && brew link node@24`. The old `/usr/local/bin/node` + `/usr/local/lib/node_modules` are harmlessly shadowed — trash later. `/usr/local` still has Intel-Homebrew remnants (`Homebrew/`, `Cellar/`) safe to delete; `/usr/local/texlive/{2017,2018}` are stale (TeX 2026-Basic is active). `node`/`npm` in `/usr/local` were the official Node .pkg installer's default location, NOT Homebrew.

**Why this mattered:** S173 burned a long detour because arch/state claims weren't verified against Justin's actual shell. **How to apply:** the env is fixed — don't re-litigate it. See [[memory-store-propagation]] for related multi-store context.
