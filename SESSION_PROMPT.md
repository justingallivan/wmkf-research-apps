# Session 454 Prompt: Guarded Pre-Site Release Preparation

## Session 453 Summary

Session 453 implemented and independently hardened guarded Pre-Site reopen on
`codex/guarded-reopen`. **[PRODUCTION-DEPLOYED 2026-08-23]** Wave 20 was
applied to Production and independently read back as three exact fields with
zero absent/divergent; the non-sensitive literal-on readiness flag was set;
merge `af986d92` deployed Ready as `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`.
A signed-in read-only Request `1002788` Pre-Site-tab smoke exercised the
extended status path without application errors or writes. **[PRODUCTION-PROVED
2026-08-23]** after exact owner approval, signed-in Request `1002379` completed
the durable guarded reopen and an exact unchanged retry reused the same
successor row and SharePoint item.

### What Was Completed

1. **The controlled Production Site Visit handoff passed.**
   - The owner explicitly approved the durable Production action for Request
     `1002379`.
   - The signed-in Workbench promoted the exact current Pre-Site Word workspace
     from Draft to Review and recorded the handoff at `8/21/2026, 5:22:36 PM`.
   - The Site Visit and Pre-Site views retained the same filename and exact
     SharePoint Edit/Download identity. A fresh authenticated load returned the
     Review state and milestone time, and regeneration was locked.
   - The transition service reports success only after an exact post-write
     reread of the SharePoint publication version, governed hash, and non-null
     milestone time. The browser did not expose those opaque values, so the
     proof remains bounded to the enforced service reread plus fresh UI/API
     state.

2. **Promoted Pre-Site is now a Production-proven read-only receipt.**
   - Pre-Site Edit, Download, filename, and Regenerate controls render only for
     Draft. Review shows one continuation action into Site Visit; later,
     missing-link, and unknown states fail closed.
   - Signed-in Request `1002379` showed zero Pre-Site work controls and one
     continuation action. Site Visit opened the expected same Word item with
     Edit/Download and the recorded handoff time. No second write or document
     action was invoked.
   - The request had no visible edit-check warning, so promoted-warning
     placement remains component-test evidence rather than browser-smoke
     evidence.

3. **The remaining Workbench lifecycle was designed but not misrepresented as built.**
   - Guarded correction/reopen preserves the Review row/file/milestone and
     creates an exact Draft successor under a durable audit and explicit
     permission contract. It must precede Final creation.
   - Informational sharing is an explicit frozen-PDF preview/send/history flow;
     it never asks external Board/consultant recipients to edit the Word
     workspace and never sends automatically on promotion.
   - AkoyaGo publication is a one-way derived projection, not a second source
     of truth. Exact path, filename, representation, permission, schema, and
     Power Automate contracts remain discovery-gated.
   - Site Visit logistics, dossier/supporting files, and the Final copy
     transaction remain later slices.

4. **The nonexistent former domain was removed from tracked sources.**
   - Established `wmkeck.org` examples replaced it where a real domain was
     intended. The repository search and relevant documentation gates passed.

5. **The memory-hygiene early-warning architecture is active.**
   - Fable branch `codex/fable-memory-hygiene-runbook` was merged into `main` at
     exact branch head `800eb8e4` via merge commit `00139331`.
   - The system adds single-sourced router thresholds, the 8 KiB routine-audit
     notice, SessionStart and Stop advisories, mutation-backed hook tests, and
     the canonical routine/deep-audit and router-diet runbook.
   - Every handoff-prescribed merge gate passed sequentially.

6. **The first routine memory audit and router diet are complete.**
   - All three health findings and five sampled leaves received explicit
     dispositions. One missing recall rule was fixed; two oversize leaves remain
     accepted, bounded hygiene debt for future domain-focused deep audits.
   - No memory file or leaf content was deleted. The router fell from `9,040` B
     / `66` lines / `63` direct leaf references to `5,911` B / `60` lines /
     `45` direct leaf references, below both the notice trigger and the
     approximately 6 KiB diet target.
   - The committed drift report was older than 24 hours and was deliberately
     not regenerated because no session claim relied on it being fresh.

7. **The Claude/Fable workstream was closed safely.**
   - Its clean worktree was removed after merge, verification, push, and
     deployment. The local and remote branch remain available for provenance.
   - `main` was clean and synchronized with `origin/main` before this handoff.

8. **Guarded Pre-Site reopen is source-complete and Opus-approved.**
   - The preserve-and-succeed service, superuser route/UI, exact-operation
     retry, cycle-salted regeneration, Wave 20 readiness interlock, append-only
     history, and stable-identity cleanup reconciliation are implemented.
   - Failed attempts remain exact-retry targets for their own operation; a
     different operation records any resolvable retained copy as cleanup work.
     Expired live claims follow the same cleanup contract before fallthrough.
   - Correction history and nested audit details are superuser-only across
     status, generation, and Site Visit handoff responses. Non-superusers do
     not receive pending reason-bearing reopen rows. Actor/time attribution is
     limited to the actual reason-bearing reopen event.
   - Multiple independent Claude Opus review rounds closed every P0–P3 finding.
     The final report returned **APPROVE — no actionable findings remain** at
     `/Users/gallivan/.claude/plans/perform-the-final-read-only-soft-parrot.md`.

9. **Guarded Pre-Site reopen passed the controlled Production mutation smoke.**
   - Exact owner approval bound the action to Request `1002379`. The signed-in
     superuser flow used reason `accidental_handoff` and created successor row
     `888982b6-0a9f-f111-b8dc-7ced8d3d15a6` plus SharePoint item
     `01G4GVMS5W3ILDTXPFENHY6VXJCK54GDPF`.
   - Dataverse readback showed the request pointer on that Ready/Draft
     successor, source row `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6` preserved
     as Superseded, no Final pointer, one cycle row, and no cleanup work.
   - Exact retry with cycle `0f107ddd-8d1f-4d68-abfc-b6cb5b3f0b9f` returned
     the same row/item with `reused: true`; it ran without a Production write
     acknowledgement, so any unexpected mutation path would have failed closed.
   - Independent Graph postcheck found both source and successor stable across
     reread, both governed hashes exact, and copied bytes identical. The
     preserved source's live eTag had advanced from its registry snapshot while
     drive/item/version/last-modified/size/hash remained exact; the service had
     already required the live eTag to stay stable across verification and
     activation.

### Commits

- `a089cf80` — docs(workbench): record production site visit handoff
- `ec8ed1f0` — docs(domains): remove nonexistent former-domain references
- `bebabb90` — docs: plan AkoyaGo writeup publication discovery
- `66c0c7ef` — fix(workbench): route promoted pre-site work to site visit
- `bd9dc060` — fix(workbench): harden site visit handoff receipt
- `b3bb0ef6` — fix(workbench): clarify read-only handoff states
- `429ac992` — docs(workbench): record production handoff receipt
- `43c8eab1` — docs(workbench): record signed-in receipt smoke
- `800eb8e4` — docs(handoff): branch handoff for Codex — merge + first router diet
- `00139331` — merge the Fable memory-hygiene branch into `main`
- `fb8dfab2` — docs(memory): complete first routine audit and router diet
- `1e14f651` — feat(workbench): add guarded pre-site reopen
- `6ce85d36` — fix(workbench): harden guarded reopen review findings
- `7096c6d4` — fix(workbench): close opus guarded reopen findings
- `7167d94` — fix(workbench): reconcile guarded reopen residuals
- `5545d0b` — fix(workbench): redact reopen audit on handoff

## Next Items

### Verified Open

1. **Observe Dynamics Explorer Phases A and B through organic use.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` and
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`. Deployment, migrations,
   exact schema readback, and one signed-in correlated request are complete.
   Accumulate normal staff traffic, then run the aggregate probes; do not
   manufacture requests or feedback.

2. **Observe Stage II institution outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Do not
   manufacture shared-roster rows. Re-probe live state before deciding whether
   the rollout flag should remain.

### Blocked on External Input

1. **Explorer campaign Phases C–D.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` Section 4.
   Blocked on 10–20 real Southern California questions and owner answers about
   population-served and `_socal` program-area usage.

### Owner Decision Needed

1. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Re-probe
   the live environment and replacement deployment before changing it.

### Parked / Sequenced After Guarded-Reopen Proof

1. Frozen PDF and informational email distribution — first probe Dynamics
   unresolved-recipient behavior and select the durable distribution-attempt
   representation.
2. Site Visit logistics and governed supporting-file dossier — map current
   Dataverse facts before proposing schema.
3. AkoyaGo publication projection — complete signed-in AkoyaGo, historical
   filename/path, Power Automate, and non-governed SharePoint discovery before
   selecting a storage or filename contract.
4. Final Writeup copy transaction — follows guarded reopen; freeze and copy an
   exact Site Visit-stage source version/hash into a new governed Final item.
5. `NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion — reopen only
   with a coordinated session-invalidation window.
6. Reviewer multipart direct-upload conversion — complete consumer discovery
   and obtain an owner decision first.
7. Stage III institution identity authority — blocked until the execution-point
   contract exists.

### Verify Before Acting

1. Request `1002379` now points to guarded-reopen successor
   `888982b6-0a9f-f111-b8dc-7ced8d3d15a6` in Ready/Draft. Do not regenerate it
   or start another Site Visit handoff without a new exact durable-write
   approval; the preserved prior Review row is Superseded and remains audit
   evidence.
2. The template-v3 Word Online and latest warning-bearing generation paths do
   not have complete signed-in smoke coverage. The promoted Request `1002379`
   cannot supply that evidence without a successor/reopen or another approved
   request.
3. Production Dataverse reads are owner-run. Never set
   `DATAVERSE_ALLOW_PROD_READS` yourself.
4. The memory drift report was older than 24 hours at the routine audit. Run
   owner-only live regeneration only when a current claim actually requires it.
5. `dynamics_query_log.record_count` rows before 2026-08-08 have broken
   semantics; never trend across that boundary.
6. The 2026-08-23 inventory found `pre-site-visit.proposal-core.generate` v5
   (`3d76ee40-5e9b-f111-b8db-70a8a5ae4225`) current on `claude-sonnet-5`,
   published 2026-08-18, while several durable prompt-governance surfaces still
   say v4 is sole-current. Treat that as a separate prompt-governance drift
   audit before any new generation claim; this guarded-reopen proof copied
   preserved bytes and made no model call.

### Do Not Reopen Without New Decision

1. Automatic email on Site Visit promotion — the owner chose explicit preview
   and send of a frozen informational PDF.
2. Editing or reopening the preserved Review row in place — correction uses a
   separately audited Draft successor.
3. Treating an AkoyaGo-visible publication as a second editable source of truth.
4. Asker-profile-based program biasing in Dynamics Explorer or raising
   `MAX_TOOL_ROUNDS` without new post-telemetry evidence.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Current lifecycle truth, correction/email/publication contracts, and implementation order |
| `shared/components/workbench/SiteVisitTab.js` | Site Visit handoff action and same-item workspace UI |
| `shared/components/workbench/PreSiteVisitTab.js` | Draft controls and promoted-state read-only receipt |
| `pages/api/workbench/pre-site-visit/start-site-visit.js` | Authenticated exact-body handoff route |
| `lib/services/pre-site-visit/site-visit-transition-service.js` | Draft→Review transaction and exact post-write reread |
| `lib/services/pre-site-visit/reopen-service.js` | Production-proved preserve-and-succeed service; Request `1002379` verified one successor/copy and exact retry reuse |
| `lib/dataverse/schema/wave20-guarded-reopen/wmkf_requestdocument_guarded_reopen.json` | Production-live additive guarded-reopen audit fields; 3 exact/0 divergent on 2026-08-23 |
| `scripts/preflight-guarded-reopen-schema.mjs` | Read-only Wave 20 metadata classifier plus local self-test |
| `docs/MEMORY_HYGIENE_RUNBOOK.md` | Canonical routine/deep audit and router-diet procedure |
| `docs/audits/memory-routine-audit-2026-08-21.md` | First audit evidence, dispositions, and metrics |
| `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md` | Built warning/advisory architecture and constraints |

## Testing and Operational Evidence

- Workbench receipt: focused component suite 23/23, Webpack production build,
  two read-only Claude Opus reviews with APPROVE, Ready deployment
  `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi`, and signed-in Request `1002379` receipt →
  Site Visit same-item smoke.
- Memory merge/audit: every handoff-prescribed memory-router, hook, instruction,
  docs, fact, symbol, type, claim-freshness, framing, currency, and clean-diff
  gate passed sequentially. The router self-test passed 19/19 with existing
  advisory MaxListeners warnings.
- Guarded reopen branch: seven focused service, route, artifact, and component
  suites pass 101/101; TypeScript and scoped ESLint pass. The production Webpack
  build and relevant API-route, lifecycle/auth, route/service, DAL/context,
  GUID, status, Atlas, documentation, fact, currency, and invariant gates pass.
  The final independent Claude Opus acceptance review returned APPROVE with no
  actionable findings. Production deployment
  `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp` is Ready; signed-in Request `1002788`
  exercised the read-only extended status projection without writes. After
  exact approval, signed-in Request `1002379` created one preserved-successor
  cycle; authoritative Dataverse/Graph readback and an unchanged service retry
  proved one row/item, exact copied bytes, pointer coherence, and reuse.
- Stop-time claim-evidence pilot: local observation state was unavailable, so no
  observation row was added and no advisory classification was invented.
