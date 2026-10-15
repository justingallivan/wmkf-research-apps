# Session 608 — Opus review of D26 implementation addendum

Date: 2026-10-14 (Pacific). Source snapshot: `886e194ac1b8fb6707a47c59828a3d3d14edc179`.
Artifact: `docs/plans/PROPOSAL_RANKING_D26_IMPLEMENTATION_ADDENDUM_2026-10-14.md`.

## Review mechanism and scope

User explicitly authorized subscription OAuth and subscription usage allowance,
not API credits. Host-side Claude auth reported `claude.ai`, first-party,
subscription authentication. Both review commands removed API-key and alternate
provider environment variables and ignored user/project settings (including key
helpers); only Read/Glob/Grep tools were enabled and MCP servers were disabled.
No fallback model, Ultrareview, direct model API or production action was used.
The first successful CLI result identifies `claude-opus-5-5`, no permission
denials, and a successful result. The reviewer inspected an exported candidate
source snapshot and the addendum, not live production. Raw local CLI result:
`/tmp/session608-ranking-review/opus-review.json` (temporary convenience only).

## First review — verbatim

**Verdict: READY WITH NAMED CHANGES.** The v2 parts of the addendum are concrete enough to build: the response projector, the facilitator-set helper, the action table, and the race and retry rules. One legacy (v1) UI problem and a few unclear points need fixing in the addendum first. Nothing below is a reason to redesign.

Source citations are to this snapshot. "Addendum" means proposed behaviour, not anything that exists yet.

## What the source already supports

- **Atomic writes:** every v2 save sends the round's version check (ETag) in the same batch as everything else (`lib/dataverse/adapters/proposal-ranking.js:146`). So the "one winner" claims are realistic, and saves by different PDs really do conflict, which is why the private retry exists.
- **Facilitator set survives normal actions but not restart:** ordinary actions copy unknown workflow fields forward (`workflow-service.js:481-486`). Restart builds the new round's workflow from scratch (`:532-535`), so the addendum's "preserve on restart" rule is needed.
- **Confirmations already cover the set:** confirmation fingerprints hash the whole workflow and the actor (`workflow-service.js:165-175`), so storing the set in the workflow automatically ties confirmations to it.
- **Receipts are owner-only:** operation receipts are only returned to the person who acted (`:351`).
- **History holds only revealed material:** the only history kinds are `reveal` and `collective` (`workflow.js:229-300`).
- **Legacy actions already fail on v2 rounds without writing:** v1 actions on a v2 round fail at `parseRound` (`service.js:99`), with a 503 rather than the addendum's 409 `unsupported_version`.
- **Conflict and retry responses use the same builders:** v1 conflict responses reuse `buildRoundResponse` (`service.js:436-439`). v2 "already open" and "another facilitator opened first" errors reuse `getRoundResponse` (`service.js:522, 635`). So one projector really does cover those paths.

## Findings

### H1 — High: hiding `facilitatorLists` in v1 removes the facilitator's own list from the screen

**Evidence:**
- In the current v1 UI, the facilitator sees individual lists only through `facilitatorLists` (`ProposalRankingApp.js:188-190`).
- The "Your private ranking" panel is hidden whenever the viewer is the facilitator (`:281`).
- The server does send `ownList` to a facilitator who is also a PD (`service.js:253, 281`), but the UI never shows it to them.
- Production's active v1 round has Justin as facilitator. All four ranking-grant holders, Justin included, appear to be PDs: 8 lists = 4 PDs × 2 programs (release plan `:28, :32`).
- The addendum (`:121-126`) makes v1 `facilitatorLists` null and only requires testing readiness and generation.

**Effect:** in the compatible release, a facilitator who is also a PD (Justin in production) can no longer see, save or submit their own v1 list. That breaks the existing workflow while the old trial is still active.

**Correction:** add to §3 and to slice 4: "The v1 UI shows `ownList` to every roster participant, facilitator included. The facilitator panel shows progress only. Test: a facilitator who is also a participant can save, submit and read back their own v1 list while `facilitatorLists` is null." Also update the transfer copy at `ProposalRankingApp.js:963` ("gains facilitator visibility").

### M1 — Medium: v1 draft composite still shows named PD ranks to the facilitator before publication

**Evidence:** after generation, the facilitator receives the draft composite (`service.js:283`), which includes each PD's named rank (`buildCompositePayload` `ranks[].participants`, `service.js:167-171`). The API contract (`:139`) confirms the facilitator gets "the draft composite". The addendum (`:123-124`) says "Existing program publication controls when its named submitted orders may be shown." That can be read either way.

**Correction:** state the rule explicitly. I recommend: "Before publication, the facilitator gets the draft order and anonymous totals. `ranks[].participants` and `sourceSubmissionIds` are removed until publish." If the owner instead treats v1 generation as the reveal point, record that as an owner decision. Either way, add the case to the slice-4 combination tests. Production meeting lists are still `collecting`, which keeps the practical exposure limited.

### M2 — Medium: v1 round creation and the new setting contradict each other

**Evidence:**
- Addendum `:87`: v1 creation keeps using the old single-facilitator setting.
- Addendum `:61-63`: Admin rejects old-style saves and does not also write the old key.
- So once the new key exists, the old setting can no longer be changed. Yet it alone controls v1 preview and opening (`service.js:500, 654, 688`).
- The release plan's interim state and rollback floor is "v2 creation disabled" (`:89`). In that state Admin would show Beth+Justin while only Justin could open.

**Correction:** "If the new key is present, v1 creation is refused (409 `configuration_requires_v2`). The old setting governs only when the new key is missing." Alternatively, authorise v1 open by membership in the set and store the opener as the round's facilitator, as `service.js:582` does today. Pick one and test it.

### M3 — Medium: no rule for a configured facilitator who later becomes ineligible

**Evidence:** Admin save validates every member (addendum `:62-63`). But the preview rules (`:82-85`) only say eligibility goes into the fingerprint. They don't say whether Beth can open if Justin's grant has since been revoked. Today a single ineligible facilitator blocks opening (`preview-service.js:83-84`).

**Correction:** "At preview and open, every configured member must be an enabled Dataverse user with a mapped active profile and a ranking grant. Any failure is a blocking problem that names the member's status. Members are never dropped silently, and an ineligible set is never captured." Restart keeps its stated no-recheck behaviour.

### L1 — Low: an Admin save can race with an open

**Evidence:** opening reads the setting outside the write batch (`service.js:499-619`). The fingerprint catches changes between preview and open, but not a change between open's own read and its commit.

**Correction:**
- State that open takes effect as of its configuration read. A concurrent Admin save applies to later opens only.
- Store `{ source: 'set' | 'legacy-scalar', settingRevision }` in `workflow.facilitation` for audit.
- Put the revision of whichever key was actually used into the fingerprint, including the old key's revision when falling back.

### L2 — Low: the rehearsal setup has only one facilitator

**Evidence:** test mode hard-codes a single GUID (`config.js:11-14`). Slice 5 needs persisted races between two facilitators in the sandbox.

**Correction:** "Test mode returns a fixed, isolated two-member rehearsal set. A malformed test configuration fails closed. Production identities are never used in it."

### L3 — Low: v2 actions on a v1 round are not covered

**Evidence:** sending v2 actions, history, workbook or sentiment requests to a v1 round currently fails with a misleading `storage_limit` (`workflow-service.js:110-125`). An unknown snapshot version on read fails with 503 at `service.js:99`, not 409.

**Correction:** add to the §4 table: "v2 action, history or supplement × v1 round → 409 `unsupported_version` before load or write. Unknown version → 409 on read and write."

### L4 — Low: the search list misses some old-facilitator references

**Evidence:** `snapshot.facilitatorSystemUserId` (`service.js:531`), the preview field `facilitatorSystemUserId` (`preview-service.js:180`), `readDefaultFacilitator` callers (`service.js:653, 687, 1016`) and v1 `round.facilitator` display (`service.js:292`). The addendum `:219-220` only lists `wmkf_facilitatorsystemuserid`.

**Correction:**
- Add `facilitatorSystemUserId` and `readDefaultFacilitator` to the search.
- Define the v2 snapshot field as omitted, and make sure the helper never reads it.

### L5 — Low: two leftover projection details

- **Superuser readiness:** the access table (`:105`) says a superuser who isn't a participant gets "administration metadata only". But `publicView` currently gives everyone the readiness `progress` list (`workflow-service.js:322-326`). Say whether that superuser gets `progress`.
- **Other people's operation IDs after reveal:** revealed `individuals` spread each person's saved combined list, including `ready.operationId` (`workflow.js:214` with `workflow-service.js:559`). Add `individuals[].ready` to the projector's removal list: drop it, or keep only `combinedVersion`.

### L6 — Low: Admin can't repair a bad old setting

**Evidence:** if the new key is missing and the old setting is malformed, `readDefaultFacilitator` throws 503 (`config.js:17-23`). That happens before the Admin GET runs (`service.js:1016`), so Admin cannot repair it.

**Correction:**
- Apply the addendum's "limited error, still repairable" rule to this case too.
- Admin GET always returns the new-key revision, and a missing-key marker when there is none, even when configuration is invalid.

### L7 — Low: restarting a v2 round that has no stored set

The addendum (`:70-71, :74-75`) doesn't say what the successor round stores when an older v2 round without `facilitation` is restarted.

**Correction:** the successor writes `facilitation: { version: 1, systemUserIds: [old round's facilitator] }` explicitly, rather than having no set.

## Summary

The addendum is concrete and consistent for v2 privacy, the two-facilitator set, actor attribution, atomic commits and stale clients. It matches the source on the points it calls verified. Before implementation starts, it needs H1, M1, M2 and M3 written in. L1–L7 can go in as small clarifications in the same edit. Production release stays separately gated, as the addendum says. I changed no files.

## Author disposition

All findings were checked against source before updating the addendum:

| Findings | Plan correction |
|---|---|
| H1 | Facilitator-as-participant must retain own list save/submit/readback; legacy UI and transfer copy explicitly included. |
| M1 | Publication is the v1 reveal point. Entire draft meeting/composite content remains private, rather than only stripping named ranks. Generate/Publish uses safe status/capability metadata. |
| M2 | Present new setting plus disabled v2 creation refuses new v1 preview/open; existing v1 operation continues. Configure at deliberate cutover. |
| M3 | All configured members must pass enabled/profile/grant checks at preview/open; no silent member removal. |
| L1 | Configuration captured at open's fresh read, with source-key revision/provenance and both race orderings specified. |
| L2 | Two approved mapped sandbox personas replace singleton rehearsal fixture; no invented IDs or production setting reads. |
| L3 | Wrong/unknown stored versions reject with explicit unsupported-version response on reads, mutations and supplements. |
| L4 | Expanded scalar consumer search; new v2 snapshots omit obsolete scalar field. |
| L5 | Nonparticipant superuser readiness explicitly allowed; other actors' ready/operation metadata removed from revealed/history projection. |
| L6 | Admin can repair invalid legacy fallback, retaining missing-key marker and new-key revision. |
| L7 | Restart explicitly materializes legacy-round singleton membership in successor workflow. |

## Follow-up review

**Verdict: READY WITH NAMED CHANGES.** All eleven findings are resolved. One detail of the conservative M1 choice clashes with the candidate source, and it needs two short additions to the addendum. I made no edits and called no external services.

## Resolution status

| Finding | Status | Where in the addendum |
|---|---|---|
| H1: facilitator loses their own v1 list | Resolved | `:157-163`. Every roster participant sees `ownList`. The facilitator panel shows readiness only. The transfer wording is updated. The Justin-as-facilitator-and-PD save/submit/readback test is in slice 4 (`:236-237`). |
| M1: draft composite shown before publication | Resolved, with one gap (below) | `:148-155`. Publication is the reveal point. `meeting` is null before then. The negative tests are at `:235-238`. |
| M2: v1 creation vs the new setting | Resolved | `:107-112`. v1 or v2 is chosen at open by the single `PROPOSAL_RANKING_WORKFLOW_V2` flag (`service.js:529`). So "new key present and v2 off → 409 `configuration_requires_v2`" covers the gap. A malformed key gives the configuration error. The old scalar applies only while the new key is absent. |
| M3: facilitator who later becomes ineligible | Resolved | `:94-98`. Every member is checked at preview and open, failures are named, and nobody is dropped silently. Restart does not re-check. |
| L1: Admin save racing an open | Resolved | `:100-105`, `:67`, `:74-75`. Open uses the configuration from its own read. Both race orderings are tested. Which key was used and its revision go into the fingerprint and the stored round data. |
| L2: single-facilitator rehearsal setup | Resolved | `:224-228`. Uses two existing approved sandbox personas under the existing test-policy guard. Bad test configuration fails closed and production settings are never read. |
| L3: v2 actions on a v1 round | Resolved | `:168-172`. Returns 409 `unsupported_version` before loading or writing. Unknown versions are handled the same way. |
| L4: incomplete search list | Resolved | `:72-73` and `:266-269`. The search now includes `facilitatorSystemUserId`, `readDefaultFacilitator` and `round.facilitator`. The snapshot field is left out on v2. |
| L5: superuser readiness and others' operation IDs | Resolved | `:130` (non-participant superuser gets readiness-only `progress`) and `:144-146` (`individuals[].ready` is removed). |
| L6: Admin can't repair a bad old setting | Resolved | `:57-60` |
| L7: restarting a v2 round with no stored set | Resolved | `:77-79`. The successor stores an explicit singleton with source `legacy-round`. |

## Remaining blockers

### B1: Generate/Publish can't run without a meeting-list ETag

**Evidence:**
- `generate` and `publish` both require the meeting list's `etag` (`service.js:36, 38`), which the server checks at `service.js:750`.
- The client gets it only from the meeting payload: `onGenerate`/`onPublish` stop early `if (!meeting)` and send `meeting.etag` (`ProposalRankingApp.js:762-765, 771-774`).
- With `meeting: null` before publication (`:150`), the buttons appear but do nothing. The addendum keeps "safe meeting status/readiness/confirmation metadata" (`:153-154`) but doesn't say that includes the ETag.

**Change:** add to §3 something like: "Before publication, the facilitator receives a meeting control handle `{ listKey, status, etag, version }` (or `meetingStatus` plus `meetingEtag`). It has no order, totals, composite, owner or timestamps. `onGenerate`/`onPublish` use this handle, not `meeting`." Add a slice-4 test that Generate and then Publish succeed from the handle alone. Re-run the sentinel check against the handle.

### B2: Editing the draft before publication is left undefined

**Evidence:**
- Today the facilitator can `edit` a `composite-draft` order (`service.js:751-753`).
- `editMeetingOrder` is true for any facilitator in an active round (`service.js:346`).
- The UI enables editing for `composite-draft` (`ProposalRankingApp.js:248`).

Once the draft is hidden, editing it would be blind. The addendum doesn't say whether that path stays, goes, or is refused.

**Change:** state in §3 and §4 something like: "In the compatible release, `edit` on a `composite-draft` v1 meeting list returns 409 `invalid_transition` without writing. `editMeetingOrder` is false until the program is published. Edits after publication keep their existing facilitator/participant rule (`service.js:754-757`)." Add the refusal to the v1 status-combination tests. If the owner wants the facilitator to adjust the order before revealing it, that contradicts "publication is the reveal point" and would need a fresh owner decision, so the refusal is the consistent choice.

## Not blockers

- Conflict and confirmation-stale responses for `generate`, `publish` and `edit` go through `getRoundResponse`/`buildRoundResponse` (`service.js:776, 806`). The M1 projection therefore already covers `error.current` with no extra wording.
- The generate and publish confirmations carry only readiness names and a fingerprint (`service.js:316-329`). That fits the M1 rule.
- Production checks, sandbox races and the cutover decision are correctly held back for later (`:239-243`, `:252-260`). I'm not asking for them as part of the plan.

Once B1 and B2 are written in, the plan is ready to implement. Neither needs a redesign.

## Final disposition and verification

Follow-up also ran as claude-opus-5-5 with no permission denials. B1 and B2 were
confirmed against candidate service and UI source and incorporated: a four-field
meetingControl DTO carries the meeting-list ETag for Generate/Publish without
exposing the draft; pre-publication draft edit returns 409 with no write. Added
acceptance cases for both and for mixed program states. No third review was run.

Opus's final verdict is conditional READY WITH NAMED CHANGES, not an unconditional
review of the final bytes. The author completed its two named changes. The plan
is ready for implementation; runtime implementation, persisted race tests and
production cutover approval remain pending. No product/runtime file changed.
