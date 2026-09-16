# Session 516 Prompt: Resume the Pre-Research Presentation Brief build loop

> **Branch note.** The build lives on `claude/pre-rp-brief` (pushed, upstream set, HEAD
> `4446ce13`). `main` has only the plan and this handoff. On any machine: `git fetch`,
> `git checkout claude/pre-rp-brief`, then `/start` and answer "stay on the branch".
> Resume from `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md` §9.

## Session 515 Summary

Session 515 closed the email-feedback Production proof, pivoted on user feedback about the
Pre-Site distribution, planned a new governed document (the Pre-Research Presentation
Brief) through four Codex adversarial rounds, applied both Production Dataverse schema
writes, and ran an owner-directed Sonnet-build / Opus-review loop through four of six
slices before pausing at the owner's request.

### What Was Completed

1. **Email-feedback operational proof closed.** Owner-driven Production smoke of a
   ledger-backed Meeting Tracker agenda send rendered exactly **Sent for delivery.**; the
   owner received the email. Smoke session cancelled; three test rows removed from
   `deliberation_agenda_sends` after owner confirmation (11 → 8). Work-queue item 10 closed.
2. **Pre-Research Presentation Brief planned.** Fourteen owner decisions (B1–B14) settled:
   fourth governed artifact type `100000009` with request pointer `wmkf_CurrentPreRPBrief`,
   deterministic OOXML render from a tracked template (no prompt), one-time lock (lifecycle
   only), review gate + drift fingerprint + fingerprint-bound acknowledgement at prepare
   persisted via Postgres migration 052, brief replaces the Pre-Site writeup on the briefing
   page, Share decoupled from the Site Visit transition (explicit Start Site Visit action),
   staff edits trusted (no content validation), drift acknowledgement visible in staff
   history and as a timestamp-only Board notice. Plan §7 records all four Codex rounds
   (three review-only, one rescue) with dispositions.
3. **Production schema applied (owner-run, 2026-09-16).** Picklist value `100000009`
   "Pre-Research Presentation Brief" inserted and re-read; relationship
   `wmkf_request_currentprerpbrief` created under `DATAVERSE_PROD_WRITE_ACK`; preflight
   `--target=prod` = 43 exact / 0 absent / 0 divergent. Migration 052 is **not** applied.
4. **Build loop (branch `claude/pre-rp-brief`).** Slices 1–2 approved after three Opus
   rounds (template metadata carrying staff names was scrubbed and the slice-2 commit
   replaced before any push); slice 3 approved after two rounds (a roster return-shape bug
   that would have failed every generation in Production was caught by the reviewer and
   fixed with a real-module composition test); slice 4 built and awaiting Opus round 1.
   Slices 5–6 not started. 268 tests pass across the affected suites.

### Commits (main)

> Also on `main` (concurrent session, not covered by this summary): six commits `1abc097a`..`c52cb7b0`
> adding the accepted-reviewer release workflow and related fixes; they merged cleanly under this handoff.

- `1e0ae48a` — Record email feedback Production smoke proof
- `01afb0cd` — Record email feedback smoke residue cleanup
- `b36b101a` — Record deletion of Session 514 agenda test rows
- `83c6ef47` — Plan the Pre-Research Presentation Brief
- `bc8270ab`, `e2f306f1`, `3883ece2`, `236d9219` — Plan revisions after Codex rounds 1–4

### Commits (claude/pre-rp-brief, on top of `236d9219`)

- `66cd2eb2` slice 1 plumbing · `538388f2` slice 2 template + renderer · `c6f4a95c`,
  `eec8311d` slice 1–2 review fixes · `1b0eab56`, `8320d9ec`, `4bc38700` slice 3 ·
  `d08ae753`, `4dbef6d7` slice 4 · `4446ce13` pause handoff

## Next Items

### Verified Open

1. **Resume the build loop at slice 4 review.**
   Evidence: plan §9 (resume steps, reviewer self-trace, three carried items).
   Spawn an Opus reviewer for `git diff 4bc38700..HEAD`; on APPROVE, Sonnet builds slice 5
   (Staff Deliberations UI, Start Site Visit action, drift confirmation UI, composite stage
   projection in both callers, cycle-list union), then slice 6 (docs reconcile via `/sweep`:
   Atlas "applied 2026-09-16", `DATAVERSE_SHAREPOINT_FILE_MODEL.md`, wiki, work queue).
2. **Controller review, PR, Codex adversarial review.**
   Evidence: owner directive 2026-09-16 ("when they are done, you review the build … then
   send to codex for an adversarial review").
   `/contract-reconcile` Mode B invariant table, full `/start` gate list sequentially, full
   jest, lint, build; open the PR; owner runs
   `/codex:adversarial-review --wait --base 236d9219 --model gpt-5.6-sol …` with
   `[ADVERSARIAL-REVIEW-RECEIPT: docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md]`.
3. **Production smoke after merge** on a ZZTEST request: generate, lock, share, briefing
   page serves the brief, drift acknowledgement path.

### Owner Decision Needed

1. **Managed private-repository migration gates** (unchanged from S514).
   Evidence: `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md` § Mandatory decision gates.
2. **Ops-meeting decisions (2026-09-16 meeting).**
   Evidence: `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` still active. Record
   the applicant-materials reminder schedule, PC manual-reminder race, and Cycle Dossier
   worker cadence decisions, then close the memory.

### Parked

1. **Plan §8 follow-ups**: replayed `clientOperationId` can resurrect a superseded row
   (both brief and Pre-Site services; decide once); received-state boolean vs raw
   `reviewReceivedAt` in `REVIEW_FINGERPRINT_FIELDS`; deprecating the Pre-Site prerequisite
   for Final Writeup.
2. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).

### Verify Before Acting

1. Slice-4 code is **unreviewed**. Do not merge or smoke it before Opus round 1 and the
   controller review.
2. Migration 052 exists on the branch only; apply via `node scripts/apply-migrations.js`
   after merge, never `setup-database.js`.
3. A Codex rescue agent (round 4) ran with write access to the main checkout; an
   unauthored rewrite of `.claude-memory/feedback-codex-delegation-review-vs-rescue-routing.md`
   appeared and was **reverted** at the owner's direction. If Codex rescue is used again,
   check `git status` for memory edits before committing.

### Do Not Reopen Without New Decision

1. Owner decisions B1–B14 in the plan.
2. Email feedback: confirmed sends render only **Sent for delivery.**
3. The removed agenda-send test rows and cancelled test sessions.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md` | Plan, decisions B1–B14, four Codex rounds (§7), follow-ups (§8), build-loop handoff (§9) |
| `lib/services/pre-rp-brief/` | Renderer, input service, artifact service, share-lock service (branch) |
| `lib/services/pre-site-visit/distribution-service.js` | Brief-sourced distribution + prepare gate (branch, slice 4) |
| `lib/db/migrations/052_pre_site_distribution_brief_inputs.sql` | Drift-acknowledgement audit columns (branch, unapplied) |
| `shared/templates/pre-research-presentation-brief/brief-v1.docx` | Tracked, metadata-scrubbed template |
| `scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs` | Picklist insert (executed in Production 2026-09-16) |
| `docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md` | Closed proof + residue record |

## Testing

```bash
npm test -- --runInBand --silent
npm run build
npm run lint
npx jest tests/unit/pre-rp-brief* tests/unit/pre-site-distribution* tests/unit/deliberation-briefing* tests/unit/external-briefing* --silent
```

Session 515: on the branch, 268 tests across the affected suites pass; the full suite, build,
and lint were not run at the pause. `report:claim-evidence-pilot -- --current` recorded one
advisory (fired to a builder subagent); a bounded row was added to the pilot directive.
