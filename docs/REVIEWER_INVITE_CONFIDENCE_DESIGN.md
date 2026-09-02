---
title: "Reviewer Invite-Confidence + Manual-Confirm Gate (Slice G-opt1) — Design"
domain: reviewer-workbench
kind: spec
status: active
summary: "State labels: [VERIFIED] = read in source this session; [ASSUMED] = inference."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md
  - lib/utils/reviewer-invite.js
  - pages/api/reviewer-finder/my-candidates.js
---

# Reviewer Invite-Confidence + Manual-Confirm Gate (Slice G-opt1) — Design

Date: 2026-06-08 (S235)
Status: IMPLEMENTED 2026-06-08 (S235) on branch `reviewer-slice-g-invite-confidence` —
Codex design-reviewed (READY WITH NAMED CHANGES), all 4 named changes folded in (see
"## R."). One implementation refinement beyond the spec: **the gate is scoped to
`templateType==='invitation'`** (see §3e note) — the current `ReviewerManagePanel` release
modal sends only post-acceptance `materials` (the shared route retains legacy
`followup`/`thankyou` compatibility), and once a reviewer accepts via the
magic link the address is proven, so only first-contact invitations are gated. Implements
Slice G of `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` §4. Builds on Slice E (shipped
S235) and the S234 contact-anchoring slice.

State labels: [VERIFIED] = read in source this session; [ASSUMED] = inference.

## 0. Goal

Never let a staff member invite a reviewer at a **wrong/unverified address without
realizing it** (the S234 failure: the *pianist* Chen's gmail looked like a normal
recipient). Surface email-confidence at the human send step and require a conscious
one-click acknowledgement before sending to a LOW-confidence address. NOT a hard block —
the existing stance is "a human is the authority" (`my-candidates.js` PATCH comment).

## 1. Grounded current state

- [VERIFIED] **Sends are staff-initiated only.** `send-emails` is POSTed from the invite
  UI (`ReviewerManagePanel.js:394`, `InviteEmailModal.js:171`), guarded by
  `requireAppAccess('review-manager','reviewers')`. The flow is render preview → editable
  → click send. Disconfirming check: the one invite-related cron
  (`/api/cron/sweep-stale-invites` → `reviewer-suggestion-sweep.js`) only reads
  already-emailed suggestions (`wmkf_emailsentat ne null`) and flags stale ones — it
  sends NO email. So the staff modal is the sole sender. (The send still goes through the
  shared `send-emails` API, which is the enforced invariant boundary — §3e — so the gate
  is real, not UI-only; there is no automation path to separately guard.)
- [VERIFIED] **`send-emails` recipient resolution** (`send-emails.js:146`) selects
  `wmkf_emailaddress, wmkf_orcid, wmkf_identitystatus` from `wmkf_potentialreviewerses`,
  but NOT `wmkf_emailsource`. Recipient email = `person.wmkf_emailaddress` (`:251`); no
  email present → skip `no_email` (`:254`). Duplicate-invite guard
  (`shouldSkipDuplicateInvitation`) at `:269`. **No email-confidence gate.**
- [VERIFIED] **`wmkf_emailsource` lives on the same entity** (`wmkf_potentialreviewerses`,
  researcher adapter `ENTITY_SET`), so it is selectable at send time with NO schema
  change. Values in use: `orcid`, `pubmed`, `serp_search`, `claude_search`, `affiliation`.
- [VERIFIED] **Fix C floor:** an enrichment-sourced email only reaches `wmkf_emailaddress`
  when `emailPersistAllowed` (domain-validated/anchored). So a persisted email with a
  trusted `wmkf_emailsource` was already confidence-gated at persist time.
- [VERIFIED] **The gap = the manual path.** `my-candidates.js:436` writes a staff-typed
  `wmkf_emailaddress` directly (no Fix C, and it does NOT set `wmkf_emailsource`). This
  PATCH is intentionally NOT resolver-gated ("a human correcting a record is the
  authority", `:444-448`).
- [VERIFIED] No existing email-confidence concept anywhere (clean slate). Invite-gating
  helpers live in `lib/utils/reviewer-invite.js`.

## 2. Confidence definition (deterministic, no model call)

`emailConfidence(person) -> { level: 'high' | 'low', reason }` from fields already on the
person row:

- **HIGH** if `wmkf_emailsource ∈ {orcid, pubmed, institution_page}` (authoritative /
  identity-sourced; `institution_page` is Slice F's future source, included now).
- **HIGH** if `wmkf_emailsource ∈ {serp_search, claude_search}` AND
  `wmkf_identitystatus ∈ {confirmed, probable}` — the scoped search that produced it was
  anchored to the resolved identity (Fix A: these tiers require an identity anchor before
  search, `contact-enrichment-service.js:483,561`) and passed the Fix-C/Scholar-domain
  contradiction gate (`:226`).
- **LOW** otherwise: `wmkf_emailsource = 'manual'`; OR `affiliation` (see below); OR
  null/absent source; OR a search-sourced email on a non-confirmed identity.

**`affiliation` is LOW** [Codex R2]: an `affiliation`-sourced email is extracted from an
affiliation string and marked persistable immediately (`:331`), and the Scholar-domain
contradiction logic explicitly does NOT override affiliation-sourced emails (`:226`) — so
it is less anchored than the search-sourced branch. It does not earn HIGH.

Rationale: the only addresses that reach the row un-anchored are (a) manual entries,
(b) affiliation-string-derived, and (c) legacy/unknown-source rows. All should prompt a
conscious confirm.

## 3. Changes

### 3a. Manual-edit marks its source [server]
`pages/api/reviewer-finder/my-candidates.js` (~:434-455): when the PATCH sets `email`,
also stamp `emailSource = 'manual'` on the person record so a staff-typed address reads
LOW until confirmed. [Codex R1] Write it via the **researcher adapter**
(`researcherAdapter.updateById(personId, { emailSource: 'manual', ... })`), NOT
`potentialReviewerAdapter.update` — `wmkf_emailsource` is mapped in `researcher.js:138`
and my-candidates already calls `researcherAdapter.updateById` for website/hIndex
(`:453-455`). Automated enrichment writes `wmkf_emailsource` fill-if-empty
(`researcher.js:122`), so a later enrichment pass will NOT silently overwrite the `manual`
provenance. Does NOT change the "human is authority" stance — it records provenance so the
send step can warn. Clearing/replacing the email re-stamps it.

### 3b. Confidence helper [shared]
Add `emailConfidence(person)` (per §2) to `lib/utils/reviewer-invite.js` (the existing
invite-gating home). Pure function over `{ wmkf_emailsource, wmkf_identitystatus }` — unit
testable, no I/O. Export for both the modal and any server use.

### 3c. Surface confidence to the invite modal [API + UI] — Opt-B [Codex R3]
**Opt-B confirmed.** The modal recipient DTO is too thin for client-side compute:
`CandidatesPanel` passes only `{ suggestionId, name, email }` into `InviteEmailModal`
(`CandidatesPanel.js:94`), and `InviteEmailModal` calls `render-emails` with only
suggestion IDs + template + signature (`InviteEmailModal.js:110`). `render-emails`
currently selects no `wmkf_emailsource`/`wmkf_identitystatus` (`:89`) and returns only
name/email/request/body metadata (`:195`). So: **`render-emails` selects
`wmkf_emailsource,wmkf_identitystatus` and returns a per-recipient `emailConfidence`
`{level, reason}`** computed via the §3b helper; the modal renders it.

### 3d. Modal warning + one-click confirm [UI]
`InviteEmailModal.js`: when `emailConfidence(recipient).level === 'low'`, render an amber
warning ("This address wasn't verified against the reviewer's identity — double-check it
before sending") and require a single acknowledgement to enable send (e.g. the primary
button becomes "Confirm & send"; or an unchecked "I've verified this address" gates it).
HIGH-confidence recipients send exactly as today (no friction). Batch sends
(`ReviewerManagePanel`) that include ≥1 LOW recipient surface which ones and confirm once.

### 3e. Server-enforced acknowledgement [Codex R4 — the real invariant boundary]
The modal acknowledgement alone is cosmetic: `send-emails` is a shared route called by BOTH
`InviteEmailModal` (`:171`) and `ReviewerManagePanel` (`:394`), and sends after only
email-presence + duplicate checks (`send-emails.js:253`). So the API is the invariant
boundary. `send-emails` must:
1. **independently** select `wmkf_emailsource` (add to the `:146` select) and compute
   `emailConfidence` per recipient (do not trust a client-sent level);
2. **refuse a LOW recipient unless its `suggestionId` is in the request's
   `confirmedLowConfidenceIds` allowlist** — skip with reason `email_unconfirmed` (a new skip
   reason, distinct from `no_email`);
3. include the computed `emailConfidence` on each `email_sent` / `skipped` / `failed`
   outcome for audit.
The modal sends `confirmedLowConfidenceIds` = the exact LOW recipients it named in the
confirm dialog. **Recipient-specific, NOT a batch boolean** [Codex post-impl #6]: a batch
boolean would let a row that became LOW *after* the staff previewed (e.g. a concurrent
enrichment/edit) ride on another row's confirmation. With the ID allowlist, such a row is
not in the confirmed set and is refused (`email_unconfirmed`). A HIGH-only batch sends an
empty allowlist and is unaffected.

**Scope (impl refinement):** the gate fires only for `templateType === 'invitation'`.
Disconfirming check: `ReviewerManagePanel`'s current post-acceptance release flow hardcodes
`templateType:'materials'` (never `invitation`), so it never trips the gate. The shared
route still recognizes `followup`/`thankyou` for compatibility, without an active generic
batch-composer entry point. Once a
reviewer accepts via the magic link sent to the address, the address is proven, so only the
first-contact invitation is gated — same invitation-only scope as
`shouldSkipDuplicateInvitation`. `emailConfidence` is still recorded on `email_sent` for all
types (audit), but only invitations are refused.

## 4. Out of scope
- Faculty-page email recovery (Slice F) — separate slice; `institution_page` source is
  only referenced here for the confidence table.
- New Dataverse confidence field (G-opt2) — unnecessary; `wmkf_emailsource` suffices.
- SMTP/MX validation; email-pattern construction.

## R. Codex review corrections (2026-06-08 — READY WITH NAMED CHANGES, all folded in)
1. **R1 §3a** — stamp `manual` via `researcherAdapter.updateById`, NOT
   `potentialReviewerAdapter.update` (`wmkf_emailsource` is mapped in `researcher.js:138`).
   Enrichment writes it fill-if-empty (`:122`), so `manual` is not later overwritten.
2. **R2 §2** — `affiliation` is LOW, not HIGH: it's affiliation-string-derived and exempt
   from the Scholar-domain contradiction override (`:226`,`:331`).
3. **R3 §3c** — Opt-B (server stamps confidence in `render-emails`); Opt-A not viable —
   the modal recipient DTO is only `{suggestionId,name,email}` (`CandidatesPanel.js:94`).
4. **R4 §3e** — server-enforce: `send-emails` independently computes confidence and refuses
   LOW unless the recipient is acknowledged (the API is the invariant boundary, not the UI).
5. **R-Q4 (blast radius)** — verified clean: `wmkf_emailsource` is read only by the
   researcher adapter + a one-shot backfill script; ranking/display/Review-Manager DTOs
   omit it, so stamping `manual` breaks no consumer.

Verdict: READY WITH NAMED CHANGES → all four named changes are folded into §2/§3 above.
Implementation order (server safety boundary first): 3a → 3b → 3e → 3c → 3d.

## R2. Codex POST-IMPL review (2026-06-08 — 1 blocker fixed, 1 accepted residual)
- **#6 (major, FIXED)** — the acknowledgement was a batch-level boolean
  (`confirmedLowConfidence`); a row that became LOW *after* preview could ride on another
  row's confirmation. Changed to a **recipient-specific allowlist** `confirmedLowConfidenceIds`
  (the exact suggestionIds the modal named): the server honors the override only for those
  IDs (`send-emails.js`), so a newly-LOW unconfirmed row is still refused. §3e updated.
- **#3 (minor, ACCEPTED residual)** — a direct authenticated POST could send invitation-like
  content under `templateType:'materials'` to dodge the invitation-scoped gate. Not gated:
  it requires an authenticated staff member hand-crafting a POST, and mislabeling the type
  self-defeats (skips the `invited` stamp; `recipientMayReceiveAttachments` still blocks
  materials to a non-accepted recipient). Documented, not fixed — gating all types would add
  friction to legitimate post-acceptance sends without a matching real-world risk.
- #1 partial-batch loop, #4 manual→LOW tradeoff, #5 null-safety: all verdict OK/acceptable.
