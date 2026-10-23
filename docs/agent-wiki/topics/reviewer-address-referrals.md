---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Address Evidence and Referrals"
source_files:
  - pages/api/workbench/decline-referrals.js
  - lib/services/workbench/decline-referrals-service.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - shared/utils/decline-referrals.js
  - lib/services/reviewer-address-trust-service.js
  - lib/services/reviewer-candidate-attestation.js
  - lib/utils/reviewer-vetted-email.js
canonical_docs:
  - docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
watch_paths:
  - pages/api/workbench/decline-referrals.js
  - lib/services/workbench/decline-referrals-service.js
  - lib/services/reviewer-address-trust-service.js
  - shared/utils/decline-referrals.js
update_triggers:
  - "Referral capture or referral disposition changes"
  - "Address evidence, trust, conflict, or promotion rules change"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "427-632"
  - "1254-1350"
---

# Reviewer Address Evidence and Referrals

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 427-632 -->
## Decline-referral surface + one-click add (S349)

When a reviewer declines via the external portal, the current form collects up
to four structured Name / Institution / Email rows and stores a versioned
envelope in `wmkf_declinereferral` on the suggestion row. The reader keeps
legacy free-text values visible, so no existing referral is lost. Until S349
**nothing read this field** — suggested names sat unseen.

- **Reader:** `GET /api/workbench/decline-referrals?requestId=` →
  `lib/services/workbench/decline-referrals-service.js` (`getDeclineReferrals`).
  Reads selected and archived suggestions, then returns declined rows with a
  non-empty referral, each with the decliner's `wmkf_name` resolved. Structured
  envelopes expand to one DTO per referred person; legacy text remains one
  display-only DTO. A structured item is omitted when its exact parsed index is
  durably dismissed, or when an existing request-scoped candidate carries
  `referred` provenance, exactly matches the normalized name (and email too when
  supplied), and is selected or engaged. Resolved legacy notes are also omitted,
  so the Track badge represents unresolved referral work rather than the
  lifetime count of decline responses.
  **Deliberately independent of
  `review-manager/reviewers-service.js`**, which filters to accepted reviewers
  and early-returns when none are accepted — so referrals surface even when
  every invitee declined before anyone accepted.
- **Surface:** `ReviewersTab` fetches it and passes `declineReferrals`,
  `onAddReferral`, and `onDismissDeclineReferral` to `ReviewerManagePanel`, which
  renders an amber callout at the top of the **Track Reviewers** sub-tab only.
  Every structured row offers **Dismiss** beside **Add as candidate**, so a
  previously considered suggestion can leave the work queue without creating a
  duplicate candidate.
- **One-click "Add as candidate" (in-place, S354):** does NOT bypass identity
  resolution. The button POSTs the suggested name, optional email/institution,
  and decliner straight to
  `/api/workbench/manual-reviewer` (no `resolution`) and stays on Track
  Reviewers; the server resolves identity itself (`addManualReviewer` →
  `lookupReviewerIdentity`). Three per-row outcomes, keyed by `referralId` in
  `ReviewersTab`'s `referralActions` state and rendered inline by
  `ReviewerManagePanel` (`ReferralAction`/`ReferralConfirm`): **200** → the row
  shows "✓ Added" and the tab lands on **Invite Reviewers** where the new
  candidate appears (a bare name usually has no email, so it's added but not yet
  *sendable* until staff add one there); **409 + `lookup`** (ambiguous /
  conflict) → the row switches to an **inline identity-confirm picker** (staff
  pick the right existing person or "Add as new person" → re-POST with the
  chosen `resolution`), so a referral never auto-resolves to a
  namesake (memory `project-reviewer-verify-fail-dangerous`); **other error**
  (incl. `applicant_excluded`) → inline message + "Try again". Lands `referred`
  provenance exactly as the S249 manual-referral path. On reload the referral
  reader derives closure from that durable candidate row; it does not add an
  operational source token. Staff may instead dismiss one structured row: the
  PATCH carries its exact `referralIndex` and the GET-issued content identity,
  is request-scoped and ETag-guarded, and replaces the same-width `v1` memo prefix with an `r<hex>`
  four-bit mask while preserving the submitted JSON payload byte-for-byte.
  A 412 retry merges mask-only changes but rejects reordered or replaced payloads
  with 409, preventing a stale array index from dismissing another person.
  Failed/ambiguous adds remain visible, as do remedy outcomes that still require
  promotion or restore. Legacy prose is never submitted wholesale as a reviewer
  name; staff add its people separately and then use **Dismiss resolved note**
  when the preserved marker fits the 2,000-character memo.
  The no-index PATCH preserves the original note after its compact resolved
  prefix in `wmkf_declinereferral`. Overlength legacy values and malformed or
  future `wmkf-referrals:*` envelopes remain visible but non-dismissible for
  administrator repair. Before S354 the button
  pre-filled the Find-tab Add-or-Refer form and routed there via
  `router.push({sub:'find'})` (the `ReviewerFindPanel` `prefill` prop, now
  unused) — a colleague reported it "did nothing" (the tab hop was unreliable /
  the pre-filled card sat below the fold), so it was replaced with this in-place
  flow. Tests: `tests/unit/reviewers-tab-referral-add.test.js`.
- **Find-tab Add-or-Refer "Confirm existing person" affordance (S403, owner
  report 2026-08-06):** in `ReviewerFindPanel`'s manual-add card, when the
  identity lookup returns ambiguous `candidates`, the candidate card itself is
  the confirm control (click → `chooseResolution` → "Add reviewer" re-submits
  with it). Pre-S403 that card looked like a static info box and an unresolved
  submit silently re-rendered the amber box (`saving:false`, no message) — the
  owner read it as "no option to confirm". Fixed (owner-directed design): each
  card carries a "Use this person" pill; selecting turns the card emerald
  (matching the "✓ Existing linked reviewer record" boxes) with "✓ Selected";
  the card footer offers **Confirm and Add** (type=submit, disabled until a
  selection) and **Disconfirm** — which closes the card AND records
  `{mode:'create_new'}` so the next submit doesn't re-lookup and re-open the
  same card in a loop ("Create new instead" was removed from this outcome;
  the `confident` and `conflict` outcomes keep their original buttons).
  Unresolved submit (candidates AND conflict outcomes) surfaces an inline
  instruction instead of the old silent no-op. Same silent-no-op family as
  S399 finding 4. Tests:
  `tests/unit/reviewer-find-panel-manual-add-confirm.test.js`.
- **Warning badges route to their remedy (S403, owner report 2026-08-06):** on
  `CandidateCard`, "⚠ Email needs confirmation" / "⚠ Research only" /
  "⛔ Address conflict must be resolved", the "⚠ Address verification
  required" / "⛔ Address conflict" pill, "⚠ Verified email required", and
  "⚠ Identity review required" are now buttons opening the same remedy the
  card already offered below (`onEdit` / `onReviewAddressConflict` /
  `onConfirmIdentity`) — the remedy links sit low in the card and read as
  decoration. The two full-width banners ("⚠ Dataverse identity needs review"
  → confirm-identity, "⚠ Existing linked reviewer record needs repair" →
  `onRequestRepair`) are wired the same way. `Pill` renders a `<button>` only
  when passed `onClick`. Load-bearing: three derived handlers
  (`openAddressRemedy`, `openIdentityRemedy`, `openRepairRemedy`) are the
  SINGLE source for both the badge and the lower control — the controls were
  rewritten to call them, so the two cannot drift — and each is null whenever
  its control would not render (`!canManage`, `identityUnverified`,
  `conflictRecordUnavailable`, or the repair-eligibility disjunction), so a
  badge never offers a dead or gating-bypassing action. Routing only; no
  readiness/address-trust semantics live here
  (`project-reviewer-verify-fail-dangerous`). A `ready` email chip stays inert.
  Tests: `tests/unit/reviewer-card-warning-badges-clickable.test.js`.
- **Invite/manage-preview failure banner + retry, and send-time reviewer-link
  token authority (S404, owner report 2026-08-06; Plan v4 +
  Claude-review-amendments, `outputs/plan-manage-panel-preview-retry-2026-08-06.md`):**
  rendering invite previews failed twice in production (the fail-closed 503
  "Unable to verify application access; please retry" from `requireAppAccess`
  — its Dataverse app-grant lookup threw — and the bare "Failed to render
  previews" fallback when the response had no JSON body). A first pass
  (v1/v2) added client-only retry/reopen guards; Codex's v2 adversarial review
  returned **NO-SHIP** because render-time minting let two previews overwrite
  the same recipient's durable hash. v3 added a final-draft verifier but
  explicitly accepted the verify→dispatch TOCTOU. Codex later re-reported that
  accepted window as a no-ship HIGH without new evidence; the owner directed
  the v4 fix. v4 removes preview writes and moves final mint/substitution to
  send time:
  - **Both modals — retry + single-flight:** shared wording in
    `shared/components/reviewers/render-preview-failure.js` (server message or
    status code + "No emails have been sent — retrying is safe."; distinct
    network-unreachable message), and a `previewFailed`-gated **↻ Retry**
    button on `InviteEmailModal` and `ReviewerManagePanel`'s compose banner —
    never offered on a send-path error. Each modal serializes render calls
    through a `renderTailRef` promise chain so at most one `render-emails`
    fetch is ever in flight per modal; a superseding call collapses queued
    duplicates to the latest request rather than starting a second
    overlapping render. `rendering` state
    disables Preview/Retry while a render is queued or in flight.
  - **Materials-modal session epoch (`shared/components/reviewers/ReleaseMaterialsModal.js` since Stage 6C, PR #153):** `ReleaseMaterialsModal` keeps a
    monotonic `modalSessionRef`, bumped on every open/close transition (never
    reset). `handlePreview` and `handleSend` capture the epoch at entry and
    check it after every `await` before touching state — a response from an
    earlier open/close session (e.g. closed, reopened with a different
    selection, then the stale response lands) can never repopulate the
    current session's drafts or post the wrong suggestion IDs. This is the
    regression pin for the second Codex v1 HIGH finding (stale-recipient
    repopulation after close/reopen).
  - **Send-time token authority:** `render-emails-service.js` remains the
    `externalLinkExpected` producer but is now read-only: it substitutes the
    JWT-shaped, deliberately non-live `SEND_TIME_TOKEN_PLACEHOLDER_JWT`, and
    repeated previews never rotate `wmkf_externaltokenhash`. Both modals carry
    the expectation stamp and final PD-edited subject/body to `send-emails`.
    After all recipient confidence/lifecycle guards (so a `blocked` row never
    mints), `send-emails-service.js` extracts the final subject+body JWTs,
    retains `verifySuggestionToken` as defense-in-depth for any real
    legacy/edited JWT, computes the unchanged accepted/due-date expiry, then
    calls `mintAndStore` and substitutes **only** JWT path segments in subject
    and body. No application `await` separates the completed final mint from
    invoking Dynamics dispatch. Missing/ambiguous/invalid/foreign links and
    mint failures remain per-row `email_failed {code,error}`; healthy siblings
    continue. A no-link draft (`externalLinkExpected:false`, zero URLs) neither
    verifies nor mints. Research-only invite rows no longer expose a preview-
    minted manual link; the modal fails closed and points staff to address
    verification or the separate token-regeneration workflow. Owner decision
    2026-08-06: "send from own mailbox" is NOT a priority — the manual-copy
    link stays degraded fail-closed with no replacement affordance planned;
    do not re-open without a new owner decision.
  - **Bounded render timeout (Codex post-build finding 2):** every
    render-emails fetch in both modals carries an `AbortController` with
    `PREVIEW_RENDER_TIMEOUT_MS` (45s), and the manage-panel close transition
    aborts any outstanding render — a hung fetch can no longer wedge
    `renderTailRef` for later sessions (the modal stays mounted across close).
    An abort surfaces as the network-failure banner with Retry enabled. Safe
    because renders are read-only server-side since `d040a7a3` — aborting
    cannot strand a durable write. Epoch guards still gate every settle.
  - The shared guard messages were also reworded (`lib/utils/auth.js`), after
    three rounds of owner feedback ("application" reads as a GRANT application;
    "permissions to what?"; "she's IN the app and it worked before" — any
    mention of the user's access misleads, because the 503 is the SERVER's
    Dataverse grant query failing while the user is already inside the app).
    The 503 text is owner-set VERBATIM (do not wordsmith it): "I'm having
    trouble accessing the server. This is usually a temporary blip. Please
    press retry and if the problem doesn't resolve, contact an administrator."
    The 403 (grant row genuinely absent) says "Your account does not have
    access to the Workbench app" (registry name since 2026-10-05), named via `appDisplayName`: the first
    requested key present in `APP_REGISTRY` (legacy alternates like
    `review-manager` are registry-absent, so the canonical name wins), falling
    back to "this app" for unregistered namespaces or key-less guards.
  Tests: `tests/unit/invite-preview-error-retry.test.js`,
  `tests/unit/manage-panel-preview-error-retry.test.js`,
  `tests/unit/render-emails-service.test.js`,
  `tests/unit/send-emails-service.test.js`,
  `tests/integration/send-emails-route.test.js`,
  `tests/unit/reviewer-email-token-authority.test.js`.
- **Confirm-reviewer modal coherence (S404, owner report 2026-08-06):**
  `CandidateEditModal`'s confirm flow stacked two checkboxes both opening
  "I verified this is the correct person" (they attest DIFFERENT verdicts:
  the blue box = contact/address attestation with evidence; the amber box =
  identity confirmation whose unverified auto-found ORCID/metrics are
  deliberately dropped), plus twin URL fields (Evidence link = verification
  provenance, frozen with the attestation; Website = contact-card field).
  Fixed: plain headers ("Email address" / "Right person?"), the ORCID drop
  explained in plain words, and cross-fill affordances between the two URL
  fields (each renders only when it would do something). The two verdicts and
  the two stored URLs remain SEPARATE by design — identity ≠ contact
  attribution (fuzzy-matching consensus §1) and an audit record must not
  drift when the contact card is later edited. Gating unchanged
  (save disabled until identity ticked; evidence requirements intact).
  Tests: `tests/unit/candidate-edit-modal-coherence.test.js` (3,
  stash-verified).
- Origin of the direction: the former Fable holistic-review P3.1; the
  reconciled implementation plan now records the shipped surface as F1.1 and
  treats conversion measurement as remaining work
  (`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`).

<!-- end-source-lines: 427-632 -->
<!-- source-lines: 1254-1350 -->
**Contact evidence and action policy (S267–S391):**
`shared/components/reviewers/ContactLeads.js` renders quarantined contact leads
only after identity is resolved. An `identityUnverified` card suppresses the
verified treatment—no mailto chip, readiness verdict, green Dataverse claim, or
contact leads—but offers the underlying affiliation, bounded Dataverse
evidence, plain-text address/source, recent papers, and a Scholar name search
under **Review evidence before confirming**.

The complete paper list is load-bearing and must not be truncated or collapsed.
Affiliation, address, and the Dataverse match may all descend from the same
retrieval; staff break that circularity by opening the papers and checking them
against the proposal. The Dataverse line therefore states what the match does
not prove, and the unresolved-card Scholar link never uses a stored profile URL.
A paper establishes the person only; its corresponding-author address becomes
address evidence only when staff explicitly attest that exact value.

**Historical S387 address behavior, retired by S391:** Invite previously used
`PATCH my-candidates { verifyEmailAddress:true }` to stamp `staff_verified`
without recording the separate evidence-backed act, while changed values
followed the `manual` path. That endpoint now returns
`address_verification_moved`; the S391 policy below is the only current address
verification path. Search-derived addresses remain `research_only`, while
identity-anchored scholarly evidence remains `scholarly_multi`/`scholarly_single`
under the existing readiness rules. Candidate cards and the roster retain the
bounded evidence needed for action. Saved-candidate duplicate-email repair still
uses the reviewed merge flow in `docs/REVIEWER_MERGE_DESIGN.md`.

**S391 current address policy (production-live; bounded no-send pilot passed):**
the S387 `my-candidates verifyEmailAddress` flow described above is
retired and returns `address_verification_moved`; it no longer changes provenance
without evidence. Find and Invite use `POST
/api/workbench/reviewer-address-trust`, requiring an affirmative exact
person/address attestation plus a validated evidence link/type. Before promotion,
the server stores a request/candidate-bound roster receipt; promotion ETag-writes
address + `staff_verified` + the versioned exact-address bundle on the stable
person. Bundle-backed `staff_verified` is ready; legacy source-only values remain
quick-check. High-confidence stored-versus-found contradictions on exact
applicant-linked people persist `conflict_pending`, which blocks promotion and all
outbound reviewer templates until staff chooses the stored or found address.
In Production deployment `dpl_9yZ9xTHqfNgLcbZxJDekZkAjqpPS` (Ready and
signed-in read-only smoke-verified 2026-08-20), Find shows **Review email
choice** for an email-only conflict and one **Review and confirm** action for a
combined identity/email conflict. A legacy repair alert remains internal and
does not render a competing pending control. The dialog presents both fresh
exact values and records
`staff_address_choice` with a non-null `keep_stored`/`use_found` resolution.
That resolved exact choice is invite-ready without a second send acknowledgement;
the card has no Admin link. Known duplicate-owner, inactive-person, and
Contact-linkage blocks instead identify the AkoyaGO record and expose **Retry
record check**, which freshly proves the structural repair before clearing the
card.

**Existing-record request context (implemented on the current feature branch;
deployment pending 2026-08-21):** after reconciliation proves one exact person
from a trusted server identity receipt and anchor-grounded ORCID, it reads at
most 25 canonical suggestion links and 25 legacy `wmkf_potentialreviewer1..5`
request links in parallel. It excludes the current request, deduplicates by
request GUID, and preserves at most three request number/title/cycle summaries
in `dataverseContactEvidence.priorRequestContext`. The card says **Already in
AkoyaGO** before the warning; the address dialog repeats the association and
says it does not establish which email is current. A three-second presentation
race may omit the context but cannot block or later mutate the card. This adds
no action and changes no identity, email-readiness, promotion, or send rule.

Matching legacy repair alerts auto-resolve best-effort after canonical
success; their compatibility readers remain because a 2026-08-20 read-only
probe found one active row. Ordinary conflict retries require a still-matching server-bound identity
receipt plus anchor-grounded ORCID identity; an existing address receipt is
replayed as the prior adjudication, while a failed pre-bundle conflict write can
clear without inventing person state. Receipt-first partial success and stale
ETags remain explicit and retryable. Promoted conflicts expose both current
addresses and evidence directly in the Invite modal; ordinary manual email edits
cannot bypass the pending block. The complete paper list and Scholar name-search
rule remain load-bearing. The fifth Opus review of `e4349a76` returned NO-SHIP;
its findings were remediated, but the sixth review rejected the follow-up's
inferred no-bundle A/B resolution. Fable's fresh-eyes review supplied the current
fail-closed state machine: a failed conflict write blocks direct verification
plus both promotion paths; retry persists only a real `conflict_pending`
contradiction, and may clear the roster flag without a person write only after a
fresh read shows the contradiction disappeared. Receipts resolve only existing
exact pending tuples. Unknown/transient failures retain the durable repair
fallback; routine and known structural states use the direct controls above. The final
bounded review found and closed a stale-roster overwrite: resurfacing now
preserves the three stored address blocks but does not carry permissive
`emailPersistAllowed` authority to a resurfaced address (`86bf5d1`, corrected by
`974bb64`). Wave 17 then read back EXACT in Production and runtime commit
`6bc6d2f5` reached Ready as deployment
`dpl_F3TDD39h8gyDN2uxbCWXLwWSSHpA`. The signed-in Request `1002912` pilot
verified Petr Cejka's exact person/address receipt against an official
institution page, authenticated actor readback, reload, and no
selection/promotion/send/Contact change. It caught a stale enrichment-time badge
overriding receipt-backed readiness; `6bc6d2f5` corrected the precedence and the
deployed reload showed **High-confidence email**. No suitable live conflict was
present, so conflict adjudication, promotion parity, duplicate-owner handling,
retryable outage, and capture-send scenarios remain unexercised rather than
being manufactured in Production.

<!-- end-source-lines: 1254-1350 -->
