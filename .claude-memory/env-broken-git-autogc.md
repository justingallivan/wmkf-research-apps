---
name: env-broken-git-autogc
description: git traversal commands (gc/fsck/repack/prune) hang in mmap — CONFIRMED cause is cloud File Provider dataless placeholders on .git loose objects; fix = move repo off cloud-synced path
metadata: 
  node_type: memory
  type: project
  originSessionId: 8821677f-2a33-4a32-b5ca-e3fb038b41a1
---

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

**Fix (recommended): fresh clone outside any cloud-synced path.** Repo is fully
pushed to origin/main and only ~51M. `git clone` into e.g. `~/dev/WMKF_Apps`
gives a clean fully-packed repo, zero dataless objects, zero loose bloat. Then
copy untracked/ignored files the clone lacks (`.env*`, `.claude/settings.local.json`,
`docs/INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md`, local config), verify, delete old
copy. Do NOT plain-`mv` the repo without first materializing all dataless
objects — moving online-only files out of the provider domain can orphan their
content.

**Recovery if a commit fails with `cannot lock ref 'HEAD'`:** a hung gc died
mid-ref-pack and left a stale lock. `pkill -f 'git-core/git (gc|repack|prune|pack-objects|maintenance)'`,
then if `.git/refs/heads/main` is missing but `main.lock` exists, the lock
file content IS the correct ref value — `mv` it onto `main`. Verify with
`git rev-parse HEAD`.

**Config note:** `gc.auto 0` is set on this repo as an interim workaround. Once
the repo is on a non-synced path, re-enable with `git config --unset gc.auto`.
