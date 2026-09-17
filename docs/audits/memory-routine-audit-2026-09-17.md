---
title: Memory Router Diet — 2026-09-17
summary: "Router diet under runbook §10 after the 8 KiB trigger fired; status narratives moved to the archive, leaf lists collapsed onto wiki Durable Memory hubs; no memory content deleted."
canonical: false
owner: product-engineering
last_verified: 2026-09-17
---

Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.

Repo baseline: `main` @ `86746473` (Session 518).

## Scope

Mode: router diet (runbook §10) triggered by the `check:memory-router` notice at
session start (8,239 B ≥ 8,192 B). Excluded, deliberately: the §6 five-leaf
sample and per-finding health dispositions (queued as the next routine audit;
the health counts below are recorded as the denominator, unchanged by this
diet). No leaf file was deleted or rewritten; two leaves are being edited on the
parallel branch `codex/ops-meeting-2026-09-16` and were not touched here.

## Commands run

```
check:memory-router            before: 8239 bytes / 70 lines / 67 unique leaf refs
                               after:  6921 bytes / 67 lines / 52 unique leaf refs
§6.B composition               before: bytes 8239 | leaf 67 | hub 46
                               after:  bytes 6921 | leaf 52 | hub 41
§6.C status census             267 files: active 240, closed 20, superseded 4, stale 3
check:memory-health            shadow-atlas 3, weak-basis 1, no-recall-rule 12, oversize-routed 5, stale-routed 0 (before = after)
check:memory-drift:no-write    clean: 5 live drift findings, 0 blockers (committed report evaluated read-only, flagged stale)
check:agent-wiki (+self-test)  OK, 13 topic pages
check:doc-symbol-refs          OK, 1722 path refs resolve
```

## Findings

| line / claim | classification | evidence | disposition |
|---|---|---|---|
| Site Visit materials line carried "SHIPPED S503; PR #252 merged; cron unscheduled; briefing page live S502" | status narrative | §10 step 1 | moved to `project-closed-work-archive.md` (Shipped features) |
| PC Meeting Tracker line carried "D1–D25 decided; live in prod S503" + two Codex build briefs | status narrative | §10 step 1 | moved to archive; router keeps the plan hub |
| Reviewer lifecycle line carried "SHIPPED S489" | status narrative (already in archive) | archive entry | router line reduced to the decision trigger |
| Reviewer Find latency incident doc + Fable assessment output | point-in-time | §10 step 1 | moved to archive; postmortem leaf stays in Working Norms |
| Environment / deployment: 8 leaves on two lines | leaf list | §10 step 2 | listed under `dev-environment.md` Durable Memory; router keeps 2 hazard leaves |
| Delegated work: 4 leaves | leaf list | §10 step 2 | listed under `dev-environment.md` Durable Memory; router keeps model + owner-runs-it |
| Reviewer product decisions: 3 leaves | leaf list | §10 step 2 | listed under `reviewer-identity.md` Durable Memory; router keeps contact-recall |
| Workbench closeout / capture mode / transient-state: 5 leaves on 4 lines | leaf list | §10 step 2 | listed under `reviewer-workbench-lifecycle.md` Durable Memory; router routes to the hub |
| `docs/atlas/dataverse-wmkf-requestdocument.md` on the Initial Assessment line | hub duplicate | linked from `docs/APPLICATION_STATE_ATLAS.md` (grep count 1) | dropped from the router |

## Falsification

- Every leaf removed from the router was grepped by name in `docs/agent-wiki/topics/*.md` and the archive; all 15 resolve to at least one hub, and each leaf file exists on disk.
- `check:memory-router` reports all 267 topic files still link-resolve with a valid status.

## Fixes applied

Single commit on `main` (docs/memory only): router, archive, three wiki Durable Memory sections, this note, and the §18 metrics row.

## Unknowns and owner decisions

- The §6 routine audit proper (five-leaf sample, 21 health dispositions) is due; proposed as the next memory task.
- The committed memory-drift report is flagged stale by the read-only checker; `npm run refresh:memory-drift` is an authorized live refresh, not run here.
- Landing point is 6.9 KiB / 52 leaves against the §10 target of ~6 KiB / ~45. The remaining leaf lists are Working Norms feedback entries with no natural wiki hub; a later diet may need a norms hub page.

## Metrics row

Appended to `docs/MEMORY_HYGIENE_RUNBOOK.md` §18.

## Verdict

RECONCILED WITH EXPLICIT UNKNOWNS.
