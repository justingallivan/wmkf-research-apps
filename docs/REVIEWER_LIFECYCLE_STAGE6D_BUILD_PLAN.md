---
title: Reviewer Lifecycle Stage 6D — server-side draft fingerprint
kind: plan
domain: reviewer-workbench
status: draft
canonical: false
owner: product-engineering
last_verified: 2026-09-05
summary: render-emails stamps each draft with a fingerprint of server-observed inputs; send-emails recomputes it and refuses stale drafts with a labelled skipped reason.
---

# Stage 6D — server-side draft fingerprint

**Architect:** Claude (S489). **Builder:** Sonnet subagent. **Reviewer:** Opus subagent.
**Adversarial:** Codex, at most two rounds. **Tier:** 1–2 (route/service contract change on a
live email path) — branch `claude/reviewer-lifecycle-stage6d`, PR, owner merge; **promotion
timing chosen by the owner outside an active send window** (a browser tab holding a preview
rendered before the deploy will be refused at send until it re-renders). **[OWNER DECISION PENDING]** uniform enforcement across all four template types (drafted below
as the simplest rule) versus exempting `invitation` in the first cut. **Prerequisites:**
Stage 6C merged; `/contract-reconcile` run on this plan and recorded below before build pickup
(the 6B plan requires a recorded planning review).

## Problem [VERIFIED via source on main `e3071fdd`]

The materials-modal session key (6B3a–6B3c) detects only changes the panel has already
refetched, and cannot see co-investigators because no client host carries them
(`docs/audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md:353,377`). The rendered body
is sent verbatim; `send-emails-service` re-resolves only the destination address and the
token. So a CRM edit to the title, abstract, PI, institution, co-PI list, reviewer name or
affiliation, per-engagement due-date override, honorarium opt-out or cycle config between
preview and send goes out stale.

Two clients use the pair of routes:
- `ReleaseMaterialsModal` (`ReviewerManagePanel.js:1173` render, `:1287` send) — types
  `materials`, `followup`, `thankyou`.
- `InviteEmailModal` (`:386` render, `:724` send) — type `invitation`.

Both post `drafts[] = { suggestionId, subject, body, externalLinkExpected }` plus
`templateType`, `attachmentUrls`, `markAsSent` (invitation adds `allowResend` and campaign
config). Neither sends composer settings or the template text.

`render-emails-service.js` already computes every body input per recipient (lines 270–340):
`candidate {name, affiliation, email}`, `proposal {title, abstract, authors (PI), institution,
coInvestigators, coInvestigatorCount}`, `templateSettings {signature, reviewDueDate (override →
composer → request → cycle), reviewerFormLink, externalLink placeholder, grantCycle {programName,
reviewDeadline, customFields}}`, `honorariumNote`. It returns `{ drafts, stats }` as plain JSON
(not SSE). `send-emails-service.js` already re-reads the suggestion, person and request per
draft (lines 339–356) and the cycle configs (392) before any transport, but with narrower
`$select`s and without co-PIs [VERIFIED via source read]. The honorarium amount reaches the body
as `customFields.honorarium` via `getHonorariumAmount()` (`render-emails-service.js:179–184,
319`; Dataverse `wmkf_appsystemsettings` key `honorarium.default_amount`,
`lib/services/honorarium-config.js:5,22`) [VERIFIED]; it is server-sourced and therefore a
fingerprint input.

## Contract

### Fingerprint definition (new `lib/services/review-manager/draft-fingerprint.js`)

```
fingerprintInputs = {
  v: 1,
  templateType,
  suggestionId,                              // lower-cased
  candidate: { name, affiliation },          // as render resolves them — NOT email (see below)
  proposal:  { title, abstract, authors, institution, coInvestigators: [names…] },
  engagement: { reviewDueDateOverride, honorariumOptOut },
  request:   { reviewDueDate, meetingDate },
  cycle:     { programName, reviewDeadline, customFields },  // loadCycleConfigs RAW cycle.custom_fields —
                                              // NOT the merged customFields (which includes client settings.customFields)
  honorariumAmount                            // getHonorariumAmount() (Dataverse honorarium.default_amount)
}
fingerprint = sha256(stableStringify(fingerprintInputs))   // hex, sorted keys, null-normalised,
                                                           // strings trimmed, arrays kept in order
```

Deliberately **excluded** (and why): **the recipient email** — `buildTemplateData` exposes it as
`{{recipientEmail}}` [VERIFIED via `lib/utils/email-generator.js:420`] but no tracked default
template embeds it [VERIFIED via grep of `shared/`, `lib/services`, `scripts/` — only the
generator itself]; the destination address is owned by the send-time re-resolution and the
address-trust/confidence gates, and fingerprinting it would refuse the very send a staff member
just fixed the address for (the preserved contract: "only the destination address is re-resolved
server-side"). A Dataverse-stored template that embeds `{{recipientEmail}}` would show the
render-time address; accepted. Also excluded: composer `settings` (signature, composer reviewDueDate,
reviewerFormLink, customFields overrides) — not present in the send request and already covered
by the 6B3a client key; the template subject/body — not present in the send request, and the
previewed body is what the PD approved; the external-link placeholder — non-live by design;
`emailConfidence`/address-trust — enforced separately at send. This is a **server-observed-input
fingerprint**, not an HMAC: the client is staff-only and a forged value can only send the body
the PD already previewed. Record this as an accepted limit.

Two pure functions: `buildDraftFingerprintInputs({ templateType, suggestionId, suggestion,
person, request, coPINames, cycle })` and `fingerprintDraft(inputs)`. Both render and send call
the same pair, so the two sides cannot drift.

### render-emails (`render-emails-service.js`, route unchanged)

Each draft row (including skipped rows, for the uniform DTO) gains `draftFingerprint: string`.
No other change. Route shell untouched (`pages/api/review-manager/render-emails.js` passes the
result through).

### Clients (`ReleaseMaterialsModal`, `InviteEmailModal`)

Forward `draftFingerprint: d.draftFingerprint` in the send `drafts[]` mapping. Edits to
subject/body in the modal do not touch the fingerprint (by design — body is verbatim). Label the
two new skipped reasons (below) in the sent-summary list; today the panel prints
`skipped ({s.reason || 'not sent'})` (`ReviewerManagePanel.js:1782`) and the invite modal has its
own reason phrasing (`InviteEmailModal.js:71`). Add a shared `SEND_SKIP_REASON_LABEL` map in
`shared/utils/reviewer-send-skip-reasons.js` covering **every** existing send-emails `skipped`
reason (`no_email`, `program_director_sender_unavailable`, `not_accepted`, `materials_already_sent`,
`materials_release_ineligible`, `address_conflict_pending`, `email_research_only`,
`email_unconfirmed`, `already_invited`, the token-gate `reason`s pushed at `:723`) plus the two
new ones, and register producer↔consumer parity in `scripts/check-status-enum-parity.js`. Because the
token-gate reasons are assigned through a variable (`reason = 'unresolved_placeholder'` at `:707`,
`'missing_secure_link'` at `:710`, `INVALID_SECURE_LINK_SKIP_REASON`) rather than pushed as
literals, a literal-regex producer would under-count; instead export an explicit
`SEND_SKIP_REASONS` array from `send-emails-service.js` (every reason the service can push, old
and new), make the REGISTRY entry `SEND_SKIP_REASONS ⇔ SEND_SKIP_REASON_LABEL keys` with rule
`equal` (copy the shape of the `workRemaining stages ⇔ WORK_REMAINING_LABEL` entry,
`check-status-enum-parity.js:123–131`), and add a unit test that greps the service source for
`reason: '…'` and `reason = '…'` literals and asserts each is in `SEND_SKIP_REASONS` so the array
cannot silently lag the code. Note the two vocabularies: render rows carry a string `skipped`
field (`render-emails-service.js:225,246,267`: `no_email`, `address_conflict_pending`,
`email_research_only`) that the modals already label; send's `skipped[].reason` is the set this
map covers. 6D does not merge them. The user-facing copy for the new reasons:
- `draft_stale`: "The reviewer or proposal details changed after this preview was rendered.
  Nothing was sent to this reviewer — reopen the preview to render a fresh draft."
- `draft_fingerprint_missing`: "This draft was rendered before the current version of the app.
  Nothing was sent — reopen the preview to render it again."

### send-emails (`send-emails-service.js`, SSE shell unchanged)

Insertion point [VERIFIED via source at `dcecf972`]: immediately after the `already_invited`
skip's `continue` (`:690`) and before the invitation secure-link gate (`:700–726`, skipped
reasons `unresolved_placeholder` / `missing_secure_link` / `INVALID_SECURE_LINK_SKIP_REASON`),
the token authority gate and `mintAndStore` (`:830`), attachment fetch and transport. No durable
write precedes that point: the first `updateLifecycle` is the post-send stamp at `:913`; campaign
config persists post-loop. A stale draft therefore `continue`s past one recipient and the batch
proceeds; the stream still ends `result` → `complete`.

Inside the existing per-draft loop, **after** the existing hardcoded skips (`no_email`,
`not_accepted`, `materials_already_sent`, `materials_release_ineligible`, address-trust,
`email_research_only`, `email_unconfirmed`, `already_invited`) and **before** any token mint,
attachment fetch or transport:

1. `draft.draftFingerprint` absent or not a 64-hex string → `skipped.push({…, reason:
   'draft_fingerprint_missing' })`, `continue`.
2. Recompute with `buildDraftFingerprintInputs` from the send-time reads. To do that the
   recipient-hydration block widens its selects: request adds `akoya_title, wmkf_abstract,
   _wmkf_projectleader_value, wmkf_organizationname, _akoya_applicantid_value`; person adds
   `wmkf_primaryaffiliation, wmkf_organizationname`; suggestion `findById` delegates to `readById`
   (`reviewer-suggestion.js:1215–1225`), which selects `FIELD_SELECT = selectFields(ENTITY_SET)`
   (`:44`) from the entity registry, whose reviewer-suggestion SELECT includes
   `wmkf_reviewduedateoverride` and `wmkf_honorariumoptout`
   (`lib/dataverse/core/entity-registry.js:140`, `:177`) [VERIFIED via source]. (The literal list
   at `reviewer-suggestion.js:305–340` is `MERGE_PREDICATE_SELECT`, not the read projection.) Add one
   `fetchCoPIs(requestId)` per distinct request (memoised map, `.catch(() => [])` exactly as
   render does, inside the existing trusted DAL context). Cycle configs come from the existing
   `loadCycleConfigs` result.
3. Mismatch → `skipped.push({…, reason: 'draft_stale' })`, `continue`. Match → proceed unchanged.

Applies to **all four** template types uniformly (simplest rule; both clients forward the
field). No new SSE event: `draft_stale` and `draft_fingerprint_missing` are new **values** of the
existing `skipped[].reason`, carried in the existing `result` and `complete` events. The event
vocabulary header comment in the service and the `email_failed` `code` list are unchanged; the
`skipped` reason list in the header gains the two values.

### Client actions that mutate a fingerprinted input while drafts exist

| Action | Where | Fingerprinted input | Disposition |
|---|---|---|---|
| Fix abstract inside the invite modal | `InviteEmailModal.js:646` → `/api/review-manager/update-abstract` | `proposal.abstract` | Already re-renders drafts after save (`:670` `renderPreviews()`) [VERIFIED] → fingerprint refreshes; no change. |
| Edit contact (name/affiliation/email) | Invite panel; the invite modal's own copy says "use Edit contact after closing this window" (`:995`) | `candidate.name`, `affiliation` | Requires closing the modal → session reset → re-render. Email is excluded anyway. |
| Grant/Change extension | Track table, `ReviewerManagePanel` row action; not reachable while the materials modal is open (modal) | `engagement.reviewDueDateOverride` | Closing/reopening the modal re-renders; a CRM-side or other-user change mid-compose → `draft_stale` (correct). |
| Honorarium opt-out / amount | Closeout modal / Admin | `honorariumOptOut`, `honorariumAmount` | Same: not reachable while the materials modal is open; other-user change → `draft_stale` (correct). |
| Co-PI added/removed in Dynamics | CRM | `coInvestigators` | The headline gap; → `draft_stale`. |

So `draft_stale` fires only for changes made outside the open modal (CRM edits, another staff
member, Admin), which is exactly the class the client key cannot see.

### Non-goals

No re-render at send (the body stays verbatim). No change to the 6B3 client key or modal session
identity. No change to the token authority gate, attachment gates, lifecycle stamps, capture
mode, or the one-time materials release gate. No schema. No change to
`render-withdraw-emails`, `send-review-reminder`, or the reminder/thank-you sweeps (they render
and send in one server pass and have no stale-draft window).

## Tests

- `tests/unit/draft-fingerprint.test.js` (new): determinism; sorted-key/whitespace/null
  normalisation; a table-driven case per input field proving each flips the hash; co-PI
  order sensitivity (documented: order is part of the body).
- `tests/unit/render-emails-service.test.js` (15 tests today): every draft row carries a
  64-hex `draftFingerprint`; skipped rows too; fingerprint equals `fingerprintDraft(
  buildDraftFingerprintInputs(...))` over the same fixture.
- `tests/unit/send-emails-service.test.js` (58 today): (a) matching fingerprint → sent, no
  behavior change; (b) stale (fixture request title changed between render and send) →
  `skipped` `draft_stale`, **no** token mint and **no** transport call (assert the mocks were
  not called), `result`/`complete` counts include it, stream ends `result` → `complete`;
  (c) missing → `draft_fingerprint_missing`, same assertions; (d) the skip ordering: a draft that
  is both `not_accepted` and stale reports `not_accepted` (existing guards win); (e) a co-PI
  added after render → `draft_stale` (the headline gap).
- `tests/integration/send-emails-route.test.js` (42 today): byte-identical event contract for
  the happy path; one new case for `draft_stale` in `result`.
- Modal tests: `reviewer-materials-modal-lifetimes` or a new `reviewer-send-skip-labels` test
  asserting both new reasons render the copy above; `InviteEmailModal` forwards the field.
- `check:status-enum-parity` + self-test with the new REGISTRY entry; mutation: delete a label
  → gate red.
- Mutation checks the builder reports: remove the `continue` after `draft_stale` → test (b)
  red; drop `coInvestigators` from the inputs → test (e) red; drop the client forward in
  `ReleaseMaterialsModal` → an integration-style modal test red (or report that no test catches
  it and add one).

## Gates and docs

Gates: `check:api-routes` (matrix row text for both routes gains the contract sentence),
`check:status-enum-parity`, `check:trust-boundary-guid`, `check:route-service-boundary`,
`check:dataverse-access-layer`, `check:types`, lint, webpack build, full suite.
Docs (architect): `docs/API_ROUTE_SECURITY_MATRIX.md` rows for render-emails/send-emails;
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (6B3d paragraph's "deferred to 6D"
sentence, and a 6D paragraph); readiness audit 6D row; 6B plan status; Atlas page for
`wmkf_appreviewersuggestion` only if a new column were read (none planned); receipt
`docs/audits/REVIEWER_LIFECYCLE_STAGE6D_RECEIPT_<date>.md`.

## Review checkpoints

- **Planning review (before build):** `/contract-reconcile` Mode A over caller → persistence →
  consumer for both routes; Opus read of this plan; Codex adversarial round 1 on the plan
  (target: fingerprint input completeness vs `buildTemplateData`, skip ordering, the stale-tab
  deploy consequence, the parity registry shape). Record the verdicts here.
- **Build review:** Opus on the diff with the mutation outputs; Codex round 2 only if round 1
  on the plan left an open item or the diff diverges from the plan. Stop at two.

## Planning review record

### Contract-reconcile Mode A (architect, 2026-09-05, main `dcecf972`)

**Surface.** render-emails stamps `draftFingerprint`; send-emails recomputes and refuses. Entry
points: `ReleaseMaterialsModal` and `InviteEmailModal` → `POST /api/review-manager/render-emails`
(JSON `{drafts, stats}`) and `POST /api/review-manager/send-emails` (SSE). Persistence: none new;
Dataverse reads only. Consumers: both modals' sent-summary lists, `check:status-enum-parity`,
pinned tests. Prior findings verified: advisor's recipient-email exclusion (accepted, above) and
honorarium amount (added, above).

**Body-input census** [VERIFIED via `lib/utils/email-generator.js:382–475` key list]:
`recipientName/FirstName/LastName/salutation/greeting` ← candidate.name (fingerprinted);
`recipientEmail` ← excluded (above); `recipientAffiliation` ← fingerprinted; `recipientExpertise`
← render never sets `candidate.expertise*` → constant `''` (excluded as constant);
`proposalTitle/Abstract/piName/piInstitution/proposalDetails` ← fingerprinted;
`coInvestigators/coInvestigatorCount/investigatorTeam/investigatorVerb` ← derived from the co-PI
name list (fingerprinted via the list; count is implied); `programName/reviewDeadline` ← cycle
(fingerprinted); `signature/reviewerFormLink/externalLink` ← client settings / placeholder
(excluded, documented); `reviewDueDate` ← override → composer → request → cycle: the override,
request and cycle legs are fingerprinted, the composer leg is client (excluded, covered by the
6B3a key); `customFields` ← cycle.custom_fields (fingerprinted) + settings.customFields (client,
excluded) + honorarium amount (fingerprinted); `honorariumNote` ← `wmkf_honorariumoptout`
(fingerprinted via `engagement.honorariumOptOut`). Nothing is uncovered.

**Audits.** Whole-flow: hops 1–9 traced above (client forward, route shells unchanged, service
insertion point, no persistence, response = existing `result`/`complete`, consumer label map,
tests/gates named). Partial-success: per-recipient `skipped` with identifiers; batch continues;
`success` semantics unchanged. Async/stale: the fingerprint IS the stale guard; no new client
await. Helper-extraction: `draft-fingerprint.js` is shared by render and send — it must not
normalise differently per caller (single `stableStringify`; both sides pass raw Dataverse
values). Durable-surface: no migration/Atlas; API matrix rows for both routes need the contract
sentence (`check:api-routes`); no CANONICAL_COUNTS shift. Doc-reconcile: listed under Gates and
docs. Symbol fan-out: new `reason` values → label map (both modals), `SEND_SKIP_REASONS`, parity
entry, `send-emails-service.js` header comment; render row gains a field every existing row
consumer ignores (grep `externalLinkExpected` shows only the two modals forward row fields).

**Verdict: READY WITH NAMED CHANGES** — the changes are the corrections folded above (registry
citation, raw `custom_fields`, insertion point, `SEND_SKIP_REASONS` producer) plus the pending
owner decision on uniform enforcement. Opus planning review and Codex round 1 recorded below when
complete.

## Accepted limits (to record in the receipt)

Composer settings and template text are outside the fingerprint (client key covers settings;
template is what the PD previewed). Not an HMAC. A preview rendered before the deploy is
refused once at send and must be re-rendered. Co-PI order changes count as stale.
