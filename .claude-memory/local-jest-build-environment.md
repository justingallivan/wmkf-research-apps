---
name: local-jest-build-environment
description: Historical S173 Rosetta/corrupt-dependency build incident; check current architecture, tool paths and dependency state before diagnosing or changing the local environment.
metadata: 
  node_type: memory
  type: project
  originSessionId: 8973a5d9-b293-4f16-b683-f8fa76e1618a
  status: active
  scope: dev-env
  last_verified: S173 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: local `npx jest` / `npm run build` hangs or behaves oddly on Justin's Mac, or considering whether local test/build is viable vs CI-only.

Do:
- Check the current shell/Node architecture, resolved executable, installed version,
  and dependency state. The S173 diagnosis is a possible cause, not a current verdict.
- Consult the current CI workflows and package constraints before proposing a runtime
  change. [VERIFIED 2026-10-22 via `.github/workflows/test.yml` and `e2e.yml`] Both
  workflows specify Node 22; this does not identify the hosted Vercel runtime.

Do not:
- Assume an old successful reset proves the current machine is healthy or a new
  failure has the same cause. Do not relink Homebrew, remove dependencies or old
  installations, or terminate processes without a current diagnosis and authorized scope.

Ground truth: historical-only (lesson, not live state); `/opt/homebrew/bin/node`. Related: [[memory-store-propagation]].

## Historical incident — S173 (2026-05-21)

Justin's Apple Silicon Mac local dev environment was diagnosed and repaired in S173.

**The S172 "local jest/build hangs" problem is RESOLVED.** Three compounding causes, all addressed:

1. **Terminal ran under Rosetta (x86_64).** The universal `node` binary inherited the shell arch, so everything ran emulated x64. Fixed: unchecked "Open using Rosetta" on Terminal.app.
2. **Wrong-arch / corrupt `node_modules`.** Past installs under Rosetta fetched x64 binaries (`@next/swc-darwin-x64`); several `npm install` runs killed mid-flight left the tree inconsistent. This corrupt tree — not jest/next config — was the actual cause of the jest hang (infinite unsymbolicatable native/JIT recursion; `--listTests`/`--showConfig` worked, only test execution hung).
3. **`.next` was a symlink** (iCloud `.nosync` scheme) — removed; minor, not the main cause.

**Fix applied in S173 (historical, not a reset prescription):**
- Terminal: Rosetta OFF.
- Node: reinstalled via arm64 Homebrew — `brew install node` → **Node 26.0.0 arm64** at `/opt/homebrew/bin/node`. PATH already had `/opt/homebrew/bin` first, so it shadows the old official-installer `/usr/local/bin/node`.
- Global CLIs reinstalled under new node: `npm i -g @openai/codex @google/gemini-cli vercel`.
- Project: `rm -rf node_modules && npm ci` from the arm64 shell — 727 packages in 8s, pulled correct arm64 SWC automatically.

**Result then:** `npx jest` full suite = 43 suites / 540 passed in 3.24s. This showed
that local Jest worked after that repair; it is not a current suite count or machine check.

**Watch items recorded then:** the session considered a Node 24 fallback and
identified shadowed `/usr/local/bin/node`, `/usr/local/lib/node_modules`, Intel
Homebrew directories, and TeX 2017/2018 installations. Their current presence,
ownership and consumers have not been checked. The former "trash later" / "safe
to delete" suggestions are superseded: none is a standing cleanup authorization.
The old claim that CI defaulted to Node 24 must not be used as current workflow evidence.

**Why this mattered:** S173 burned a long detour because architecture/state claims
weren't checked against the actual shell. Apply the diagnostic lesson, not an
assurance that the environment remains fixed. See [[memory-store-propagation]].
