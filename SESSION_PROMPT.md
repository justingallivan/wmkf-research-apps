# Session 257 Prompt: Reviewer "hold step" — scoping done, build next

> **GIT.** All S256 work is on `main`. Working tree clean. 5 commits (all docs/memory — no code).
> Verify push state at startup.

## Session 256 — what happened

A planning/calibration session, no code. Three threads, all landed in durable docs + memory:

1. **Stopped startup summaries from resurfacing parked items (`ec115a5`).** "Do NOT resurface" now
   means *omit from any unprompted output, including `/start`'s Potential Next Steps* — I'd been
   echoing the parked PubPeer item, the exact attention-pull the flag exists to prevent. New memory
   `feedback-dont-resurface-parked-items`; relocated PubPeer into a fenced "Parked — do NOT surface"
   section the next `/start` skips.

2. **Re-led the workbench with the reviewer mission (`717ec5f`).** Potential Next Steps had drifted
   into externally-blocked micro-todos with the actual cycle mission absent. Promoted **reviewer
   finding → validation → invitation, end to end** to the headline; demoted the blocked items into a
   "do NOT lead with these" bucket.

3. **Reviewer "hold step" cycle plan — confirmed + scoped (`0d00bb0`, `bff67f3`, `bf88e01`).** The
   main thread. Justin's goal: park a confirmed slate of reviewers BEFORE Phase II proposals arrive,
   deferring COI/AI acks + payment + proposal delivery to a later finalize. Did a full caller →
   persistence → consumer trace of the external-reviewer accept flow and produced a concrete design
   (below). Full design + code findings: memory **`project-reviewer-hold-step-decouple`**.

### Commits (this session)
`ec115a5` parked-item resurfacing fix · `717ec5f` workbench leads with mission · `0d00bb0` hold-step
plan captured · `bff67f3` readiness trigger resolved · `bf88e01` readiness model corrected.

## Potential Next Steps

### ★ CYCLE OBJECTIVE — park a confirmed reviewer slate before Phase II (the "hold" step)
Main thread; lead with it. Full plan + code findings: memory `project-reviewer-hold-step-decouple`.

**The plan (confirmed S256):** build a **pre-accept "hold/soft-confirm" step** so the flow is
find → validate → invite → **hold** → calendar invite → park. A reviewer agrees in principle now,
sits tight, is told when proposals land. **Defer** COI/AI acks + honorarium payment + proposal
delivery to a later "finalize."

**Why a build, not a run (verified S256):** the current Stage-2a accept
(`pages/api/external/review/[token]/respond.js`) hard-requires BOTH policy acks (`reviewer-coi` +
`reviewer-ai-use`) AND a full payment contact at accept time, and runs honorarium onboarding — there
is no confirm-without-commitment path today. The hold step is the gap; it also keeps the Connor-gated
honorarium/Bill.com prod automation (`project-reviewer-accept-prod-automation`) from firing this cycle
(hold never sets `wmkf_accepted` and never calls `ensureHonorariumOnboarding`).

**Design (from the S256 trace):**
- **Hold = a new `wmkf_responsetype` value `held (100000004)` + `wmkf_heldat`** — NOT `reviewstatus`
  (staff pipeline), NOT `wmkf_accepted` (reserved for finalize; honorarium + Review-Manager key off
  it). Adding the option = the known idempotent picklist-extend (`scripts/extend-responsetype-picklist.mjs`).
- **Finalize = the existing accept path, unchanged.** `held → accepted` is just
  `applyStage2aResponse('accept')`; the state machine already supports "unresponded → accepted."
- **Merge-forward:** in steady state hold→finalize run back-to-back through a short staff-QA window
  (the gap shrinks but never hits zero). Permanent infrastructure, not scaffolding.

**Readiness trigger (resolved S256):** gate finalize behind a single `isProposalReadyForReviewers(request)`
predicate. **"Phase II submitted" ≠ "ready to send" —** staff run a QA pass (figures render? shareable?)
between receipt and release that Justin expects to persist, so readiness = the staff **"release to
reviewers" after QA**, most likely a PERMANENT staff control. `wmkf_phaseiisubmittedat` (written by
`shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`) marks RECEIPT / a precondition, not
readiness. **Justin todo (w/ Connor):** identify the post-QA staff-release signal (or confirm we add an
explicit "release to reviewers" control) — NOT a blocker; the predicate localizes it.

**Open lever:** **ICS calendar invite** is net-new (no calendar mechanism exists anywhere in the repo).
Belongs at hold-confirmation time (review window / `wmkf_meetingdate`). Decide build-now vs ship hold +
"save-the-date" email body as a fast-follow.

**Next concrete step (where we stopped):** Justin tired, paused before building. Resume order agreed:
1. **Spike the one real unknown first** — confirm the Graph email send path (`send-emails.js` → Graph)
   can attach an `.ics`. Cheap; settles whether the calendar piece needs a fallback.
2. **Write a `docs/` build plan** with per-chunk acceptance criteria, then run **`/contract-reconcile`**
   before any code (cross-layer + schema + state-machine surface).

Rough chunk list: (1) schema `held` + `wmkf_heldat`; (2) `isProposalReadyForReviewers` predicate +
readiness-gated view dispatch in `context.js::computeEngagementState`; (3) `respond.js` `action:'hold'`
(no acks/payment, never honorarium); (4) HoldView portal component; (5) `.ics` (spike → build or
fallback); (6) invitation-email copy + a "proposals ready" finalize-trigger email; (7) tests incl.
automation-safety (hold fires no honorarium).

### Deferred / externally-blocked (do NOT lead with these; verify before acting)
- Recall padding-ceiling live check before raising count >15 (needs API key + a real proposal).
- SerpAPI Hobby-tier downgrade eval (Justin, out-of-repo billing dashboard).
- `score-candidates` prod prompt reseed — only if you edit its template (unchanged since S254).
- `affiliationHistory` producers — COI-inert dead code, deferred (`project-deferred-code-cleanup`).

## Parked — do NOT surface in startup summaries
> User-recall-only. Do not echo into `/start`'s Potential Next Steps or any unprompted output; act
> only when the named un-park trigger fires. See `feedback-dont-resurface-parked-items`.
- **PubPeer migration off SerpAPI** — contingent on a sanctioned-API reply from PubPeer (Justin
  emailed them S251; suspects no reply). Context + un-park trigger:
  `docs/agent-wiki/topics/integrity-screener.md` and `project-serpapi-capability-erosion`.

## ⚠ Continuity guardrails (still live from prior sessions)
- **COI Chunk 2 fully shipped (2a S240 + 2b S254).** `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` is
  HISTORICAL. Current COI policy: `project-reviewer-coi-rely-on-self-disclosure`; live gates:
  `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`.
- **`POTENTIAL_CONCERNS` parser terminator is intentional** (`parseAnalysisResponse` parse-and-discards
  a stray field). Do NOT remove unless certain no prompt can still emit it.
- Memory router stays **hub-link form**; `grep`/`rg` may corrupt identifiers+digits
  (`project-rtk-grep-output-corruption`) — use Read for exact content.

## Key Files Reference (hold-step build)

| File | Purpose |
|------|---------|
| `pages/api/external/review/[token]/respond.js` | accept/decline handler — add `action:'hold'`; today hard-requires acks+payment |
| `pages/api/external/review/[token]/context.js` | `computeEngagementState` view dispatch — add readiness-gated hold/finalize routing |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `applyStage2aResponse` + `RESPONSE_TYPE_MAP`/`REVIEW_STATUS_MAP` — add `held` |
| `scripts/extend-responsetype-picklist.mjs` | template for the idempotent `held=100000004` picklist add |
| `pages/api/review-manager/send-emails.js` | invitation email + `wmkf_invited` (templateType='invitation') |
| `shared/forms/phase-ii-research-2026-06/map-to-dynamics.js` | writes `wmkf_phaseiisubmittedat` (readiness precondition) |
| `shared/components/external/Stage2aView.js` | the full finalize form; HoldView is its lightweight sibling |
| `project-reviewer-hold-step-decouple` (memory) | full design, decisions, open items |

## Testing
```bash
npx jest --testPathPatterns "reviewer|external|respond"   # reviewer + external-portal suites
npm test && npm run lint && npm run build                 # full suite (was 2384 green at S254)
```
