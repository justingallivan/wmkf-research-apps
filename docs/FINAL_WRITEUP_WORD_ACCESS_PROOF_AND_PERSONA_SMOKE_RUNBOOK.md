---
title: Final Writeup Word Access Proof and Persona Smoke Runbook
domain: workbench
kind: runbook
status: active
summary: "Representative PC/Leadership Word-access proof gating persona enablement, plus the exact enabled-persona smoke sequence and evidence records."
canonical: false
cataloged: 2026-09-01
last_verified: 2026-09-01
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
---

# Final Writeup Word Access Proof and Persona Smoke Runbook

## Purpose and gating

This runbook executes Slice E of
`docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md`. Two gates order this work
strictly:

1. **Access proof first.** A representative Program Coordinator and a
   representative Leadership user must each open the canonical Final Writeup
   Word item through the signed-in Production experience, and both results
   must be recorded PASS in this document.
2. **Explicit owner authorization second.** The tracked persona source flag
   (`FINAL_WRITEUP_PERSONA_LENSES_ENABLED` in
   `shared/config/finalWriteupPersonas.js`) stays `false`, and no deploy,
   Dataverse write, or Production change occurs, until Justin explicitly
   authorizes enablement after both proofs pass.

The proof-before-enablement order is functional, not merely cautious.
**[VERIFIED via `lib/services/final-writeup/dashboard-service.js`
(`lifecycleStage`, `visibleToPersona`)]** the enabled Leadership lens shows
only rows whose current Final document is in the `FINAL` lifecycle state, and
the **Ready for leadership review** transition that produces that state is an
unshipped Slice 4 item. With the flag enabled today, a Leadership-only viewer
is expected to see an empty dashboard and would have no in-app path to the
Word item at all. With the flag disabled, `visibleToPersona` returns every row
to every enabled reviewer-role member, so both representatives can complete
the proof now with zero configuration or code change.

## Canonical proof target

- Request `1002788` holds the current Production Final Writeup row and its
  single canonical SharePoint Word item (the same drive item Staff
  Deliberations handed off; see
  `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`).
- The proof criterion is SharePoint-level: the Word document itself must open
  and render content in the representative's own signed-in Microsoft session.
  The Workbench rendering a link is **not** proof — the implementation plan's
  rule is explicit: do not equate an app link with file permission.

## Representative users

| Persona | Representative | Rationale |
|---|---|---|
| Program Coordinator | Duncan Spore (default; Connor Noda is equally representative) | Owner-confirmed PC responsibility. Duncan's 2026-08-31 acknowledgement of `1002788` does not count as Word-access proof unless the record below confirms the document actually opened for him. |
| Leadership | Allison Keller (President) | Leadership-only assignment gives a clean single-lens proof. Beth Pruitt's deliberate PD + Leadership overlap is exercised later in the enabled smoke, not here. |

## Access proof procedure (flag remains false)

Each representative, independently, in their own signed-in Production session:

1. Sign into the Production Workbench with their ordinary account.
2. Open the **Final Writeups** dashboard.
3. Locate Request `1002788` and open its focused review page (**Open
   review**).
4. Click **Open in Word**. The document opens in a separate browser tab (or
   desktop Word via Microsoft's own affordance).
5. Confirm the Word document actually loads its content, and note whether
   SharePoint granted edit or view access.
6. Report the result (or the exact SharePoint error text on denial) to
   Justin. No screenshot or transcription of document content — page chrome
   or error text only.

### Draft coordination messages for Justin to send

> **To the PC representative (Duncan or Connor):** "Quick 2-minute check for
> the Final Writeup rollout: sign into the Workbench as usual, open the Final
> Writeups dashboard, open the review page for request 1002788, and click
> *Open in Word*. Let me know whether the Word document itself opens for you
> (and whether you can edit or only view), or send me the exact error message
> if it doesn't. Please don't forward the document."

> **To Allison:** "Before we turn on the leadership view of Final Writeups, I
> need to confirm SharePoint access works for you. Could you sign into the
> Workbench, open the Final Writeups dashboard, open request 1002788, and
> click *Open in Word*? I just need to know whether the document opens (edit
> or view), or the exact error if it doesn't."

### Access proof evidence record

Fill in when each proof completes. Record no document contents.

| Field | PC proof | Leadership proof |
|---|---|---|
| Date/time (UTC) | _pending_ | _pending_ |
| User | _pending_ | _pending_ |
| Request number | `1002788` | `1002788` |
| Entry path (dashboard → focused page) reached | _pending_ | _pending_ |
| Action clicked | Open review → Open in Word | Open review → Open in Word |
| Word document opened with content (yes/no) | _pending_ | _pending_ |
| Access level observed (edit/view) | _pending_ | _pending_ |
| Exact SharePoint error text, if denied | _pending_ | _pending_ |
| Result | _PENDING_ | _PENDING_ |

**Failure handling:** a SharePoint denial is a permissions problem outside the
application. Stop, record the exact error, resolve the SharePoint permission
through the normal Microsoft admin path, and re-run that representative's
proof. Do not work around a denial by changing application code, roles, or
the flag.

## Enablement gate checklist (all required, in order)

1. Both rows above record **PASS**.
2. Justin explicitly authorizes enabling the persona lenses and the deploy.
3. Flip `FINAL_WRITEUP_PERSONA_LENSES_ENABLED` to `true` in a reviewed commit;
   run the focused Final Writeup service/dashboard/route/component tests and
   the relevant red gates.
4. Deploy deliberately per
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (this is runtime
   behavior, not Tier 0) and confirm the deployment is Ready.
5. Run the smoke sequence below and record every leg before declaring
   rollout complete.

**Rollback:** flip the flag back to `false` and redeploy. The v2 `programs`
configuration keeps powering the existing matrix. Never promote a pre-v2
build while v2 is stored; the full downgrade order lives in
`docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md`.

## Enabled-persona smoke sequence

Use only non-sensitive requests; record request numbers, viewer, expected vs
observed rows, and console state — never document contents.

**Step 0 — denominator.** Before any persona read, a superuser records the
complete current Final row census from the dashboard: every request number
and its stage (`Group review` or `Leadership review`). Every later leg is
judged against this set. **[ASSUMED — confirm in Step 0]** the census is one
row, `1002788`, in `Group review`, and zero leadership-stage rows, because the
REVIEW→FINAL transition is unshipped.

**Step 0b — staffing readback.** A superuser opens Admin → Workflows → Final
Writeup staffing and records (counts only): assignments per persona, overlap
rows, unassigned rows (expected 0), stale rows (expected 0), and whether any
explicit **No persona lens** (empty-role) row exists. **[ASSUMED — confirm
via this readback]** no empty-role row is currently published.

| Leg | Viewer | Expected result (PASS criterion) |
|---|---|---|
| 1. PD-only | A PD-only assignee (e.g., John Sader) | Sees exactly the group-review rows plus any of their own responsible-PD rows from the Step 0 census; `Open review` and Word action present; no error. |
| 2. PC | Duncan Spore or Connor Noda | Sees all active rows and the complete neutral coordinator matrix (nine-column Research matrix on `1002788`); no approval/compliance semantics. |
| 3. Leadership-only | Allison Keller | **An empty dashboard with a clean empty state is the PASS criterion** while zero leadership-stage rows exist. Any error, or any visible group-review row, is a FAIL. |
| 4. Overlap | Beth Pruitt (PD + Leadership) | Union of lenses: with the assumed census this equals the PD set (group-review + her responsible-PD rows), each row exactly once; viewer personas report both roles. |
| 5a. Ineligible | An enabled, session-linked Dataverse staff user with app access but no `WMKF Final Writeup Reviewer` role | **[VERIFIED via `lib/services/final-writeup/persona-service.js` (`resolveFinalWriteupPersonas`) and `lib/services/final-writeup/dashboard-service.js` (`resolveViewer`, focused-row 404)]** the viewer resolves (only an enabled Dataverse user is required), receives zero personas with an `final_writeup_persona_viewer_ineligible` warning, and sees a dashboard with zero rows — an empty state, not an error page. A focused-row URL returns the 404-shaped "No current Final Writeup was found" response. A session with no linked enabled systemuser instead gets the 403-shaped viewer error; that is also fail-closed but is a different, acceptable observation — record which one occurred. Note this leg is only meaningful flag-on: flag-off, the same ineligible staff user sees all rows by design. |
| 5b. Explicit no-lens (conditional) | A published empty-role reviewer | Only if Step 0b found an empty-role row. If none exists, this leg requires a separately Justin-authorized temporary publish of one empty-role row plus an immediate authorized revert — otherwise record it **DEFERRED: no no-lens row published** rather than skipping silently. Expected: roster membership but zero persona rows visible. |
| 6. Superuser | Justin | Complete operational view unchanged and independent of persona assignment, including the full coordinator matrix. |

**Every leg also records:** zero application console errors, and no Dataverse
team read, create, membership, or role-management call (the team prototype is
removed from source; treat any such call as a FAIL).

### Smoke evidence record

| Leg | Date/time (UTC) | Viewer | Observed vs expected | Console clean | Result |
|---|---|---|---|---|---|
| 0 census | | | | | |
| 0b staffing | | | | | |
| 1 PD | | | | | |
| 2 PC | | | | | |
| 3 Leadership | | | | | |
| 4 Overlap | | | | | |
| 5a Ineligible | | | | | |
| 5b No-lens | | | | | |
| 6 Superuser | | | | | |

## Explicitly out of scope for this runbook

- Any Dataverse write, team operation, or SharePoint permission change.
- Enabling PC backup advancement or the leadership REVIEW→FINAL transition
  (Slice 4 of the implementation plan).
- Any metered or credit-consuming review product.
