# Session 412 Prompt: Awardee tab restructured and production-verified; close-out parked

> **Handoff, 2026-08-09 (Session 411).** Nine commits, all merged to `main` and
> deployed (plus this handoff commit). Two red-state cleanups at the top (dependency CVEs, a red
> unit suite on `main`), then an owner-driven rebuild of the Workbench Awardee
> tab that was verified by live production testing — which found four defects
> that unit tests structurally could not: two cosmetic (receipt placement, modal
> size) and two substantive, both detailed below. The grantee close-out tab was designed,
> then parked by the owner.

## Session 411 Summary

### What Was Completed

1. **All dependency vulnerabilities cleared** (`7662a12d`). Four advisory
   groups, not the three Dependabot reported — `js-yaml` and the `nanoid` 3.x
   range were `npm audit`-only. The `postcss` alert was self-inflicted: the
   `next.postcss` override from `c325afd5` had inverted into a *downgrade* once
   next began pinning a patched version, so it was removed rather than re-pinned.
   `gh api .../dependabot/alerts` now returns **0 open**.

2. **`main`'s unit suite was red and nobody knew** (`3e679eed`). `b9f023ef`
   ("Compose legacy + staged institution checkers") landed earlier the same day
   and left a `toHaveBeenCalledTimes(1)` assertion behind after making the seam
   run two arms. Runtime behavior was correct; only the assertion was stale. It
   surfaced only because the full suite was run while verifying unrelated
   dependency bumps.

3. **Awardee tab split into Invitation / Submission panes** (`5566b68c`).
   Persistent status header (status, invite date, reminder date, derived
   response estimate, days overdue), a `pending` / `✓ received` badge so "did
   they respond?" costs no click, and a real empty state where silence used to
   be. `invitedAt`/`remindedAt` added to the abstract GET — both were already in
   `DELIVERABLE_SELECT`, so this exposed existing reads.

4. **Two Codex adversarial-review findings fixed** (`42178c6e`). A missing
   post-send reload (every first send rendered `Status: Invited` above `Not yet
   invited`) and an unguarded same-request load race that could land stale and
   permanently latch the wrong pane. Also **retracted an overclaim of mine** —
   "the page cannot contradict what the grantee was told" was false and is gone
   from code, UI copy, and docs.

5. **Inline image, production-verified** (`a6a9b4fc`). New
   `GET /api/workbench/grantee-deliverables/image`, staff-guarded. Supersedes
   the spec's "Rejected alternative: proxy the image through the app". Verified
   against **real SharePoint bytes** in the owner's rehearsal.

6. **Send confirm modal** (`6b7a4d9d`), then **gated and resized**
   (`d3c0ab4f`), then **regeneration refused post-submission** (`31d33344`).
   See "Found only by production testing" below.

7. **Close-out tab designed and parked** (`3a5a1f9f`). Owner asked to park; the
   item is recorded below with its unanswered questions.

### Found only by production testing (read this before the next UI change)

Unit-green merges shipped four defects that owner clicking found immediately.
Recorded as `.claude-memory/feedback-ui-gates-must-mirror-server-guards.md`:

- **Send button ignored status.** `send-invite-service.js:85` refuses
  `status >= SUBMITTED`; `canSend` never consulted status. Having just moved the
  send behind a confirm modal made it *worse* — a full dialog, then a guaranteed
  409.
- **Regenerate had no server guard at all.** On a submitted package it would
  burn a paid LLM call and overwrite `wmkf_abstractformatted` (the historical
  draft — what was actually sent) while the published text is
  `wmkf_abstractapproved`, which that path never touches. Nothing visible would
  change: silent loss of the "what we sent vs what they approved" record. Fixed
  at **both** layers.
- The counter-instance worth copying: **Save edits gets this right** —
  `abstract-service.js` computes `editable` server-side and returns it, so the
  client never re-derives the rule.

### Commits (all pushed; each production deploy verified Ready)

- `3e679eed` — Pin the two-arm institution checker at the enrichment seam
- `7662a12d` — Clear all Dependabot and npm-audit vulnerabilities
- `5566b68c` — Split the Awardee tab into Invitation and Submission panes
- `42178c6e` — Fix two adversarial-review findings on the Awardee tab split
- `a6a9b4fc` — Render the grantee award image inline on the Awardee tab
- `6b7a4d9d` — Put the grantee invitation send behind a confirm modal
- `d3c0ab4f` — Gate the send button on status; enlarge the confirm modal
- `31d33344` — Refuse abstract regeneration once the grantee has returned it
- `3a5a1f9f` — Log the Awardee close-out tab as a next-session item

Unit suite **7037 → 7124**.

## Next Items

### Verified Open

1. **Awardee close-out tab** — owner-parked 2026-08-09, resume on request.
   Evidence: `docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md`; no writer exists for
   `Staff Review` / `Revision Requested` / `Complete` / `Closed No Response`
   `[VERIFIED 2026-08-09 by enumerating every write of wmkf_deliverablestatus —
   six sites covering only DRAFTED, INVITED, REMINDER_SENT, SUBMITTED]`.
   - **Layout half (Tier 1):** move `Deliverable outputs` out of the shared
     footer into a third pane. Note the two outputs have **different scopes**
     `[VERIFIED via cycle-export-service.js:13]` — "Copy website HTML" is
     per-award, "Cycle export" is the whole board cycle (~12–24 awards, the
     source comment's figure, not a measured count).
   - **Actions half (Tier 2, Dataverse writes):** blocked on the two owner
     questions under "Owner Decision Needed" below. Do not invent answers.

2. **Workbench version history, administrator restore, milestone snapshots.**
   Evidence: `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` evidence
   matrix row "Workbench history/restore and milestone freeze" — PLANNED, no
   producer. Unchanged this session. Design against Connor's answers.

### Blocked — Waiting On External Response

1. **Initial Assessment pilot: administrative evidence.** Evidence:
   `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` §"Required
   follow-up" item 5; brief at `outputs/sharepoint-admin-check-brief.md`
   (untracked), emailed to Connor 2026-08-09. Four read-only checks. **When
   answers arrive:** record as verified evidence in the pilot report. Do not
   treat silence as a pass. No response as of session end.

### Owner Decision Needed

1. **What `Complete` means for a grantee deliverable.** Bookkeeping only, or
   does it gate what the cycle export / website HTML publish? The second option
   changes the behavior of existing outputs. Blocks the close-out build.
2. **Whether close-out includes `Revision Requested`.** It re-opens the portal
   to the grantee. If yes: does the transition re-mint a magic link and email
   them, or does staff re-send manually? Tokens are 30-day, minted per send
   `[VERIFIED via grantee-token-lifecycle.js:26]`. Blocks the close-out build.
3. **Per-send deadline override divergence.** Evidence:
   `render-emails-service.js:271` and `send-emails-service.js:916`. An override
   on an already-dated request emails a date the portal can never show. Options:
   keep request date authoritative as staff practice, or persist overrides
   unconditionally (behavior change). Unchanged this session.
4. **Residual Reviews-surface duplication.** Evidence: `ReviewsTab.js`,
   `review-report-docx.js`. Owner said "looks good for now" — drop only on
   explicit request. Unchanged this session.
5. **Whether the cycle measurement tool gets live evidence re-discovery.**
   Evidence: `benchmarks/institution-pair-consistency/results/cycle-measure-d26-full-2026-08-09.json`
   (249 in scope → 0 with evidence anchors). Justin said he would test further.
6. **Whether `DEVELOPMENT_LOG.md` is revived or formally retired.** Evidence:
   file tail "Last Updated: May 14, 2026"; S409, S410, and S411 added no entries
   by design.
7. **Whether the "August 10 gate" is a live external commitment.** Evidence:
   `docs/CURRENT_WORK_QUEUE.md` item 1 (`last_verified` 2026-07-30); the pilot
   report does not name that date. **It is tomorrow as of this handoff
   (2026-08-09) and still unconfirmed** — raise it early, and confirm with the
   owner before treating it as missed or met.

### Parked

1. **Stage 2 typed institution relationships.** Evidence:
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` stop-rules. Re-open
   trigger: a named owner decision, not accumulated findings.
2. **Retired-table operational scripts** (25 non-archive scripts referencing
   dropped `reviewer_suggestions` — count inherited, **re-derive before
   acting**). Needs owner-approved scope + caller review.

### Verify Before Acting

1. **Request `1002788` is NOT clean.** The spec's "Cleanup is verified, not
   assumed" paragraph describes the 2026-07-30 state and is explicitly marked
   superseded. It now holds a **live submitted package** — approved abstract,
   caption "Homer in a blimp", and an image in `Grantee_Uploads` — deliberately
   left as the fixture that proved the inline-image path. It is stuck at
   `Submitted` with no in-app path forward. Re-cleaning is manual: delete the
   `wmkf_granteedeliverable` row, clear `wmkf_abstractapproved`, remove the
   SharePoint file.
2. **Any claim the enrichment path is "frozen"/"behavior-identical".**
   Superseded as of `c632a90f`; read the Wave 6 section of the plan doc.
3. **Production resolver authority.** Still `legacy-default`; verify live
   configuration before claiming otherwise.
4. **Portal deadline correctness for the ZZTEST request.** The portal shows the
   stored `wmkf_reviewduedate` (Sep 9, 2026 for the test copy). If staff
   expected Aug 12, the request record needs correcting — data, not rendering.

### Do Not Reopen Without New Decision

1. **ROR strategic reset** — closed in S409. Re-opening requires an
   institution-resolution-bound benchmark.
2. **Institution checker / enrichment seam iteration** — two owner stop-rules
   (2026-08-09). Findings freeze-and-document to Stage 2.
3. **Promotion via the S408 15-row diagnostic** — compares different contracts;
   not a promotion gate.
4. **S328 post-submit downloads / separate Ratings table / picklist-free card
   details** — superseded by owner decisions 2026-08-09 (S410).
5. **"Reject the image proxy for v1"** — superseded by owner decision
   2026-08-09 (S411). The proxy is built, merged, and verified against real
   SharePoint bytes.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/AwardeeTab.js` | Two panes, status header, send confirm modal, inline image. The session's main surface |
| `lib/services/workbench/grantee-deliverables/image-service.js` | Streams the grantee image; filename allowlist is the trust boundary |
| `pages/api/workbench/grantee-deliverables/image.js` | Staff-guarded binary route; private-material egress |
| `lib/services/workbench/grantee-deliverables/generate-service.js` | Regenerate now refused at status >= Submitted |
| `lib/services/workbench/grantee-deliverables/send-invite-service.js` | The status guard (`:85`) the UI must mirror |
| `lib/services/grantee-upload.js` | Exports `granteeUploadFolder` — one definition shared by writer and reader |
| `docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md` | Two S411 follow-up sections + the superseded-cleanup notice |
| `.claude-memory/feedback-ui-gates-must-mirror-server-guards.md` | The session's durable lesson |

## Testing

```bash
# Awardee tab + grantee deliverables focused suites (all green at session end)
npx jest tests/unit/awardee-tab.test.js \
  tests/unit/grantee-image-service.test.js \
  tests/unit/grantee-deliverables-image-route.test.js \
  tests/unit/grantee-generate-workbench-service.test.js \
  tests/unit/grantee-abstract-workbench-service.test.js \
  tests/unit/grantee-deliverables-abstract-route.test.js --runTestsByPath

npx jest tests/unit          # 7124/7124 at session end
npm run check:types
npm run build                # Turbopack; verify the /api/.../image route appears
```
