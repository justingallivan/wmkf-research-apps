---
name: env-broken-git-autogc
description: Historical S175 cloud File Provider diagnosis and July 2026 resolved-repo snapshot; lock/process recovery instructions require current repo-specific ownership verification and explicit repair authorization
metadata: 
  node_type: memory
  type: project
  originSessionId: 8821677f-2a33-4a32-b5ca-e3fb038b41a1
  status: active
  scope: dev-env
  last_verified: 2026-07-12 (historical environment snapshot; not a current repo-state check)
---

## Recall Rule

Read this when: git traversal commands (`gc`/`fsck`/`repack`/`prune`/`rev-list --all`) hang, or a commit fails with `cannot lock ref 'HEAD'`.

Do:
- Treat the incident and July snapshot below as dated evidence, not current process/ref/path state. If traversal or a lock failure recurs, inspect the exact repository, process ownership, lock contents, refs, and reflog; preserve evidence and obtain explicit authorization for any process termination or ref repair. Use a reviewed, repo-specific recovery plan; never assume a lock file contains the right ref or replace a ref from it automatically.
- Keep repositories outside cloud-synced paths when establishing or moving a checkout, but verify the actual path and ownership before any move.

Do not:
- Put `.git` back under a cloud File Provider (OneDrive/Google Drive/iCloud) — dataless placeholders on loose objects cause `mmap()` page-fault hangs.
- Plain-`mv` a cloud-hosted repo without first materializing all dataless objects (can orphan content).

Ground truth: historical-only (resolved S209; recovery runbook + do-not-relitigate guard). Root cause confirmed S175 via `ls -lO` showing `dataless` flag.

> **Resolved at the time of the 2026-07-12 snapshot (historical; not a current environment assertion).** The recorded checks then found this repo at `/Users/gallivan/Code/WMKF_Apps`, `gc.auto` unset, no dataless objects, and full-walk traversal completing. Keep this as dated evidence and a reminder to avoid cloud-synced repository storage; it does not establish the current checkout path or state.

**Symptom (S174–S175):** every git command that walks ALL loose objects in
`.git/objects/` — `gc`, `repack`, `prune`, `fsck` — hangs. Targeted commands
(`commit`, `log`, `status`, `rev-parse`, `push`, `fetch`) work. `sample` shows
the process parked inside `mmap()` reading loose objects.

**Status: cause CONFIRMED (S175, 2026-05-22).** The S174 reboot did NOT fix it,
disproving the "stale OS links" theory. Direct evidence: `ls -lO` on
`.git/objects/**` loose objects shows the macOS `dataless` flag —
`hidden,compressed,dataless` — meaning the object content is offloaded to a
cloud provider as an online-only placeholder. When `git fsck`/`gc` `mmap()`s a
dataless object, the page fault triggers a synchronous cloud download that
hangs. It survives reboots because eviction state is persistent provider
metadata. Only full-object-walk commands hang; `commit`/`status`/`fetch` touch
only recent (still-materialized) objects.

**Mechanism:** the repo lives under `/Users/gallivan/Documents/...`. `~/Documents`
is NOT an iCloud (com~apple~CloudDocs) folder and is NOT a symlink — but a cloud
File Provider (OneDrive "Folder Backup" for the WMKeckFoundation work account,
and/or Google Drive mirror; BeeStation also runs) manages its contents in place
via the File Provider API and offloads cold files to `dataless`. The repo had
31,790 loose objects (`gc.auto 0` set, so nothing ever packs) — perfect cold
eviction targets. So the "iCloud" guess was wrong only on the *specific
provider*; the dataless-placeholder *mechanism* is real and confirmed.

**Historical recovery recommendation:** establish a clean checkout outside any cloud-synced
path only after reviewing current Git state and preserving owner-owned or untracked work.
The old clone/copy/delete recipe was not a general authorization to copy secrets or
remove an old checkout. Do not move an online-only tree without first establishing that all
objects and owner-owned files are preserved.

**Historical S175 lock observation:** a hung gc had died mid-ref-pack and left a lock.
Do not use the old broad `pkill`/`mv main.lock` recipe. For a current lock failure,
identify the exact repository and lock/ref ownership, preserve refs and reflog evidence,
and use an explicitly authorized repair scoped to the confirmed failure.

**Historical config note:** `gc.auto` was observed unset on this repo in the 2026-07-12
snapshot. Recheck current configuration before drawing conclusions; do not change it as
a generic workaround.
