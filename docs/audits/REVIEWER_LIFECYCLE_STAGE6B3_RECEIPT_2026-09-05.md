---
title: Reviewer Lifecycle Stage 6B3 — Materials-Release Modal Session and Completion Ownership
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
related:
  - docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md
---

# Stage 6B3 implementation receipt

Branch: `codex/reviewer-lifecycle-stage6b`. Base for this slice: `489e07f2` (6B2 complete and
documented). Runtime is frozen at `a6a27ce8`; the review-driven correction is `b163172a`, the slice's final runtime commit.
Orchestrated by Claude (Fable) with a Sonnet builder owning the `ReleaseMaterialsModal` region,
the panel's selection setters and call site, and the new test file, and an Opus fresh-context
reviewer. Reviewer context: native Claude Code subagent, model Opus, label "Independent review
of Stage 6B3", 2026-09-05, reviewing frozen `a6a27ce8` and then `b163172a`.

## Surface and preimplementation invariants (contract-reconcile Mode B)

Change: session identity, stale-outcome suppression and the completion handshake for the nested
materials-release modal in `shared/components/reviewers/ReviewerManagePanel.js`. Entry: the
"Release proposal to reviewers" button, the modal's Preview/Send/Save Template/upload controls.
Persistence: none new. Routes unchanged: render-emails, send-emails (SSE), load-proposal,
release-settings, materials-preflight, upload-handler, the email-template store. Consumers:
compose/preview/sending/sent UI, drafts, sent summary, error banner, attachments and their
localStorage mirror, proposal document, the panel's selection and `onRefresh`, tests.

| Invariant | Files touched | Verification |
|---|---|---|
| Session identity is open state + request + sorted selected-membership key + mounted; any change bumps the monotonic epoch; returning never revives | modal session ref, one no-deps layout effect, unmount cleanup | deferred preview/send/upload/proposal/save × request switch, membership change, close/reopen, unmount, A→B→A |
| A new session resets drafts/results/error/step to compose and aborts the active render; same-membership object churn does not. [Corrected by review REQUIRED-1: proposal loading is invalidated by open/close, request change and unmount only, never by a membership-only change] | same | fresh reviewer objects with the same ids keep a preview in progress |
| Preview single-flight, snapshot-before-queue, tail serialization, per-render controller and timeout are untouched | handlePreview core unchanged | existing preview-retry pins green and unmodified |
| Every stream read and event is checkpointed; after `complete` the attempt is finished and later events have no effect | handleSend | duplicate complete → one callback; trailing error → summary and step unchanged |
| The completion summary comes from the attempt's own accumulated stream data | local accumulator | result+complete in one chunk; mixed and all-failed results survive |
| Only the exact prior-membership→empty transition tagged by the finished attempt's one-use cause is exempt from the session reset | panel `selectionCauseRef` + `onEmailsSent(cause)` + modal session effect | real parent: summary intact after the clear; external clear before complete, toggle after complete, reused cause, close/reopen all invalidate |
| `onRefresh` arguments and count unchanged; `onEmailsSent` gains only the local cause | call site | onRefresh once, no args |
| Upload lock released by attempt identity regardless of epoch; stale attempts write no attachment, localStorage or error and start no further file | handleFileUpload | second file never started after session loss |
| Save-template feedback and its timer are session-owned; the saved preference is never reverted | saveTemplate | late resolve after session loss: no feedback flip; timer cleared on unmount |
| No server file, SSE change, send retry, new send lock, payload rewrite or modal relocation | diff | `git show --stat`; payload-shape test |

### Lifecycle and provenance trace (orchestrator, pre-build)

Line citations refer to the `489e07f2` baseline.

Axis 1 — lifecycle. `modalSessionRef` (`:590`) was bumped only by the `[isOpen]` effect
(`:600–618`); request or membership changes and unmount did not bump it, and there was no unmount
cleanup, so a pending send could still call `onEmailsSent` (`:1040`) into a still-mounted parent
after the modal unmounted on permission loss. Preview (`:832–905`) already captured the epoch
and checked it before queued work, after fetch and JSON, in catch and in the double-epoch
finally; abort on session end lived only in the isOpen effect. Send (`:936–1058`) checked the
epoch after fetch and after every `reader.read()` but had no finished state: a duplicate
`complete` or a trailing `error`/`result` could rerun completion or replace the summary, and
`sentResults` existed only as React state. The parent's completion callback (`:2546`) cleared
selection, which under a membership-aware session would have reset the just-completed summary.
Proposal loading (`:664–735`) was sequence-guarded but not invalidated on unmount. Save-template
(`:778`) set feedback and a 1.5 s timer with no ownership. Upload (`:790–799`) had no checkpoint
and wrote attachments and localStorage unconditionally. Parent selection setters: `:1805`
(request/mode reset), `:1839/:1841` (select all/none), `:1846` (toggle), `:2322` (release
button), `:2546` (completion clear); `selectedList` (`:1825`) is a fresh array every render.

Axis 2 — contracts, unchanged. render-emails: POST `{suggestionIds, templateType, template,
settings}`. send-emails: POST `{drafts[], templateType, attachmentUrls, markAsSent:true}`;
non-2xx JSON `{error|message}`; 2xx SSE `progress`, `email_sent`, `email_failed`, `result`,
`complete`, `error` (`pages/api/review-manager/send-emails.js:25–27`). `complete` is not proof
that all recipients succeeded; `result` carries the final arrays; failed rows continue the loop.

## Implemented contract
[VERIFIED via `git show a6a27ce8` and `git show b163172a`] `ReviewerManagePanel.js` +256/−37 at `a6a27ce8` (one deletion plus a comment at `b163172a`) and the new
`tests/unit/reviewer-materials-modal-lifetimes.test.js` (26 tests). No server, host, reminder,
closeout, 6B1-registry or status-handler line changed.

- One `useLayoutEffect` with no dependency array reconciles the committed session (open state,
  request id, sorted membership key) and replaces the old `[isOpen]` effect. A change bumps the
  existing `modalSessionRef` (kept as the single epoch), aborts the active render and, when open, resets step to compose, drafts, results, error, preview
  and upload flags, template-saved feedback and its timer. A separate `[]` effect's cleanup does
  the same invalidation on unmount and sets a mounted flag false. Permission loss is unmount
  here because the modal renders under `canManage &&` and both hosts fold `previewReadOnly`
  into `canManage`, so unlike the 6B2 closeout modal no permission props are passed.
- Completion handshake: `handleSend` keeps a local results accumulator fed by `email_sent`,
  `email_failed` and `result`. On `complete` it marks the attempt finished, commits the final
  arrays and step `sent`, records `{token, session, requestId, priorKey}` as the last finished
  attempt, calls the latest committed `onEmailsSent(cause)` in its own try (thenable rejection
  observed, not awaited), then leaves the read loop and cancels the reader with the rejection
  observed. Once finished, no further event or caught error changes the summary or step.
- The panel stores the cause in `selectionCauseRef` synchronously before clearing selection,
  clears it in every other selection setter (request/mode reset, select all/none, toggle, the
  release button), and passes it to the modal as `membershipCause`. The modal exempts a
  committed transition only when it is prior→empty with open state and request unchanged, the
  cause is the unconsumed last finished attempt with matching token, session, request and prior
  key; it then marks the cause consumed. Every other change invalidates and discards the cause.
- Upload checkpoints after the dynamic import, after each upload, before the next file, in catch
  and finally; `isUploading` is released by attempt identity regardless of epoch and only while
  mounted; stale attempts skip attachment, localStorage and error writes and start no next file.
- Save-template guards the feedback and timer by session and mounted state, owns the timer in a
  ref, and never reverts the persisted preference. `saveTemplate` became a plain function (it is
  only an onClick handler) and `templateSaved` state moved above the session effect.
- Payload shapes, the SSE handling of each event, preview single-flight, tail serialization,
  controller and timeout, confirms and copy are unchanged. One `eslint-disable` on the no-deps
  session effect (exhaustive-deps) and one on the render-time ref read at the call site
  (`react-hooks/refs`), both explained inline.

## Red-before-code evidence
- Baseline nine-suite selection at `489e07f2`: 9 suites / 953 tests (builder-run).
- New file against unchanged runtime: 13 of 26 failed, 13 passed (reviewer-measured; the builder reported 12 / 14; the passing cases are the current-context cases).
- Builder guard removals in the working tree, each restored byte-identical:
  (a) membership key removed from the session comparison → 9 assertion failures;
  (b) old-finally double epoch check reduced to a single check → 0 (structural with the current
  guards; retained as defense in depth, same class as 6B1 REQUIRED-1 and 6B2 mutation (c));
  (c) prior-key binding removed from cause consumption → 0 (structural: the invalidation branch
  nulls the last finished attempt before any exemption field is compared, the same shared reason
  the reviewer found for the session and consumed checks; all three retained as defense in depth);
  (d) finished guard neutralized → 2; (e) post-upload checkpoint removed → 2; (f) unmount
  cleanup emptied → 2. All assertion failures, no crashes.

## Verification
[VERIFIED via orchestrator-run commands at frozen `b163172a`; the log records HEAD at start and end. The earlier full run at `a6a27ce8` was also 772 / 11,301.]

| Command | Result |
|---|---|
| ten-suite UI selection (plan's eight plus 6B1 lifetimes plus the new file) | 10 suites / 979 tests pass |
| `npm test -- --runInBand --watch=false` | 772 suites / 11,301 tests pass |
| `npm run check:types` | pass |
| `npm run lint` | 0 errors, 76 warnings repo-wide (pre-existing set; the panel keeps nine, the old isOpen effect's warning replaced by the session effect's) |
| `git diff --check` | clean |
| `npm run build -- --webpack` | pass; no generated file changes in `git status` |
| Gate pairs, serial: dataverse-access-layer, route-service-boundary, dynamics-context-boundary, api-routes, route-lifecycle-auth, trust-boundary-guid, status-enum-parity | all 14 pass |

## Independent review
Reviewer: fresh-context Opus subagent (native, subscription path; no metered product),
read-only against frozen `a6a27ce8`, contract-reconcile Mode A. It verified HEAD and the clean
tree at start and end, waited for the orchestrator's full-suite log to reach `DONE` before any
mutation, and read the plan, the trace, the 6B2 receipt, both hosts, the send-emails route and
service, and the whole diff.

Commands actually run at `a6a27ce8`: the ten-suite selection (10 / 979 pass); the new file
against the `489e07f2` runtime (13 failed / 13 passed; the builder had reported 12 / 14);
eslint on both files (0 errors, 9 warnings); disposable probes for an orphaned proposal load,
StrictMode mounting, and same-chunk duplicate completion; and the guard-removal matrix below.

| Mutation | Failures |
|---|---|
| (a) membership key removed from the session comparison | 9 |
| (b) preview finally double-epoch check reduced to one | 0 across the new file and the three materials suites (pre-existing, untouched by 6B3; the plan's expectation of a failure here was never real) |
| (c) prior-key, (g) session and (h) consumed checks in the completion exemption | 0 each, one shared reason: the invalidation branch nulls the last finished attempt first (defense in depth) |
| (d) `while (!finished)` → `while (true)` | 0 (inner break and stream end still terminate); (d′) `finished = true` removed → 2 |
| (e) post-upload checkpoint | 2 |
| (f) unmount cleanup emptied | 2 |
| (i) same-chunk `if (finished) break;` | 0 before correction, though the probe under that mutant showed onRefresh twice, a late error banner and a lost summary |
| (j) checkpoint after the dynamic import, (k) unmount `proposalLoadSeq` bump | 0 (unobservable: no test invalidates during the import; setState after unmount is a React 18 no-op) |

Findings and disposition:
- REQUIRED-1 (runtime regression): the session effect bumped `proposalLoadSeq` on every session
  change, so a membership-only change during a pending load orphaned a valid document: the
  probe showed a stuck loading spinner, no attachment, Preview still enabled and the send
  omitting the proposal, while the baseline recovered. The shipped test pinned that wrong
  invariant. Corrected in `b163172a`: the bump is removed from the session effect (open/close,
  request change and unmount still invalidate), and the test is inverted to assert the document
  lands; reintroducing the bump fails exactly that test.
- ADVISORY-2: the same-chunk finished guard had no pin. Corrected in `b163172a` with a one-chunk
  `result` + `complete` + `complete` + `error` test (onRefresh once, summary intact, no banner);
  neutralizing the guard fails it.
- ADVISORY-3: two tests had no assertions and one passed for the wrong reason. Corrected in
  `b163172a`: unmount-during-send asserts `onRefresh` is not called; unmount-during-preview
  asserts the render fetch's abort signal fires and a fresh remount is a clean compose; the
  unmount-during-proposal-load test was dropped because `loadProposal`'s three continuations
  contain only `setProposalDoc`, so nothing observable remains after unmount (verified by the
  reviewer from source; recorded below for 6C).
- Accepted limit (D3): the plan-mandated reset to compose during an in-flight send. The reviewer
  traced `send-emails-service.js:570–590`: a second materials send for a row already stamped or
  in an already-delivered status is refused before token mint or dispatch and reported as
  `skipped` with `materials_already_sent`, which the modal renders. Residue: two overlapping
  requests that both hydrate recipients before either stamps can both dispatch (pre-existing,
  two-tab class), and the suppressed `onRefresh` leaves the roster showing accepted until the next refresh.
- Verified: D2 (permission loss is unmount; both hosts fold `previewReadOnly` into `canManage`);
  the completion handshake cannot be spoofed by an untagged empty, a reused or foreign cause
  (Symbol token; the attempt ref is nulled on any non-exempt change); the ref read at render is
  sound because every cause write is paired with a fresh Set state update; StrictMode is benign
  because the layout effect commits before the passive auto-load captures its sequence (fragile
  if the session effect were ever changed to a passive effect); send loop, accumulator, cancel
  observation, upload lock, saved-preference non-reversion, preview core untouched, scope clean.

**Verdict at `a6a27ce8`: BLOCK** on REQUIRED-1.

Narrow re-review of `b163172a` by the same reviewer (HEAD verified; waited for the fresh
full-suite `DONE`): two files, panel hunk confined to the session effect; new file 26/26;
ten-suite 10 / 979; mutations reproduced exactly (membership key 8, `finished = true` 3, upload
checkpoint 2, unmount cleanup 4, same-chunk break 1, bump reintroduced 1; unmount seq bump
removed 0, confirming the dropped test's premise); the orphaned-load probe now lands the
attachment; a request switch during a pending load discards the stale document and lands the
new one. The reviewer corrected one premise in the request: Preview is offered while a proposal
load is still pending, at baseline and now; 6B3 removed the silent orphan and added no gating.
**Verdict: PASS for Stage 6B3 at `b163172a`. Stage 6C and later are not approved.**

Reviewer limits: jsdom only; full suite, build and gates orchestrator-run; hosts read, not
browser-verified.

## Audit and operational limits
- The guarantee is per mounted modal instance; other tabs, remounts and server-side state remain outside it.
- Plan-mandated visible state: an external membership change or request switch while a send is in flight returns the modal to a fresh compose and suppresses the send's later events; the server keeps sending. The user can start a second release from that compose. Bounded server-side: `send-emails-service.js:570–590` refuses a second materials send for an already-delivered row before dispatch and reports it as skipped. Residue: overlapping requests that both hydrate before either stamps (pre-existing), and a roster that shows accepted until the next refresh because the suppressed completion never calls `onRefresh`.
- A request switch while the modal is open keeps it open for the new request with a fresh compose (`releaseModalOpen` is not request-keyed); pre-existing, unchanged.
- Callback promises are observed, not awaited (6B2 precedent); no post-close refresh-failure surface exists.
- Preview and send are offered while a proposal document is still loading, so a race omits the attachment; pre-existing at `489e07f2`, unchanged, outside 6B3.
- Advisory not acted on: a request switch during a pending proposal load is covered by the reviewer's probe, not by a shipped test (the shipped request-switch tests cover preview and send). Candidate for the next test pass.
- Note for Stage 6C: the unmount `proposalLoadSeq` bump has no discriminating assertion as long as `loadProposal`'s continuations are setState-only; if extraction adds an abort controller, an external callback or a storage write there, pin it.
- Structural zeros retained as defense in depth: the preview finally double-epoch check (pre-existing, unpinned anywhere), the prior-key/session/consumed checks in the completion exemption, the post-import upload checkpoint.
- The `email_unconfirmed` stream event exists in the service vocabulary with no modal branch; pre-existing, not investigated.
- No browser/live probe, deployment or human UAT ran for this slice. Nothing is merged to `main` or deployed; promotion is a separate, deliberate action under the release strategy.

## Amendment 6B3a — settings folded into the session identity (2026-09-05)

Origin: Codex adversarial review of `b163172a` (codex-companion `adversarial-review`, base
`489e07f2`, verdict needs-attention, one medium finding): "Membership-only identity fails to
invalidate changed recipient/context data ... a commit that keeps the same selected reviewers
but changes their display/contact data or request settings does not create a new session ...
the user can therefore review and send a draft rendered with stale deadline/signature/context
after those props changed." The orchestrator verified the mechanism is pre-existing and was
what the plan's identity definition specified; the owner chose to widen the identity rather
than record it as a limit.

Disposition of the two halves: the settings half is fixed below. For the recipient-data half,
the destination address is re-resolved server-side at send (`send-emails-service.js:340–354`,
`:498` uses the hydrated person's email, never the draft's `candidateEmail`) [VERIFIED by the
reviewer], so a stale address cannot reach an email. The rendered subject and body are NOT
re-resolved: render-emails expands the recipient name into the draft
(`render-emails-service.js:195,323–335`), the PD may edit the draft in the preview textarea,
and send transmits that body verbatim (`send-emails-service.js:773,871–875`). A reviewer-name
change in Dataverse between preview and send therefore reaches the greeting with the old name.
A second Codex adversarial review (thread `01a07442-4ee5-7922-9e01-85483df26d73`) caught this
receipt's earlier overstatement that stale display data "cannot reach an email"; the earlier
sentence was wrong and is replaced here. The panel's `reviewer.name` is the same Dataverse
`wmkf_name` field the render uses (`reviewers-service.js:300`), so a by-value name key would be
a faithful proxy if the owner chooses to widen the identity again. Owner disposition: widen the identity again (amendment 6B3b below).

Implemented at `3a4bcbbe` (`ReviewerManagePanel.js` +64/−16 inside `ReleaseMaterialsModal`,
test file +176; no other file):
- The session key adds `signature` and `reviewDueDate` compared by value (joined with U+0000),
  the only two `settings` fields render consumes (`snapshotSettings`); never the `settings`
  object identity, which the panel rebuilds every render, and never other host keys.
- The completion exemption additionally requires the settings key unchanged.
- Follow rule: when the committed due-date default changes, the due-date field moves to the
  new default only if it is empty or still equals the prior default; a customized (or
  localStorage-restored) value is kept. Without this the widened key would reset drafts but the
  re-render would still carry the stale date, because the field wins over the prop.
- `0a4eafd6` adds the reviewer's advisory test: a null `reviewDeadline` (ReviewersTab nulls the
  proposal on a reviewers-fetch failure) keeps the due-date input controlled and empty;
  removing the `|| ''` normalization fails exactly that test.

Red-before-code: the six new tests against the `8c29e67d` runtime: 5 failed / 1 passed
(reviewer-measured; the passing case is the same-value fresh-object non-regression guard); no
pre-existing test changed status.

Verification at `3a4bcbbe`/`0a4eafd6` (orchestrator-run, HEAD logged at start and end): full
suite 772 suites / 11,307 tests; `check:types` pass; lint 0 errors, 75 warnings (pre-existing
set); webpack build pass with no generated changes; `git diff --check` clean; seven gate pairs (dataverse-access-layer, route-service-boundary, dynamics-context-boundary, api-routes, route-lifecycle-auth, trust-boundary-guid, status-enum-parity) all pass with self-tests, run serially.

Independent review: fresh-context Opus subagent (native, subscription path), frozen `3a4bcbbe`,
md5-verified before and after every mutation, waited for the full-suite `DONE`. Seven-suite UI
selection 7 / 513 pass. Guard removals: settings key out of the comparison → 4 failures (a, b, c,
e); follow rule deleted → 1 (b); settings check out of the exemption → 1 (f); the reviewer's own
mutations: empty-field clause of the follow rule → 0 (display-only; the render already falls
through to the prop when the field is empty), `|| ''` normalization → 0 before `0a4eafd6`, 1
after. Test (f)'s host-component pattern was confirmed discriminating (the exemption is taken
in the same commit under the mutant). Trace claims confirmed, with one correction: the
`{signature}` object originates in `pages/workbench/[requestId].js:121–124`, passed through
`ReviewersTab.js:546`. Lifecycle audit of the follow rule across first commit, localStorage
merge ordering, open/close, request switch and same-value churn found no defect.
**Verdict: PASS at `3a4bcbbe`, no required items.**

Further accepted limits: a signature or deadline change during an in-flight send resets to
compose like a membership change (same server-side bound); a deadline change while the PD has
customized the field still clears drafts although the render would be identical
(over-conservative); the global localStorage due-date key means a restored value reads as
customized (pre-existing, unchanged).

## Amendment 6B3b — recipient fields folded into the session identity (2026-09-05)

Origin: the second Codex adversarial review above (medium: "Recipient display data can remain
stale in the email body"). The orchestrator first recommended recording it as a limit on the
grounds that the PD previews the body; the owner asked why, and on re-weighing that argument
applied equally to the signature and deadline already fixed in 6B3a, so the owner chose to fix.

Implemented at `9a790c64` (`ReviewerManagePanel.js` +67/−17; test file +153 then trimmed;
`529ee426` adds one advisory test): a module-level `membershipKeyFor(reviewers)` helper builds
each selected reviewer's string from suggestionId, name, email and affiliation (U+0000 between
fields, rows sorted, U+0001 between rows; separators built at runtime, no control bytes in the
source), and the session effect uses it for the membership key. `handleSend` already captured
`priorKey` from the committed context, so there is one computation site. Provenance
[VERIFIED by the reviewer]: the panel row and the render read the same Dataverse person object
(`reviewers-service.js:286–301`, `render-emails-service.js:278–282`), so email and affiliation
are the same values; name is a strictly finer proxy (the render whitespace-normalizes it, so a
raw-equal name is always render-equal). The render's candidate has no expertise field, so
`recipientExpertise` is always empty on this path and there is nothing to key on.

Completion exemption: a recipient change landing with or after the post-send selection clear is
unobservable by construction (the modal's `reviewers` prop is empty, so the key is `''`; the
send has completed and the summary describes what was sent). A vacuous test asserting this was
removed and replaced by a comment; the reviewer confirmed no discriminating test can exist.

Red-before-code: the three new tests against the `11ac925c` runtime: 3 failed / 0 passed
(reviewer-measured); no pre-existing test changed status.

Verification at `9a790c64` (orchestrator-run, HEAD logged start and end): full suite 772 suites /
11,311 tests; `check:types` pass; lint 0 errors, 75 warnings; webpack build pass with no
generated changes; `git diff --check` clean; the same seven gate pairs pass with self-tests.
`529ee426`: single file 37 / 37; removing `.sort()` from the helper fails exactly the new test.

Independent review: fresh-context Opus subagent (native, subscription path), frozen `9a790c64`,
md5-verified before and after every mutation, waited for `DONE`. Seven-suite selection 7 / 517.
Guard removals: name → 1 (name test), email → 1, affiliation → 1, `priorKey` recomputed as the
old id-only join → 9 (all completion-handshake tests; the one survivor, the external clear before
`complete`, is legitimately independent of `priorKey`; the builder had reported 10 before the
vacuous test was removed). The reviewer's own mutation, `.sort()` removed → 0 at `9a790c64`,
pinned by `529ee426`. Trace claims confirmed except the orchestrator's affiliation-proxy claim,
which the reviewer refuted (same person object on both sides). ReviewersTab's fetch-failure path
renders `[]` rows and resets the session; pre-existing with the id-only key.
**Verdict: PASS at `9a790c64`, no required items.**

Further accepted limits: the client observes only recipient changes the panel has refetched; a
Dataverse edit between the last refetch and send is invisible to any client-side key. The
rendered body's PROPOSAL-derived fields (title, abstract, PI, institution;
`render-emails-service.js:288–297`) are keyed by requestId only, so an abstract edit after a
preview leaves the same class of stale-body exposure for those fields (reviewer advisory 7,
pre-existing, not addressed here; recorded for the owner).

## Amendment 6B3c — proposal fields folded into the session identity (2026-09-05)

Origin: third Codex adversarial review (thread `01a0745b-1c18-78b3-802e-dbb550c6c92c`, medium:
"Proposal edits can still send a stale preview body"; it asked for a defensible boundary or
explicit product approval). Owner decision: key on the proposal fields the panel carries now
(this amendment) and queue a server-side draft fingerprint as Stage 6D for co-investigators and
edits the panel has not refetched, rather than accept the exposure as a product limit.

Implemented at `2622dfc7` (`ReviewerManagePanel.js` +62/−21; test file +166): module-level
`proposalKeyFor(proposal)` over `proposalTitle`, `proposalAbstract`, `proposalAuthors`,
`proposalInstitution` (null-safe, `|| ''`, U+0000 separator built at runtime); the call site
passes the string as `proposalKey`; the modal stores it in the session context, includes it in
`changed`, requires it unchanged in the completion exemption and updates it on invalidation. A
follow-up commit corrects one comment ("fourth" → "third" Codex review).

Provenance [VERIFIED by the reviewer]: both panel construction sites
(`reviewers-service.js:240–244,268–272`) and the render (`render-emails-service.js:288–301`)
read the same Dataverse columns; title, abstract and institution match exactly (institution
differs only by `.trim()`), authors is a safe-direction proxy (panel falls back to the applicant
and keeps honorifics; render is PI-only and strips them), so every render-visible change flips
the key and the only spurious resets are harmless. The follow-up host spreads the reviewers-API
entry first, so the abstract is present there, and it mounts the panel only when that entry
exists. Co-investigators appear nowhere under `shared/` or `pages/`, so the deferral to 6D is
correct. The abstract is editable in-app (`update-abstract-service.js`), so the closed path is
reachable, not theoretical.

Red-before-code: 5 of the 6 new tests failed against the `086cffee` runtime; the same-value
fresh-object case passed, as intended; no pre-existing test changed (reviewer-measured).

Verification at `2622dfc7` (orchestrator-run, HEAD logged start and end): full suite 772 suites /
11,318 tests; `check:types` pass; lint 0 errors, 75 warnings; webpack build pass with no generated
changes; `git diff --check` clean; the seven gate pairs pass with self-tests.

Independent review: fresh-context Opus subagent (native, subscription path), frozen `2622dfc7`,
md5-verified, waited for `DONE`. Eight-suite selection 8 / 536. Guard removals: proposalKey out of
`changed` → 4; out of the exemption → 1 (test f, so the exemption check is discriminating);
abstract out of the helper → 2; authors → 1; title → 1; institution → 1; the context store line
deleted → 43 of 43; separator join replaced by `''` → 0 (no boundary-collision test; same posture
as `membershipKeyFor`). **Verdict: PASS at `2622dfc7`, no required items.**

Known fail-safe edge (reviewer advisory 4): when ReviewersTab's refetch errors it nulls the
proposal and the panel falls back to a synthetic proposal without abstract/authors/institution,
so an erroring refresh right after a completed send now flips the key and shows a fresh compose
instead of the sent summary. Pre-existing for the settings key whenever the deadline was
non-null; 6B3c widens it to the null-deadline case. Nothing stale can be sent.

Remaining limits for Stage 6D: co-investigators are not observable client-side; any body input
edited between the panel's last refetch and send is invisible to a client key.

## Amendment 6B3d — ReviewersTab keeps the same-request proposal on a refetch error (2026-09-05)

Origin: fourth Codex adversarial review (thread `01a0746b-f8c2-7be3-8130-f6105632dd60`, medium:
"Transient ReviewersTab refetch errors discard the confirmed send summary"). The 6B3c reviewer had
flagged the same edge as advisory 4; the third Codex pass showed it was a user-visible loss of a
confirmed summary that 6B3c widened, so it was fixed rather than recorded.

Implemented at `be76760f` (`ReviewersTab.js` catch block only; two host test files) with the
case-fold correction at the follow-up commit: on a refetch error the tab keeps the last committed
proposal when its id matches the failing request (GUIDs compared case-insensitively, because the
URL param may be mis-cased while Dataverse returns lowercase), still shows the load-error banner,
and still drops a proposal that belongs to another request. [VERIFIED by the reviewer] `proposal` is
set only on success and in this catch; no request-change reset exists, so request-switch semantics
are unchanged; `loading` clears in `finally` on both paths.

Tests: a full integration test through the real ReviewersTab, panel and modal (SSE `result` +
`complete`, then a failing refetch) asserts the "1 sent" summary stays and the banner shows; the
stub of `ReviewerManagePanel` in that file was removed and the reviewer confirmed no pre-existing
assertion weakened (the other tests never mount the panel). A stale-request test pins the
same-request guard (A loads, B fails → A's rows gone) and a third pins the case-fold (upper-cased
URL, lowercase API id, same-request failure → rows kept).

Red-before-code: the integration test fails against the `7ceca3a7` host at the summary assertion
after the banner appears (reviewer-measured 1 failed / 9 passed); the guard test passes on base by
design as a mutation pin.

Verification at `be76760f` (orchestrator-run): full suite 772 suites / 11,320 tests; types; lint 0
errors, 75 warnings; webpack build with no generated changes; `git diff --check`; seven gate
pairs with self-tests. The case-fold commit: both host files 11 / 11; reverting the case-fold
fails exactly the new test.

Independent review: fresh-context Opus subagent, frozen `be76760f`, md5-verified, waited for
`DONE`. Six-suite selection 6 / 108. Mutations: `setProposal(null)` restored → integration test
fails; guard dropped → stale-request test fails (request A's row leaks); guard inverted → both new
tests fail, nothing else. The reviewer also found the fix removes a base-only sub-tab jump (a
same-request error recomputed the default sub-tab from an empty list). **Verdict: PASS at
`be76760f`, no required items.**

Accepted limits: after a real removal followed by a failed refetch the removed row stays visible
with the banner until the next successful refresh (base showed no rows with the banner; removal
is a soft delete server-side, pre-existing); there is no automatic retry. Out of scope and
pre-existing: `pages/workbench/reviewer-follow-up.js` empties its proposal list on a refetch
error, which unmounts the panel and the modal entirely on that host, so the same finding survives
there in a worse form; recorded for the owner.
