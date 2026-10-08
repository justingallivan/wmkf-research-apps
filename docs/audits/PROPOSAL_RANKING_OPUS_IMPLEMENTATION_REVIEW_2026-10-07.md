# Proposal Ranking — Opus implementation review

Historical pre-provisioning receipt. Subsequent sandbox setup and bounded source-field
correction review are recorded in `PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md`.

Date: 2026-10-07. Reviewer: `claude-opus-5-5`, authenticated through the
Claude subscription OAuth session, with API-key environment variables removed.
Read-only file tools; no Fable, model API, live data or deployment used.

The initial review was given a diff fingerprint but could not read the temporary
diff outside its file-tool root. Its review is therefore a working-tree source
review, not a verified diff-hash attestation. This limitation is retained below.

## Round 1 — verbatim reviewer result

PROPOSAL_RANKING_IMPLEMENTATION_REVIEW_R1

**Reviewed diff hash:** `64d516ebd7d941305fc1911b32b5389b9a733ca4f56b8011309d0fbf0684f268` (as you supplied it; I could not verify it). The file tools are confined to the worktree, so I couldn't open `/private/tmp/proposal-ranking-implementation.diff`. I reviewed the working-tree source instead, which carries the same staged changes: UI, client, API routes, service, adapter, schema, Explorer privacy and the lifecycle tests. I ran no commands, made no edits, and touched no live services.

**Verdict: REQUEST CHANGES**

## Proven defects

**H1 — High, blocking. `canonicalGuid` rejects real WMKF Dataverse IDs, so actor resolution fails for every staff member.**
- **Evidence:** `lib/services/proposal-ranking/calculations.js:20` requires an RFC version nibble `[1-8]` and variant `[89ab]`. This tenant's IDs don't fit:
  - systemuser `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7` (`scripts/probe-impersonation-resmoke.js:27`)
  - systemuser `73d32260-aa8b-f111-…` (`.claude-memory/project-ops-meeting-2026-09-16-agenda.md:59`)
  - program IDs `…-ee11-…` (`shared/config/researchPrograms.js:7-8`)
- **Effects:**
  - `service.js:196`: every actor gets 503 "staff identity is unavailable".
  - `config.js:11,22`: the default facilitator can't be read or saved.
  - `service.js:58`: transfer and excuse reject the successor or participant with 400.
  - `service.js:234,367`: `facilitatorId` becomes null, so `isFacilitator` is false.
- **Why tests miss it:** every fixture uses v4-shaped IDs (`11111111-1111-4111-8111-…`).
- **Fix:** relax the regex to the repo-standard any-hex form (`lib/utils/guid.js:20` `GUID_RE`), then trim and lowercase.
- **Regression:** run the facilitator and participant lifecycle with `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7` and a `…-f111-…` ID: read, save, submit, generate, transfer, excuse, plus the admin PUT.

**M1 — Medium. Embedded Dataverse 4xx errors (including 412) are rethrown raw, which breaks the error contract and shows Dataverse text to users.**
- **Evidence:** these paths rethrow the raw `buildServiceError` object, which has no `.code`, message `dataverse failed (412): <raw JSON>` and `current` null:
  - `service.js:425` (`afterMutation`)
  - `service.js:849` (transfer)
  - `service.js:606` (open, for non-conflict 4xx)
- `pages/api/proposal-ranking.js:12-16` then sends HTTP 412, `code: 'dependency_unavailable'`, and that raw message for anything under 500.
- **Why it's reachable:** every save and edit does a conditional PATCH on the round ETag, as the design intends, so two PDs saving at the same moment, or several participants editing a published order, hit this.
- **Client impact:** `ProposalRankingApp.js:663` only marks a 409 as `conflict`. A 412 becomes `unsaved`, no `current` view is applied, and the raw Dataverse string is displayed.
- **Fix:** in `afterMutation`, map a confirmed-rollback 4xx to `error('The round changed while saving. Refresh before continuing.', 409, 'conflict', response)`, reusing the readback response already fetched. Apply the same mapping in transfer.
- **Regression:** `patchRoundAndList` rejects `{status: 412, message: 'dataverse failed (412): {...}'}`. Expect 409 `conflict`, a privacy-filtered `current`, and no "dataverse" text in the route body.

**M2 — Medium. Confirmation tokens hash every list's `wmkf_lastoperationid`, so any draft autosave in either program makes them stale.**
- **Evidence:** `service.js:126`, used at lines 314, 323, 331, 334, 751, 883 and 913.
- **Contract:** `PROPOSAL_RANKING_API_CONTRACT.md:152-155` binds tokens to policy revision and *submission* state.
- **Effect:** while MR PDs drag cards (one save per move), SE generate and publish, excuse and cancel keep returning `confirmation_stale`. That works against the independent-program decision.
- **Fix:** hash `[listKey, status, submittedOperationId]`. The meeting ETag check already pins the reviewed draft version.
- **Regression:** SE fully submitted → fetch the token → an MR participant saves a draft → SE generate with the original token succeeds.

**L1 — Low. A confirmed commit can be reported as `uncertain_outcome`.**
- **Evidence:** on the success path, `service.js:435` → `424-426` re-derives the outcome from `wmkf_lastoperationid`. If another participant edits the published meeting list between our commit and the readback, our status becomes `superseded`, and we throw `uncertain_outcome`.
- **Why that's wrong:** `executeChangeset` returning `ok` already proves the commit (`changeset.js:158-175`).
- **Fix:** on the success path, return the readback with `operation: { operationId, status: 'confirmed', result: action }`.
- **Regression:** the mock commits our edit, then applies a second edit with a different operation ID before readback. Expect `confirmed`.

## Checked, no defect found
- **Response privacy:**
  - Before publication, participants get only their own list.
  - Progress names go only to the facilitator.
  - A non-roster superuser gets a redacted snapshot.
  - Publishing SE doesn't expose MR.
  - Conflict `current` values come from `getRoundResponse`, so they're permission-filtered.
- **Excused PDs:** their lists are left out of composite generation, and their own-list writes are blocked.
- **Composite `ranks` array:** the shape matches the contract and the UI's use of `composite.ranks`.
- **Atomicity:**
  - Open creates the coordinator, round and lists in one changeset.
  - Cancel updates the round and coordinator in one changeset.
  - The open-retry lookup by operation ID is checked first.
  - Cross-action operation-ID reuse is rejected.
- **Explorer privacy:**
  - Direct table names are blocked; `query_records`, `count_records`, `aggregate` and `export` resolve navigation paths through metadata and fail closed.
  - `$expand` from `systemuser` is blocked; `describe_table` and search filter the private tables.
  - `get_entity` and `get_related` use fixed selects with no navigation.
  - No FetchXML path exists.

## Needs live rehearsal (not source defects)
- Whether Dataverse enforces the alternate keys inside a changeset, and the exact duplicate-key code (`0x80040237`) and 412 envelope shapes that the open and race classification relies on.
- Changeset size and duration with the real roster size (about 2 × roster + 3 operations).
- Weak ETag `If-Match` behaviour inside `$batch`.
- Whether the DateTime fields accept ISO strings.
- The app-user role isolation, plus confirming that an ordinary PD's direct Dataverse access is denied.
- The relevance-search exclusion.

**Contract wording note:** `read` with an operation ID that never committed reports `superseded`. The UI handles this safely by comparing orders, but the contract text says "superseded by newer state".

## Orchestrator disposition

H1 accepted: Dataverse identifiers use the repository's any-hex GUID syntax.
M1 accepted with a narrow correction: confirmed 412 becomes a filtered 409 conflict;
other confirmed storage 4xx retain classification but raw transport messages must
not reach the UI. Mapping every 4xx to a concurrency conflict would mask failures.
M2 accepted: confirmation binds policy/submission state, while the meeting ETag
pins the reviewed order. Unrelated draft autosaves should not revoke confirmation.
L1 accepted: a confirmed changeset remains confirmed even if current order is newer.

All four corrections were implemented by Luna, independently checked by Sol,
and integrated by the orchestrator. Live rehearsal requirements remain operator
work and are not represented as completed by local tests.

## Round 2 — verbatim reviewer result

PROPOSAL_RANKING_IMPLEMENTATION_REVIEW_R2

**Verdict: APPROVE WITH NONBLOCKING NOTES**

This reviews the current worktree source, not a diff I hashed myself. I used only read-only file tools. I ran no commands or tests and used no live services, environment, keys, APIs or Fable. I can't confirm the test results or the build you reported.

## The four corrections

**H1 (GUID format) is fixed.**
- `calculations.js:18-21` now accepts any hex GUID. It trims, lowercases and strips braces.
- Every identity check goes through it: the actor (`service.js:197`), the stored facilitator (`235`, `368`), the `guid()` inputs (`58-62`) and the admin settings (`config.js:11,22`).
- Roster IDs come from the source adapter in lowercase (`proposal-ranking-source.js:159`).
- New fixtures fail the old strict pattern: `f1111111-1111-1111-1111-…` and `ee11eeee-…`. They cover the round read and ownership (`proposal-ranking-service.test.js:153-166`) and the admin PUT with uppercase input (`229-243`).

**M1 (raw 4xx errors) is fixed.**
- **412 on save, submit, edit, generate, publish, excuse and cancel:** `afterMutation` reads the round back first. A confirmed commit still returns success; otherwise the caller gets a 409 `conflict` with the permission-filtered current view (`service.js:430-432`).
- **412 on transfer:** handled separately. If the commit is confirmed it returns success; otherwise a 409 `conflict` (`856-858`). If the actor can no longer read the round, `current` becomes null through `.catch`, so nothing leaks.
- **Other 4xx errors:** they keep their status (`433`, `614`, `861`). Raw Dataverse errors carry no `.code` or `publicMessage` (`service-error.js:37-62`). Both routes therefore return `dependency_unavailable` with a generic message (`proposal-ranking.js:14-18`, `proposal-ranking-facilitator.js:35-39`).
- **UI:** the 409 now hits the `conflict` branch (`ProposalRankingApp.js:670`). The UI applies `current` and shows the server's order as the remote order (`664-667`).

**M2 (confirmation tokens) is fixed.**
- The token now hashes only each list's key, status and submitted operation ID (`service.js:127`).
- The meeting ETag is still checked before generate and publish (`738`).
- Excuse and cancel are bound to list status through the token, and their state checks are at `896` and `926`.
- The test at `169-187` shows an unrelated autosave leaves the token unchanged, while a submission changes it.

**L1 (confirmed commit reported as uncertain) is fixed.**
- **Service:** `commitMutation` passes `knownCommitted` on the success path, so the result is always `confirmed` (`service.js:425-428`, `443`). Excuse and cancel report `confirmed` from the administration-log entry.
- **UI:** it compares the server order with the order it sent. If they differ, it keeps the local draft, stores the server order as remote and marks the list `conflict` (`ProposalRankingApp.js:649-654`).
- The test at `201-227` covers this.

## Nonblocking note

The new `publicMessage` rule also hides one non-Dataverse message.

- **Evidence:** `preview-service.js:13-18` builds errors without `publicMessage`. So the 409 `incomplete_preview` from `assertPreviewCanOpen` (`:179`) now shows "The round changed or the action could not be confirmed…" instead of the preview warnings.
- **Impact:** small. It is reached only when the preview fingerprint matches but `canOpen` is false. The UI already disables Open in that case, through `capabilities.open = preview.canOpen` (`service.js:654`).
- **Minimal fix:** set `error.publicMessage = true` in that `httpError`.

`config.js:24-27` has the same gap, but nothing reaches it because `guid()` validates the ID first (`service.js:988`).

## Blockers and regressions

These corrections introduce no blocking defect or regression that I could find. The live-rehearsal items from R1 are still operator work, and the feature stays disabled until the schema, role and identity rehearsal is done.

## Final disposition and verification

The orchestrator accepted the R2 nonblocking note and marked the explicit preview
validation message (plus the equivalent invalid facilitator input message) safe
for API display. Raw Dataverse errors remain sanitized. A focused regression pins
that distinction. This two-line message-tag correction did not trigger a third
review cycle.

[VERIFIED via source and local tests] Luna built, Sol reviewed, the orchestrator
performed integrated source review and UI fixes, and Claude Opus completed two
OAuth-only source-review rounds. R2 verdict: APPROVE WITH NONBLOCKING NOTES.
No Fable or agent model API was used. The source-review evidence boundary is
explicit above; Opus did not run tests or verify a diff hash.

- Canonical `npm run build`: passed after the substantive correction batch.
  Initial Turbopack failure was a worktree `node_modules` symlink outside its root;
  a local APFS dependency copy resolved it without dependency/lockfile changes.
  Two unrelated existing document-renderer tracing warnings remain.
- Focused Proposal Ranking unit and Explorer integration suites: final rerun
  passed 8 suites / 106 tests after the small validation-message correction. The Admin
  navigation suite also passed separately with the new workflow entry.
- ESLint on changed runtime/tests: no errors. Existing Admin page effect warnings
  remain outside the added settings integration.
- Type check, Atlas, API route matrix, route lifecycle, DAL, route/service boundary,
  Dynamics context, GUID trust boundary, OData escape, status enum, fact consistency,
  canonical pointers, doc currency, doc symbol, build-claim, docs catalog and secret
  checks passed; paired self-tests ran sequentially where provided.
- The broader initial Explorer integration run exposed obsolete unknown-navigation
  forwarding expectations and missing metadata mocks. The fixture now remains
  offline, preserves supported relationship and field-restriction assertions, and
  verifies unknown relationships fail closed. Its 43 tests pass.

[NOT PERFORMED] Live schema/role deployment, real staff identity/grant provisioning,
Dataverse alternate-key/ETag rehearsal, direct staff-table denial and relevance-
search verification, multi-browser live rehearsal, production activation. See
`docs/atlas/dataverse-proposal-ranking.md` for the bounded operator checklist.

Contract reconciliation covered caller → UI state → payload → route guards →
service → conditional persistence → filtered response → UI. Reorders and
transitions use whole-row/changeset units; response-loss and stale UI/authorization
cases are tested. No background queue, new provider, streaming or partial batch
success interface is introduced. Durable registry, schema, Atlas, matrix, catalog,
counts and source-plan status are reconciled; historical design-review receipts
remain historical. Live deployment state is deliberately unknown/unperformed.
