# Session 284 Prompt: Finalize AI/COI acknowledgement copy, then reviewer-portal walkthrough

## Session 283 Summary

A short, no-code grounding session on `main`. Started green on CI (ran the full
`check:*` gate set + self-tests per `/start`; all passed, no P0 blockers). The session's value was **correcting a stale
mental model** before any build: the reviewer review-upload flow Justin thought
still needed building is **already built and live in prod**. No commits.

### What happened

Justin set up the next-session plan: (1) finalize the AI + COI acknowledgement
TEXT, then (2) "work on the reviewer portal — how reviews get uploaded; create
forms and fields in Dataverse." Before planning #2, probed the live surface and
found it substantially already shipped. Justin confirmed the corrected footing
("good base") and deferred both items to next session.

**Ground truth established this session (review-upload is LIVE, not greenfield):**
- **Reviewer-facing upload form** — `shared/components/external/MaterialsView.js` +
  `ReviewFormFields.js` render the review form (download proposal, fill structured
  fields, upload 1–5 files PDF/DOCX ≤25 MB). Submits to
  `pages/api/external/review/[token]/upload.js` → `lib/services/review-upload.js::writeReviewFiles()`
  → SharePoint + Dataverse PATCH. Token-authed, virus-scanned, magic-byte-validated.
  [VERIFIED — read `upload.js` directly]
- **Dataverse fields already provisioned** (prod 2026-05-03) on
  `wmkf_appreviewersuggestion`: `wmkf_reviewerimpact` (Q1), `wmkf_reviewerrisk` (Q3),
  `wmkf_revieweroverallrating` (Q10), `wmkf_revieweraffiliation`,
  `wmkf_reviewsharepointfolder`, `wmkf_reviewfilename`, `wmkf_reviewreceivedat`,
  `wmkf_reviewuploadedbystaff`. Schema-as-code:
  `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json`.
- **Staff readback** — `shared/components/workbench/ReviewsTab.js` decodes ratings +
  download link; `/api/review-manager/reviewers.js` projects the fields.
- **The 3-rating shape is DELIBERATE, not a gap.** `lib/external/review-form-schema.js:11-18`
  [VERIFIED — read directly]: the PDF review template has 11 questions; only Q1/Q3/Q10
  are single-select multiple-choice (reviewers mis-check them in the PDF), so those are
  captured as structured radio fields. Free-text questions (Q2, Q4–Q9, Q11) intentionally
  stay in the uploaded PDF — "no value in re-typing paragraphs of substantive analysis
  into a browser form." So "capture more questions as fields" is a design *decision* to
  raise with Justin, not an obvious oversight to fix.

### Commits
None this session (investigative / planning only).

## Potential Next Steps

> These are Justin's stated plan for next session, each checked against source this session.

### 1. Finalize the AI + COI acknowledgement TEXT — FIRST (owner content task) — VERIFIED placeholder
The two policy slots `reviewer-coi` + `reviewer-ai-use` are still **placeholder**
(owner-confirmed S282; consistent — Justin says he still needs to write them). Infra
confirmed live this session: `respond.js` requires both acks on a fresh accept
(`STAGE_2A_POLICY_SLOTS = ['reviewer-coi', 'reviewer-ai-use']`, `respond.js:54`,
returns 400 `policy_ack_required` if missing); admin editor
`shared/components/admin/PoliciesSection.js` → `pages/api/admin/policies.js` (superuser,
**versioned** publish, body ≥50 chars, bump label — NOT edit-in-place); shown to reviewers
via `lib/external/policy-fetcher.js` → `PolicyAckModal` in the Stage 2a accept flow.

**Two content decisions block drafting** (asked Justin S283, deferred to next session):
- **AI-use stance** — Foundation's position on reviewers using AI tools while reviewing:
  prohibit entirely / prohibit *upload of proposal content* but allow general assistance /
  allow with disclosure. (Confidentiality is the crux: proposals must not be pasted into
  external models.)
- **COI standard** — existing Foundation conflict-of-interest definition to encode, or draft
  a standard reviewer COI attestation (institutional / collaborator-within-N-years / financial /
  advisor-advisee) for Justin to trim.

Claude offered to draft both for Justin to edit + publish; Justin owns final wording and does
the Publish. Get the two decisions above first.

### 2. Reviewer-portal walkthrough — start from "good base," not build-from-scratch
Walk Justin through the existing live review-upload form + captured data (see Ground
truth above), then decide what (if anything) actually needs to change. The real open
*design* question, not a bug: **do we want more of the 11 questions captured as structured
Dataverse fields, or is "3 ratings + uploaded PDF" sufficient?** (Current shape is the
deliberate `review-form-schema.js` design.) If a change is wanted, that's the engineering
delta; otherwise this is a verify-and-confirm, not a build.

### 3. End-to-end test of the review flow with request 1002788 — ties to #2 and the parked cleanup
Request **1002788** is already flipped to **Advancing** (parked test data, see Gotchas) and is
the intended E2E vehicle: run a reviewer through accept → materials → upload on the live form,
confirm SharePoint write + Dataverse PATCH + ReviewsTab readback. This also clears S281's
blocked "Reviews tab live smoke" (needs real submitted review data). **NOTE the prod-automation
hazard before any real accept** (see Gotchas) — a real accept fires a live honorarium/Bill.com
chain; capture-only is currently locked via `HONORARIUM_ONBOARDING_DEFERRED=true`, but confirm
before exercising accept against prod.

### 4. Auto-on-award abstract cron — still unbuilt, OPTIONAL (not in Justin's stated plan)
An idempotent `pages/api/cron/*` route to pre-generate the publishable **abstract** for
research awardees (distinct from `generate-grantee-titles.js`, which handles the edited
*title* at the Phase I→II flip and defers abstract assembly). Mirror the title cron's
resilience shape. See `docs/GRANTEE_PORTAL_BUILD_PLAN.md` and
`project-phaseistatus-decision-lifecycle`. Carry-forward from S283 #1; lower priority than
1–3 above.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/external/review-form-schema.js` | Single source of truth for the review form's 4 structured fields (affiliation + Q1/Q3/Q10); header explains the deliberate 3-rating design |
| `pages/api/external/review/[token]/upload.js` | Token-authed reviewer upload endpoint (files + structured fields) — LIVE |
| `lib/services/review-upload.js` | `writeReviewFiles()` shared core: validate → SharePoint → Dataverse PATCH (self-serve + staff paths) |
| `pages/api/external/review/[token]/respond.js` | Stage 2a accept/decline; enforces `reviewer-coi` + `reviewer-ai-use` acks on fresh accept |
| `shared/components/external/MaterialsView.js` / `ReviewFormFields.js` | Reviewer-facing review form UI |
| `shared/components/workbench/ReviewsTab.js` | Staff readback of submitted ratings + download link |
| `shared/components/admin/PoliciesSection.js` / `pages/api/admin/policies.js` | Acknowledgement (COI/AI) admin editor — versioned publish |
| `lib/external/policy-fetcher.js` / `PolicyAckModal` | Serves active policy versions to the reviewer at accept |
| `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json` | Schema-as-code for the live review-capture columns |

## Gotchas / Continuity

- **Reviewer-portal review-upload is ALREADY BUILT/LIVE.** Do not re-plan it as greenfield
  (this session's correction). The wiki `docs/agent-wiki/topics/external-reviewer-portal.md`
  and `docs/REVIEWER_ENGAGEMENT_SPEC.md` already document it as shipped.
- **Prod-accept automation hazard:** a real reviewer accept CREATEs a honorarium `akoya_request`
  → AkoyaGo plugins + Bill.com payment + Business-Central sync. Capture-only is currently locked
  (`HONORARIUM_ONBOARDING_DEFERRED=true` set in prod; discriminator GUIDs unset), so no payment
  fires this cycle — but confirm before any prod accept test. See
  `project-reviewer-accept-prod-automation` + `project-reviewer-hold-step-decouple`.
- **Test data parked (OWED CLEANUP):** request **1002788** (D26, GUID
  `feabe26f-dc1b-f111-8341-000d3a306da2`) is flipped to **Advancing** to exercise reviewer flows.
  It's the intended E2E vehicle (#3) — **revert to Set-aside when done testing.**
- **Branch discipline (shared working dir):** one git driver at a time;
  `git status --short --branch` before any commit/checkout (concurrent Codex-app session shares
  the dir). See `feedback-verify-branch-before-git-action.md`.
- **Email copy live source is Dataverse**, not code (`wmkf_appsystemsettings` / `/admin → Email
  Defaults`); same versioned-not-edit-in-place pattern applies to the policy slots.
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only
  (testPathIgnore-excluded in CI). Confirm it's just those before chasing a "red" run.
- **Working preference:** Justin optimizes for first-time correctness over fix-later; upfront
  grounding/verification on starts/stops is wanted. `feedback-first-time-correctness-over-rework.md`.

## Testing

```bash
npm test                          # full suite (only the 2 known-red above should fail locally)
npm run lint
# Reviewer-portal E2E harness (mocked data layer, real build — NOT next dev):
npm run test:e2e
```
