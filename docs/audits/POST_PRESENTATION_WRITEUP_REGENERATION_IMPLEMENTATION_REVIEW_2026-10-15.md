---
title: Opus implementation review of post-presentation writeup regeneration
domain: workbench
kind: audit
status: review-complete
summary: OAuth Opus approved candidate bad799414 with four low non-blocking findings; bounded follow-up completed and locally verified below.
owner: product-engineering
last_verified: 2026-10-15
related:
  - docs/plans/POST_PRESENTATION_WRITEUP_REGENERATION_PLAN_2026-10-15.md
---

# Review receipt

Reviewed runtime: `bad7994149973e941597ecfc3fc2e1b9c9058710`, branch `codex/writeup-regenerate`.
Claude CLI ran outside the sandbox through verified `claude.ai` first-party Team OAuth,
with `--model opus --effort high`, safe mode, no external MCP servers, and only
Read/Grep/Glob tools. API-key/auth-token/provider override environment variables were
removed. No API-key authentication or metered review product was used. The CLI returned
success in 63 turns. Model usage lists `claude-opus-5-5` and `claude-fable-5-1`; the
latter's role is not identified, so this receipt does not claim exclusively Opus execution.

Verdict: **APPROVE**, no material correctness findings. The original report below is
retained as received; it is source review, not hosted runtime proof.

## Parent disposition

- Findings 1–3: accepted for a bounded follow-up with regression tests (own-operation
  lease, actor/schema preflight, and selection of a committed historical Final).
- Finding 4: disable the same-tab group handoff when regeneration is observed pending.
  The separate Final tab and other browser sessions remain protected by the server's
  ETag/stage fences; adding cross-tab coordination is not necessary for correctness.
- Parent lint caught and removed one duplicate export after the reviewed candidate.
- Luna completed the bounded follow-up at `e2848e94a`; Sol and parent reviewed it with
  no remaining material findings. Final verification: 16 suites / 700 tests, scoped
  gates and their self-tests sequentially, types, scoped lint (warnings only), and
  production build passed. Opus did not condition approval on these low findings;
  no further broad Opus cycle was run. No production, SharePoint or Dataverse rehearsal
  was run.

---

**Verdict: APPROVE.** I found no material correctness bugs and no breaches of the owner requirements. Four low-severity, non-blocking findings are listed below, and none of them can activate the wrong pair, lose a preserved file or count a sign-off against the wrong document. The review was read-only and covered the current source at `bad79941`. I did not treat test mocks as proof.

## What I checked and found correct

- **Group-review path with default dependencies:** `artifact-dependencies.js:49-52` wires the real status read, Final successor prep, email staging and email delivery. `prepareRegeneratedFinalSuccessor` (`transition-service.js:197-239`) is idempotent on its key, accepts the `gdc1:` hash format and creates through the one registered writer with the REQUIRED actor policy.
- **Stage and pair races:**
  - The service checks the exact pair and stage before loading any inputs (`artifact-service.js:160-184`).
  - Activation re-reads the request, the old row(s) and the prepared Final, and checks lifecycle and pointers with every ETag present (`artifact-lineage.js:351-359`, `493-507`). Each changeset fences on ETags, so a group handoff, a leadership move or a competing operation makes the slower writer fail.
  - The lead PD is re-checked at activation (`:339`, `:488`) and at email staging (`handoff-email-service.js:315`).
- **Old links stay live until activation:** the pointers move only inside one changeset. The post-visit path supersedes one row and moves one pointer; the group-review path supersedes both old rows and moves both pointers. The old SharePoint item is never deleted (regeneration is excluded from the delete at `artifact-service.js:561`), and the new pair passes `committedFinal` (`transition-model.js:194-212`).
- **Same UUID:**
  - A live claim returns pending.
  - A failed attempt without saved model output fails closed before the `try`, so no second model call.
  - A saved draft resumes from the frozen snapshot and draft.
  - A completed operation replays its committed successor (`:141-158`).
- **Metadata and hash:** before the changeset, activation re-reads the new file's metadata (versionId, eTag, lastModified, size) and checks the downloaded content hash against the saved hash (`:375-400`, `:508-528`).
- **Sign-offs:** a late sign-off must name the current Final ID and is refused once that Final is replaced (`acknowledgement-service.js:148-153`, `:531`). The new Final starts with no sign-offs and a fresh group-review start time.
- **Email:**
  - Notice intent is staged against the old pair before activation.
  - Delivery waits while the replacement is generating or ready.
  - The loser of a race, or an abandoned attempt, ends in the reopenable `transition_not_committed` state.
  - The old pending notice is retired as `final_from_other_draft`.
  - Delivery never throws after the commit, so a committed successor is never marked failed.
- **Preparation and history:** preserved preparation receipts tied to an earlier version count as history in both the request detail and the cycle list. Superseded versions in the drafting stage hide their file from viewers who could not see the draft.

## Findings (all Low, non-blocking)

**1. A same-UUID retry checks another row's lease.**
- **Where:** `artifact-service.js:137-138` reads `currentStatus.pendingArtifact?.leaseActive`. That is the newest unfinished row (`artifact-reader.js:93-103`), not the operation's own row.
- **Trigger:** two UUIDs race the initial read (the plan accepts this at §84), and the newer one fails. A retry of UUID-A while A's model call is still running then skips the "return pending" branch and hits `:195`.
- **Consequence:** the user wrongly sees "stopped before its generated content was saved. Start a new confirmed operation." Doing so can cause a third paid model call. The 15-minute lease is longer than the route's 300-second limit, so this needs the race first.
- **Fix:** use `generatingLeaseActive(row)` at `:138`, and only apply the `:195` incomplete-output check when `!generatingLeaseActive(row)`.

**2. The resolved actor and schema readiness are not checked before the model runs.**
- **Where:** the route's regenerate branch (`pre-site-visit.js:213-232`) never requires `isGuid(actingUserSystemId)`, unlike `startFinalWriteup` (`transition-service.js:65`).
- **Why it matters:**
  - When the explicit-actor schema flag is off, `request-document-actor-service.js:88-89` returns before the REQUIRED check at `:110`.
  - Activation then always binds `wmkf_MilestoneCreatedBy` (`artifact-lineage.js:428`, `:543`). The existing writer only binds it when the schema is ready (`site-visit-transition-service.js:318`).
- **Consequence:** in an environment with the flag off, or for a superuser with no linked identity, regeneration fails at activation, after the paid model call and the upload. Plan §74 requires "a resolved actor, and applicable schema readiness." The Atlas records the production flag as `on`, so production is not affected today.
- **Fix:** in the route's regenerate branch, refuse unless `isGuid(actingUserSystemId)` and explicit-actor readiness is on. Mirror this in GET `canRegenerate`.

**3. Previous versions can show the wrong stage.**
- **Where:** `artifact-reader.js:111-113` builds a Map from rows sorted newest-first, so the last write is the *oldest* Final for each source.
- **Trigger:** a source with an earlier failed Final claim and a later activated Final (for example, a group-review start that was retried after the file changed).
- **Consequence:** a prior group-review version is labelled post-visit drafting, and its file is hidden from colleagues who reviewed it (`pre-site-visit.js:134-137`). It fails toward hiding, so no privacy leak.
- **Fix:** prefer the Final row that has `wmkf_groupreviewstartedat` when building the map.

**4. The UI doesn't disable stage transitions while a regeneration is pending.**
- **Where:** `regenerationPending` only disables the Regenerate menu item (`StaffDeliberationsTab.js:1338`). "Ready for group review" (`:1385`, `:1655`) and the leadership action in `FinalWriteupTab.js:624` stay enabled. Plan §86 asked for these to be disabled.
- **Consequence:** the server checks guarantee only one side wins. The cost is a wasted paid generation or a refused handoff.
- **Fix:** add `!regenerationPending` to `canHandOff`. Also expose pending state to the Final tab, or accept this as UI-only.

## Limits of hosted proof (not code bugs)

- **SharePoint metadata timing:** activation requires the upload response and a later GET to agree exactly on eTag, lastModified and size (`artifact-lineage.js:378-388`, `517-528`). SharePoint may change these after upload, which would refuse activation with `file_changed`. A same-UUID retry recovers through `recoverUploadedFile` using freshly read metadata.
- **Dataverse changeset:** whether the five-operation changeset, with two lookup bindings on `akoya_request`, is atomic in hosted Dataverse is unproven. Unlike `commitReadyLineage`, a 412 from ETag drift has no retry loop. Retrying the same UUID recovers.
- **Co-authoring:** edits to the old file during or after confirmation are non-blocking by design, and none of this has been rehearsed in a hosted environment.

## Gaps in the tests (for reference, not counted as findings)

The changed suites don't exercise:
- the initial-read race followed by a newer failed row (finding 1);
- recovering a group-review commit whose response was lost through the service, as opposed to the lineage helper alone;
- the route's actor and readiness checks for regenerate (finding 2);
- the stage label with several Finals for one source (finding 3).
