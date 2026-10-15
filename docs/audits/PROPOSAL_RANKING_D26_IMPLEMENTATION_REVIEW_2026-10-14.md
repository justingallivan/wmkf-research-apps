# Session 608 — D26 implementation review and validation

Date: 2026-10-14 (Pacific). Branch: `codex/d26-ranking-release`.
Source candidate: `9fe92f0ed`; integrated baseline: `74040eba5`.
Status: Sol and Opus satisfied; root completed the final nonblocking narrowing.
Implementation validation is complete within the evidence boundaries below; production release acceptance remains separate.
Production promotion and cutover are not approved or executed.

## Scope and review ownership

Luna implemented the accepted D26 addendum. Sol reviewed the code; root performed
an additional source/consumer review and hardened regression fixtures. Claude Opus
performed the final adversarial review, followed by a bounded correction review.
The user explicitly authorized subscription OAuth usage, not API credits. Host
Claude authentication reported `claude.ai`, first-party Team subscription. Both
CLI invocations excluded API-key/alternate-provider environment variables, ignored
user/project settings, disabled MCP, and allowed only Read/Glob/Grep tools.
The first successful result identifies `claude-opus-5-5`, with no permission denials.
CLI list-price usage estimates are not evidence of API billing; authentication
was the verified subscription session. No alternate review product was used.

## Resolved review findings

[VERIFIED via source and regression tests] Sol's first pass found four defects:
participant own reset was incorrectly facilitator-only; superuser membership
intersections lost content; the legacy round projection omitted workflow JSON
needed to authorize a second nonparticipant facilitator; reveal history spread
fields instead of allowlisting them. Fixes landed in `26cb148a1` and `a5f4a83d8`.
Root also made the legacy projection mock omit workflow JSON and populated actual
reveal-history rows with private-field/operation sentinels, so those tests exercise
the previous failures. Sol cleared the corrected code.

[VERIFIED via source and tests] Opus found no high/medium defects and recommended
three small corrections. `69578a397` restores the former nonparticipant v1
facilitator's exact transfer acknowledgement retry without a second write; checks
configured facilitator membership before expensive preview reads while retaining
the post-build check; and describes transferred controls/readiness accurately.
Sol's narrow review found no actionable defects in these corrections.

[VERIFIED via schema and live sandbox metadata] Opus's older duplicate-receipt
scenario was conditional on a missing unique round/list key. Wave32 declares
`wmkf_proposalrankinglist_round_listkey`; read-only sandbox metadata confirmed
`EntityKeyIndexStatus: Active` and attributes `wmkf_listkey`, `wmkf_roundid`.
The insert therefore cannot create duplicate receipts in the verified sandbox.
Release readiness requires active expected keys; production metadata still needs
release-time revalidation. No unrelated receipt redesign was added.

[VERIFIED via source] The dependency omitted from the first review snapshot,
`lib/services/dataverse-settings-service.js`, returns `row['@odata.etag']` as the
setting revision. It was supplied for the follow-up review. The synthetic rehearsal
revision is expressly a fixture marker, not evidence of settings/open capture.

## Automated verification

[VERIFIED via commands] 25 ranking/identity-map suites, 269 tests pass on final source `9fe92f0ed`,
including the two additional legacy nonmember authorization cases. Scoped ESLint passes. Types, scoped ESLint and production build pass on final source `9fe92f0ed`.
Runtime gates and their self-tests ran sequentially and passed: API route matrix,
status enum parity, Dataverse access layer, OData escaping, Dynamics context
boundary, route lifecycle auth, route service boundary, and GUID trust boundary.
Final document reconciliation covers API/design/implementation/release plans,
Atlas, service catalogue and Session 608 handoff; document gates are recorded at
completion. Existing unrelated filesystem tracing/React test warnings are not
introduced by this change.

## Real sandbox persistence evidence

[VERIFIED via retained receipt and script exit 0] The new fixed D96 rehearsal
completed at `2026-10-15T01:58:20.080Z` on `a5f4a83d8`; the subsequent three
corrections do not change the workflow persistence path exercised here.
Target: registered sandbox `orgd9e66399.crm.dynamics.com`.
Initial round: `a2f2e623-2718-4f45-bac4-5e443927cf85`.
Retained successor: `cbd337f2-1cc5-4352-b1ee-a16b221c43f1`.
Local private receipt: `/private/tmp/proposal-ranking-d26-d96-sandbox-receipt.json`.

- 23 fictional snapshot proposals, four enabled sandbox personas; Beth and Justin
  captured as facilitators. Rob Harrison is the sandbox surrogate; this is not
  proof of the production John Sader mapping.
- Distinct populated private orders remain actor-only.
- Five persisted races: reveal, collective edit, reopen preparation, restart,
  then reveal on the successor. Each used the same ETag for both actors, had one
  winner and one explicit conflict, persisted the actual winner's receipt/stamp,
  and had no losing operation receipt. State/history/coordinator readbacks passed.
- Restart retained the 23 proposals, four people and exact facilitator set.
- Workbook contained 23 proposal rows and 92 individual assessment rows.
- D97/D98 fixtures were preserved. The harness created retained ranking rows only;
  it did not change settings, source Requests, profiles, grants, or production.

These are trusted service personas, not independent Microsoft sessions. This
rehearsal does not establish real preview/open setting capture, all race
permutations, current production schema/grants/source eligibility, or Safari/iPad
interaction. Those boundaries remain explicit release acceptance work.

## Opus initial code review — verbatim

I found no high- or medium-severity defects at a5f4a83d8. There are three low-severity items worth fixing and one older issue that predates this change. None of them leaks unrevealed work or lets a shared action be written twice or half-way.

I traced each action from the client through the route, service and reducer to storage, and back through the success, conflict, replay, history and supplement responses to the UI. The four issues Sol found are fixed in the source:
- **Program reset by a participant:** `resetProgram` is not in the facilitator-only action list (`workflow-service.js:44`), so a participant can reset their own program.
- **Superuser who is also a member:** content access depends only on being a captured facilitator or participant (`workflow-service.js:356`), so the superuser role neither adds nor removes content.
- **Second facilitator outside the roster:** the version check re-reads the round with the workflow JSON before checking membership (`service.js:408-421`).
- **History:** entries are built field by field (`workflow-service.js:490-513`), so `ready` and unknown fields are dropped.

## Findings

**1. Low: a former facilitator's transfer retry now gets 403 instead of its receipt (v1 regression)**
- `service.js:1046-1048` calls `assertStoredActionVersion`, which only lets in roster members, the current scalar facilitator or superusers (`service.js:414-416`). That runs before `transferFacilitator`'s existing replay path at `service.js:875-878`.
- Scenario: a v1 facilitator who is not on the roster transfers to a PD, loses the response, and resends the same operation ID. The round's facilitator is now the successor, so the retry gets `403 access_denied` instead of the "facilitator-transferred" receipt promised in the API contract (§5). The client then clears the view, and the user can't tell that the transfer went through. Data is not damaged.
- The existing test only covers the first transfer, not the retry.
- Smallest fix: when the stored version is 1 and the expected version is 1, skip the membership pre-check and let the v1 handlers authorize as they already do. Alternatively, treat a matching earlier `facilitator-transferred` event by this actor as authorized for `transfer`. Add a test for a same-operation retry.

**2. Low: `preview` does the full source read before checking the caller is a facilitator**
- `service.js:693` builds the whole preview, and the membership check only runs at `:697`. The old code checked the configured facilitator first.
- Any user with the ranking app can now POST `preview` for any cycle. That triggers a full proposal, review, grant and identity read, and may return `409 configuration_requires_v2` or the 503 configuration error before the 403.
- No proposal content is returned, so this is an authorization-ordering and cost regression rather than a privacy leak.
- Fix: call `readDefaultFacilitators()` and require membership before building the preview, and keep the existing check after the build.

**3. Low: the transfer copy the contract asked to change is unchanged**
- Contract §3 says to update the transfer wording so it no longer promises private-list visibility. `ProposalRankingApp.js:945` still says "the new facilitator gains facilitator visibility".
- Fix: say the successor gains the round controls (generate, publish, excuse, cancel) and readiness, not private lists.

**4. Low, older than this change: the reveal ID is another actor's operation ID, and its receipt key can be reused**
- `revealId` is set to the facilitator's reveal operation ID (`workflow.js:223`) and is shown to everyone (`workflow-service.js:403`). The contract allows this field, so it is not a new leak.
- However, `receipt()` hides receipts from other actors (`workflow-service.js:440`), and `mutateWorkflow` then carries on and writes a second `o:<revealId>` row (`:546`, `:709`).
- Scenario: a participant sends their own action using the public reveal ID as the operation ID. Unless Dataverse has a unique key on round plus list key, this creates a duplicate receipt. After that, the facilitator's readback of the reveal fails with 503 "Duplicate operation receipt".
- This is the same concern the contract cited when it stripped `ready.operationId`. Fix: when a receipt exists but belongs to someone else, reject with `409 operation_id_reused` before any write.

## Limitations
- `dataverse-settings-service` is not in the snapshot. The round-membership check requires `settingRevision` to be a non-empty string (`facilitation.js:55`). If the real revision isn't a string, every v2 open would fail with 503. That fails safe, but the sandbox rehearsal should confirm it.
- Test mode finds Beth and Justin by display name among enabled sandbox staff (`config.js:23-29`). Duplicates fail safe, but this is weaker than pinning their IDs. It applies only under the sandbox test guard.
- Any v2 write to an older v2 round that has no stored facilitator set saves the fallback (single member, `legacy-round` source) into that round's own workflow JSON, not just into a restarted successor. It resolves to the same set, so it is not a defect.
- These are mock-level and static findings only. Atomicity, concurrent races and sign-in/browser acceptance remain live gates. I did not treat the running rehearsal as evidence.

## Verdict
The code is ready, with three small corrections recommended: the v1 transfer-retry regression (1), the preview check order (2) and the transfer copy (3). Item 4 predates this change and can be scheduled separately; it is not a blocker.

## Opus bounded correction review — verbatim

I'm satisfied with all three corrections and with the evidence boundary. I found no new blocker. The diff does introduce one minor issue, a small metadata oracle (finding 1). I'd recommend fixing it, but it shouldn't block release.

## Finding-by-finding disposition

### 1. v1 transfer retry by a former non-roster facilitator — **Resolved, with one minor non-blocking issue**
- `service.js:417` now returns early for every stored v1 round, so `transferFacilitator` is reachable. Its exact actor+successor receipt branch (`service.js:881-885`) gives a former facilitator an acknowledgement only, never the round contents. Plain reads still go through `getRoundResponse`, which denies at `:380`.
- The new test checks the right things: one `patchRound` despite the retry, a waiting-mode acknowledgement, and a 403 on a plain read.
- **Caveat introduced by the diff:** the early return skips the shared membership gate for all eight v1 actions, not just transfer. Some handlers check state before they check authorization:
  - `mutateMeeting` (`:793-804`): a non-member who knows the round GUID can tell `program_empty`, `invalid_transition` (whether the meeting list is published), `round_closed` and `stale_policy` (which reveals the policy revision) apart before the auth check at `:807`. For `generate`/`publish`, `program_empty` comes before `:798`.
  - `mutateOwnList` (`:753`): `invalid_order` (400) comes before the ownership check, which gives a weak oracle on the full proposal-ID set.

  No writes or private orders are exposed. Every path that returns a payload goes through `getRoundResponse`. `excuse` and `cancel` check authorization first. That makes this a low-severity lifecycle-metadata leak to authenticated app users who already have the round GUID. The narrow fix is to apply the bypass only to transfer, e.g. pass `action` in and early-return only when `action === 'transfer'`. Another option is a test showing a non-member `edit` gets 403 before any state errors. The current comment ("handlers perform their own per-action authorization") is accurate about write authorization but not about the order of the checks.

### 2. Preview authorization ordering — **Resolved**
- `service.js:696-699` checks the default membership before `buildProposalRankingPreview`. The fresh check after the build at `:704` is kept, so a settings change during the build still denies.
- Non-facilitators now get 403 instead of possibly seeing the 409 `configuration_requires_v2`, which is an improvement.
- `readByCycleOrWait` now reads the defaults twice (`:738` and inside the preview). That costs a little performance and is harmless; the error behaviour is the same as before.
- The test confirms the builder is never called on a denial.

### 3. Transfer copy — **Resolved**
"round controls and readiness access" matches what the successor actually gets better than "facilitator visibility" did. It's UI-only and touches no logic.

### 4. Unique round/list key (conditional concern) — **Closed**
`wmkf_proposalrankinglist.json:41-42` declares `wmkf_proposalrankinglist_round_listkey` on `wmkf_roundid`+`wmkf_listkey`. With your sandbox metadata (Active) and the release-readiness key validation, the duplicate-insert scenario only applies if the schema is missing, and readiness blocks that. I agree no application change is needed. Production key status should stay a release-time gate, as you said.

### Missing-dependency limitation — **Closed**
`dataverse-settings-service.js:87-95` returns `revision: row['@odata.etag'] || null`, which confirms the settings revision is the Dataverse ETag. You're right not to cite the synthetic rehearsal as evidence for the settings/open capture.

## Evidence boundary
I accept it as stated:
- **Unit tests and lint:** these are your reported results. I can't run them with Read/Glob/Grep only, and I didn't verify the 267 count.
- **Sandbox rehearsal:** the D96 run on `a5f4a83d8` used trusted service personas, not independent Microsoft SSO. Calling it workflow-equivalent to `69578a397` is fair: the diff changes only v1 dispatch authorization, preview gating and copy. It does not cover v2 workflow paths.
- **Still open:** browser smoke tests and production key status.

## Verdict
**Satisfied; no blocker.** All three low corrections are resolved and the conditional schema concern is closed. Before or soon after release, I'd recommend narrowing the v1 early return to `transfer` only, or adding a test that a non-member `edit`/`generate` gets 403 before any state-dependent error. That change is small and wouldn't need a new review.

## Final author disposition

[VERIFIED via source and tests] Opus declared satisfaction and no blocker, while
recommending the transfer-only exception narrowing without another review. Root
applied that exact narrowing in `9fe92f0ed`. Only a stored-v1 transfer may reach
its existing exact actor/successor acknowledgement before the generic membership
check; edit/generate and other actions retain early membership authorization. Two
new nonmember edit/generate tests assert 403 before state-dependent errors; the
existing transfer retry test still proves one write and later plain-read denial.
This is a bounded closeout of the recommendation, not a new review cycle.

## Browser smoke and final evidence boundary

[VERIFIED via host Chrome automation and screenshot inspection] The initial
sandboxed Chrome launch and desktop connector were blocked. One bounded host-side
retry succeeded using a loopback read-only server that rejects all mutations and
only serves the two D96 receipt round IDs. For both Beth and Justin service
personas, the actual AssessmentWorkflow rendered 23 saved proposal cards,
readiness and shared controls, navigated to history, and downloaded the workbook
through the UI without page runtime errors. Root inspected the facilitator
screenshot. The D96 receipt hash was unchanged. Browser/server processes closed.
Temporary evidence: `/private/tmp/session608-d26-browser/evidence.json` and
`0-group.png`, `0-facilitate.png`, `1-group.png`, `1-facilitate.png` in that directory.
The harness's generic details-element count is not a history-record count and is
not cited as such. History navigation is a smoke check, not exhaustive history UX
validation. The sentiment endpoint was explicitly empty for fictional proposals.

WebKit binaries were unavailable, so no Safari/iPad test is claimed. The local
server uses trusted sandbox service personas, not real Microsoft login sessions.
Independent sign-ins, real-device interaction, full release-time production
source/schema/grant checks, remaining race permutations, rollout approval,
retained trial retirement and actual D26 opening remain separate release gates.
No production schema/config/grant/round change, main merge, or deployment occurred.

Final scope verdict: the implementation is reviewed with Sol and Opus satisfied;
root incorporated Opus's final nonblocking recommendation directly. The candidate
is suitable for the remaining integrated-preview/release acceptance checks, not
an assertion that production cutover is ready or authorized.
