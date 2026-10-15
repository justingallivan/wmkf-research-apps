---
title: Opus review of post-presentation writeup regeneration plan
domain: workbench
kind: audit
status: review-complete
summary: Independent read-only Claude Opus review; named plan changes remain open before implementation.
owner: product-engineering
last_verified: 2026-10-15
related:
  - docs/plans/POST_PRESENTATION_WRITEUP_REGENERATION_PLAN_2026-10-15.md
---

Review target: plan at commit `9b5b823a6`, branch `codex/writeup-regenerate`.
Owner requested Claude Opus through subscription OAuth, with no API credits.
The host authentication check reported `authMethod: claude.ai`, first-party Team subscription.
The CLI was invoked with `--model opus --effort high`, safe mode, no external MCP servers,
and only Read/Grep/Glob tools. API-key/auth-token/provider-override environment variables
were removed from the subprocess; no API credential or metered review product was used.
The CLI completed successfully. Its model usage names `claude-opus-5-5` and also
`claude-fable-5-1`; the latter's role is not identified in the result, so this receipt does
not claim an exclusively Opus execution. The reviewer reported no delegation.

The report below is the reviewer's source-based assessment, not implementation or runtime
proof. No plan or runtime changes were made in response yet. Findings remain open for
reconciliation before implementation; owner decisions remain pending.

---

# Review: `POST_PRESENTATION_WRITEUP_REGENERATION_PLAN_2026-10-15.md`

Verdict: **READY WITH NAMED CHANGES.** Nothing requires reworking the design: the cutoff, the paired-row transaction, and the decision not to reuse the reopen code directly all hold up against the source. But four specification gaps (findings 1–4) must be closed in the plan before implementation; they are not details to settle while coding. The owner still needs to approve plan items 1–3.

This was a read-only review. I made no edits and ran no tests, gates or delegation. Every claim below comes from reading the source.

## Findings, most severe first

**1. HIGH — Every regeneration after automatic preparation will show "Needs attention".**
- **Evidence:** the preparation status code at `lib/services/pre-site-visit/preparation-worker.js:438-440` and `:453-462`, and the list view at `lib/services/pre-site-visit/cycle-list-service.js:585-602`. Both compare the preparation receipt's document ID with the current Word row. When a "prepared" receipt points at a different row, the state becomes `blocked` with error `document_pointer_changed`.
- **Effect:** after a regeneration in post-visit drafting the receipt still names the old row. `StaffDeliberationsTab.js:1149` then hides the retry button and `:1161` shows "Needs attention".
- **Gap:** plan line 74 says not to regress the stepper but gives no mechanism. Neither file is in the bounded change list (lines 82–87).
- **Required change:** choose one of two approaches:
  - (a) rebind the receipt's document ID during regeneration. This is a Postgres write, so the preparation store joins the change list.
  - (b) have both status calculations treat a receipt whose document is a superseded predecessor of the current row as history.
- Add `preparation-worker.js` and `cycle-list-service.js` to the change list either way. Also say whether the group-review replacement row gets a milestone.

**2. MEDIUM-HIGH — Retry by operation ID and "frozen inputs" don't work with the current generator.**
- **Evidence:**
  - The generation key includes a fingerprint of the inputs (`artifact-model.js:240-259`), and the generator recomputes it from live data on every call (`artifact-service.js:108-134`). If reviews change between the first attempt and a retry, the key misses the original row and `:203-253` creates a new one, which plan line 54 forbids.
  - The input snapshot is only saved after the model runs (`artifact-service.js:301-308`).
  - `persistedDraft` treats a saved snapshot without saved model output as corruption (`artifact-model.js:536`), and requires the saved snapshot to equal the freshly loaded one (`:553-554`).
  - With unchanged inputs and no operation ID in the key, the lookup finds the current row itself (`:134`, `:175-178`).
- **Required change:** state the contract in the plan:
  - The regeneration key is built from the request, the expected old row(s) and the client operation ID, following the precedent in `pre-site-visit/reopen-service.js:516-525`. The input fingerprint stays on the row, not in the key.
  - A retry resumes using the row's own saved snapshot as the expected snapshot.
  - Say what happens if a crash occurs before the snapshot is saved: either fail closed and require a new operation ID, or save the snapshot at claim time and relax the check at `:536` for this mode only.

**3. MEDIUM — Storing the operation ID in `wmkf_reopencycleid` reaches more readers than the plan lists.**
- **Gap:** plan line 53 names only the correction DTO, the pending projection and `correctionInProgress`.
- **Other readers of that field:**
  - the activation check that the correction cycle matches (`artifact-lineage.js:227`)
  - the ordinary generator's key and create payload (`artifact-service.js:131`, `:237`)
  - the preparation "correction epoch" (`preparation-worker.js:129`, `:218`, `:533`)
  - the scheduler's automation check (`site-visit-transition-service.js:395`)
  - the list view (`cycle-list-service.js:615`)
  - `scripts/review-staff-deliberations-preparation-cohort.mjs:111`, which labels any current row with that field "correction in progress"
- **Required change:** either list and test every one of these readers, or (recommended) leave `wmkf_reopencycleid` empty for regeneration. Instead, identify regeneration rows with a distinct `wmkf_producer` value (reopen already does this: `shared/config/requestDocument.js:133`, `reopen-service.js:696`) and the operation-ID key from finding 2.

**4. MEDIUM — The email "wait" rule is undefined, and a skipped intent can't be revived.**
- **Evidence:**
  - The plan correctly spots that `final_from_other_draft` (`handoff-email-service.js:465-467`) would permanently skip a staged replacement notice on the next 15-minute run (`:624-632`).
  - The ledger only reopens skips with reason `transition_not_committed` (`handoff-email-store.js:26-37`, `:47-55`).
- **Effect:** if recovery skips a replacement notice for any other reason and a retry with the same operation ID later succeeds, the email is lost.
- **Required change:** specify the check. On a source mismatch, read the ledger's source row: if it is generating or ready but not yet current, release and wait; if it is superseded or proven abandoned, skip. Waiting or abandoned outcomes must use a skip reason the ledger can reopen, or the plan must accept the ledger SQL change and the Postgres integration test. After activation, call the existing reopen-and-deliver hook (`:609-621`).
- **Mitigating fact:** the email links to the Final tab, not to a file (`:536-537`), so an old notice already being delivered still lands on the current document.
- **Note:** the email subject and body come from the generic group-review settings (`:530-534`). Owner decision 3 must say whether the replacement notice reuses that copy or needs new setting keys. New keys would add files.

**5. MEDIUM — The "source edited" check at plan line 55 contradicts itself.**
- Line 55 says a detected edit to the old file requires refresh/reconfirmation. The same paragraph says late edits stay in the preserved file, and owner decision 1 says edits are never carried over.
- During group review colleagues edit continuously. If the comparison point is claim time, almost every group-review regeneration would be refused, and each reconfirmation would trigger a new model run.
- Regeneration never uses the old file's bytes. Reopen checks stability (`reopen-service.js:603-624`) because it copies bytes.
- **Required change:** name the comparison point (the version seen at confirmation or at claim). Either make a mismatch non-blocking (record the observed old version on the preserved row) or make reconfirmation keep the same operation and its frozen output, so no second model call is needed.

**6. LOW — Writer-gate constraints.**
- `check-request-document-writers.js:86` allows exactly one `dependencies.createDocument(` call per registered file.
- `:27-30` pins the exact Pre-Site policy expression, and the self-test fixture at `:216-220` must change with it. The new REQUIRED branch has to be a three-way expression at the single existing call.
- The only Final create call is `transition-service.js:117`, inside `startFinalWriteup`. "Prepare the successor without ordinary activation" therefore means extracting a preparation function within that file. The plan should say so.

**7. LOW — Route body and citation drift.**
- The POST currently rejects every key except `requestId` (`pages/api/workbench/pre-site-visit.js:142-147`). The "existing request fields" in plan line 50 exist on other routes, not this one. Say the allowlist is extended and the route test that asserts "only requestId" is updated.
- Fix two citations:
  - The Draft-only guard is at `artifact-service.js:91-104`, not `:65`.
  - The leadership step is at `transition-service.js:191`/`:298-326`, not `:182`.

**8. LOW — Previous-versions stage and group-review timestamp.**
- A superseded row loses its stage. The history DTO has to derive "group review" from a linked Final row with a group-review start time, so the plan should state that rule.
- The new Final's group-review start time (`wmkf_groupreviewstartedat`) resets what the list displays as the group-review start (`cycle-list-service.js:633`). The owner should accept that.

## Plan claims confirmed against source
- **Reopen can't be reused directly:** it checks the milestone version (`reopen-service.js:603-610`), copies bytes (`:686-715`), lands in Draft (`:909`) and refuses once a Final exists (`:244-249`).
- **The existing activation helper can't be reused for this:** it hard-codes Draft (`artifact-lineage.js:275`), refuses non-Draft current rows (`:218`), and supersedes every prior Ready row (`:248-266`).
- **The Final same-file rule exists:** `transition-model.js:205-206`.
- **The cutoff is enforceable:** the leadership step uses ETag fences (`transition-service.js:280-322`), and only REVIEW or completed FINAL Finals are accepted (`leadership-checkpoint.js:49-53`).
- **Sign-offs can't carry over:** acknowledgements are bound to one Final row and stale Finals are refused (`acknowledgement-service.js:148-152`, `:263-273`, `:576-582`).
- **The privacy gap is real:** SUPERSEDED rows bypass draft redaction (`writeup-visibility.js:22-25`, `:82-83`).
- **Ordinary staging refuses:** it returns `already_in_review` (`handoff-email-service.js:308-309`).
- **Pending regenerations stay visible to staff:** the pending row is only hidden when it has a reopen reason (`pre-site-visit.js:59`).
- **The warning-suppression issue is real:** `StaffDeliberationsTab.js:1146`.
- **The dashboard follows the pointer:** `dashboard-service.js:57`, `:513`.
- **The listed test files exist.**
- **No reusable UI component:** `ArtifactVersionHistory.js` shows native SharePoint versions of one file, not history across rows, so the plan is right to build a separate panel.

## Recommendation evidence
| Recommendation | Supporting source | Tested? | What would disprove it | Status |
|---|---|---|---|---|
| Regeneration key built from request, old row(s) and operation ID, not input fingerprint | `reopen-service.js:516-525`, `transition-model.js:234-243` | Not tested | A reader that needs the key to encode inputs. None found: `rereadByGenerationKey` only looks rows up | Supported, unbuilt |
| Distinct producer value instead of `wmkf_reopencycleid` | Reopen rows (`request-workbench-reopen`) already become the current pointer | Not tested | A Pre-Site reader that checks for producer `request-workbench`. The grep found only the distribution-snapshot prefix (`requestDocument.js:115`) | Supported, unbuilt |
| Use a reopenable skip reason for the replacement-email wait | `handoff-email-store.js:26-37`, `:47-55` | Not tested | Same-ID retry after a skip, in the Postgres test | Unverified |
| Rebind or reinterpret the preparation receipt | `preparation-worker.js:438-462`, `cycle-list-service.js:585-602` | Not tested | Unit fixture with a "prepared" receipt on the old row after regeneration | Unverified |

## Required plan changes before implementation
1. Fix the preparation-receipt behaviour and add `preparation-worker.js` and `cycle-list-service.js` to the change list.
2. Write down the key format and frozen-snapshot contract.
3. Either drop `wmkf_reopencycleid` for regeneration or list every reader of it.
4. Define the email wait/abandon check, with a reopenable skip reason or an accepted ledger SQL change.
5. Settle the source-edit comparison point and reconfirmation behaviour.
6. Record the writer-gate and route-allowlist constraints, and fix the two citations.

The remaining open item, the email copy, belongs with owner decision 3 and does not block.
