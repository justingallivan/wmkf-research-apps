# Session 518 Prompt: Pre-RP Brief owner decisions and the memory-router diet

## Session 517 Summary

Session 517 started on `main` after PRs #310–#312 had merged, ran the first full ZZTEST
Production smoke of the Pre-Research Presentation Brief, found a P1 defect in the frozen
distribution's Word identity, fixed it on a branch through three Codex adversarial rounds
and one Codex rescue build, merged PR #313, verified the Production deployment against the
merge commit, and re-smoked the two failing paths with no data change.

### What Was Completed

1. **ZZTEST-03 Production smoke (request #1003222).** Generate, lock for share, share
   (prepare + send, panel rendered only **Sent for delivery.**), briefing page with the
   two-review bundle PDF, email link (owner confirmed), drift detection after an owner
   abstract edit in Dynamics ("Changed fields: abstract"), and superuser guarded
   regeneration all passed. Bundle rebuild after a new review was not run (no third review).
   The drift-acknowledged retry, a no-drift re-preview, and the Board's Staff Brief download
   all failed with a snapshot hash mismatch — plan §12 Finding A.
2. **Root cause established.** SharePoint rewrites a generated `.docx` after upload
   (property promotion), and the rewrite lands after prepare's post-upload metadata read, so
   the pinned package byte hash never matched the bytes Graph served later. Discriminator:
   request 1002903's brief-based share worked at SharePoint version 3.0 (Word-saved, already
   carrying the promoted parts); both ZZTEST-03 shares were version 1.0 raw renderer output.
   A timing test on a regenerated brief ruled out generation-to-share delay.
3. **Fix shipped — PR #313 (`b5af962b`), branch `claude/pre-rp-brief-snapshot-hash`, deleted
   after merge.** Retained Word snapshots are identified by `hashGovernedDocxContent` in
   snapshot reuse, lost-finalize recovery, same-operation re-capture, send attachments, and
   the Board `writeup-docx` download; PDF and calendar keep byte identity. The hasher now
   validates (digest unchanged) that the package root opens `word/document.xml`, that every
   internal relationship reachable from it resolves under `word/`, and that no Override
   relabels a reachable `.xml` part as non-XML. The briefing download binds its registry row
   before any Graph read (request, distribution-docx producer, Ready, not Superseded,
   drive/item and source document/governed hash equal to the sent ledger).
   `recordDistributionSource` refreshes served-byte metadata for the same source identity and
   `recordDistributionPrepared` fences finalization on the caller's capture. No schema change.
4. **Codex rounds.** Round 1 (four findings, all fixed by Claude), round 2 (three findings,
   built by Codex rescue `1e5cfee5`, reviewed by Claude, who narrowed the Content_Types rule
   after a probe showed a false rejection of images declared by Override), round 3 (fence
   fixed; external-link/Content_Types-in-digest finding declined as an accepted residual with
   reasons). All dispositions in plan §12.
5. **Post-deploy verification.** Deployment `dpl_4DVSPjkWg8cp693qyw4gvrG7m7VQ` Ready and
   tied to `b5af962b` via the GitHub deployments API; ZZTEST-03's Staff Brief download served
   (30,823-byte `.docx`) and a same-version re-preview returned 200. The interim "save in
   Word before sharing" rule is lifted. Handoff item 5 closed; work-queue row 12 met.

### Commits (main)
- `eece40b0` - Record the ZZTEST-03 Pre-RP Brief Production smoke and the snapshot hash-mismatch finding
- `fe6ba417` - Identify retained Word snapshots by governed content hash, not package bytes
- `d6e5a378` - Harden the governed Word identity after Codex round 1
- `1e5cfee5` - Fix OPC traversal, source recapture CAS, and ledger binding (Codex rescue)
- `86c86bf5` - Narrow the Content_Types Override check to reachable XML parts
- `ccb0d3fc` - Fence prepare finalization on the captured source identity (Codex round 3)
- `1a58ea2c` - Handoff: record PR #313
- `b5af962b` - Merge pull request #313
- `ace87840` - Record PR #313 shipped, deployed, and smoked on ZZTEST-03

## Next Items

### Verified Open

1. **Bundle rebuild after a new review** was never smoked in Production.
   Evidence: plan §12 step table ("NOT RUN — no third review submitted").
   Needs a third ZZTEST-03 reviewer submission via the portal, then "Download all reviews
   (PDF)" on the briefing page should rebuild (CAS on the set fingerprint, plan §11).
2. **Memory router diet.** Evidence: `check:memory-router` warning — `MEMORY.md` is 8239 B,
   over the 8192 B routine-audit trigger (no session has run the diet since it crossed).
   Run `docs/MEMORY_HYGIENE_RUNBOOK.md` §10 before the 11264 B warn band.

### Owner Decision Needed

1. **Plan §11 "Open for owner" (PR #312):** (1) unconvertible review fails Share closed vs a
   placeholder page; (1b) Unicode reviewer names need `@pdf-lib/fontkit` + a bundled TTF,
   today replaced with `?`; (2) separator pages carry reviewer name and affiliation; (3) the
   three bundle bounds are code literals, kept as safety ceilings; move behind
   `wmkf_appsystemsettings` if staff must tune them (memory
   `feedback-mutable-parameters-not-in-code`).
2. **Plan §10.4 residual (PR #311):** sub-second window between a send and a guarded
   reopen claim; accepted as-is by the orchestrator, owner may want a stronger lock.
3. **Plan §12 accepted residual (Codex round 3, declined):** external relationships and
   `[Content_Types].xml` stay outside the governed digest. Reopen only if a producer that
   emits external images or non-Default media types enters the governed flows.
4. **Managed private-repository migration gates** (unchanged from S514).
   Evidence: `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md`.
5. **Ops-meeting decisions (2026-09-16 meeting).** Evidence: memory
   `project-ops-meeting-2026-09-16-agenda.md` still `status: active`.

### Parked

1. Plan §8 (vi): the panel defaults-seed-through-stale-reset case is structural (seed
   requires an untouched composer, prepare requires a recipient edit); no test, recorded.
   Related UI sharp edge from the smoke (plan §12 note 1): the To field seeds staff
   recipients asynchronously and a caret placed before the seed lands splices typed text.
2. Plan §8 remaining: received-state boolean vs raw `reviewReceivedAt` in
   `REVIEW_FINGERPRINT_FIELDS`; deprecating the Pre-Site prerequisite for Final Writeup.
3. Plan §12 note 3: the Administration "Guarded reopen attempts" list shows Pre-Site attempts
   only; the brief's regeneration audit tuple lives on the successor row and is not surfaced.
4. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).

### Verify Before Acting

1. ZZTEST-03 residue: the regenerated brief is locked and previewed (not sent) as the current
   share; the 9:20 AM sent row and shared briefing link remain; the abstract was restored by
   the owner. A future smoke should start from this state, not assume a fresh request.
2. The #311/#312 conflict resolution (`dcc9c796`) and the fixture fix (`8f8cfc1b`) are
   test-verified but were never Codex-reviewed.

### Do Not Reopen Without New Decision

1. Owner decisions B1–B14 in the plan; the review-bundle consistency contract
   (last-observed snapshot, plan §11 and the matrix row).
2. Word snapshot identity is the governed content hash, never package bytes (plan §12,
   wiki `dataverse-dynamics.md`); a Word-saved package round-trips byte-identical, a raw
   generated one does not.
3. Email feedback: confirmed sends render only **Sent for delivery.**

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md` | §12 smoke table, Finding A, three Codex rounds with dispositions, shipped state |
| `lib/services/initial-assessment/artifact-service.js` | `hashGovernedDocxContent` + OPC traversal/Content_Types validation (digest unchanged) |
| `lib/services/pre-site-visit/distribution-service.js` | `validateReadySnapshot`, lost-finalize recovery, `loadCapturedSource`, `ensureEmailAttachment` on governed hash |
| `lib/services/pre-site-visit/distribution-store.js` | `recordDistributionSource` same-identity refresh; `recordDistributionPrepared` capture fence |
| `lib/services/deliberation-briefing/briefing-page-service.js` | `writeup-docx` registry binding + ledger-anchored governed hash |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | SharePoint Office-package rewrite: raw vs Word-saved packages |
| `tests/unit/pre-site-distribution-store.test.js` | Store SQL-parameter tests for both predicates |

## Testing

```bash
npm test -- --runInBand --silent
npm run lint
npx jest tests/unit/initial-assessment-artifact-service.test.js tests/unit/pre-site-distribution* tests/unit/deliberation-briefing-page-service.test.js tests/unit/external-briefing* --silent
```

Session 517: PR #313 CI green (Jest, Semgrep, Gitleaks, Trivy, claude-review); touched-surface
gates green at every commit. `report:claim-evidence-pilot -- --current` recorded no eligible
plan/design edit for this session key; no observation row added.
