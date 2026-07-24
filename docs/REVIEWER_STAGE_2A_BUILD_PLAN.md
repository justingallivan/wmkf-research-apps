---
title: "Reviewer Interaction Stage 2a — Build Plan"
domain: reviewer-workbench
kind: plan
status: historical
summary: "Shipped early Stage 2a interaction build; retained as historical implementation record."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_INTERACTION_DESIGN.md
  - docs/INTAKE_PORTAL_SCHEMA_CHANGES.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - lib/external/verify-suggestion-token.js
---

# Reviewer Interaction Stage 2a — Build Plan

> **Historical outcome:** The documented early Stage 2a build shipped; later reviewer
> engagement evolved beyond this plan. Retained as implementation history.
>
> **Current routing:** Use [Reviewer Engagement Spec](REVIEWER_ENGAGEMENT_SPEC.md)
> and [Reviewer Workbench & Lifecycle](agent-wiki/topics/reviewer-workbench-lifecycle.md).

**Status:** **Slice 1 SHIPPED 2026-05-09** (commits b23586c, 18c69ec, 43c3741, c016e32; plus S144 Codex review fixes in 11e7e25). Schema, policy library, /respond endpoint, and state-driven view dispatch all live. **Outstanding before real-cycle exercise:** finalize COI policy body wording (placeholder still in active row), restrict delete privilege on `wmkf_policy*` to admin role, and first production engagement against a real reviewer cycle (gated externally). This doc remains the build-plan reference; treat the slice-1 sections as historical.

**Date:** 2026-05-09 (build); 2026-05-12 (status banner refresh)

**Predecessor:** `docs/REVIEWER_INTERACTION_DESIGN.md` (full journey design)

---

## 1. Scope of this build

A vertical slice of the Stage 2a landing page that covers the proposal summary card, contact-info confirmation, honorarium opt-out, **policy acknowledgment for COI and AI use** (Dynamics-native), and accept/decline events. Production-honest from day one — accept requires both policy acks, matching the design doc contract.

The slice **extends the existing `/external/review/[token]` route family** (rather than building a parallel `/external/landing/*`) and writes engagement-scope state to **`wmkf_appreviewersuggestions`** (the entity the existing magic-link primitive already resolves and writes to). This matches the design doc's "same ROUTE/page across the journey, state-driven" rule (the `/external/review/[token]` route and the engagement it resolves are stable) and avoids duplicating state already on the suggestion row. NOTE (corrected 2026-06-21): the TOKEN inside that URL is NOT stable — the send path re-mints it on every email, so the full link changes between the invitation, materials, and any reminder; only the route + resolved engagement persist. See `REVIEWER_INTERACTION_DESIGN.md` Stage 4.

Rationale:
- Contact-confirmation + accept/decline + policy acks are the highest-leverage mechanics — they unlock the data downstream consumers want (decline reasons, referrals, accept timestamps, contact corrections, compliance-grade COI capture).
- COI in particular is load-bearing as a contract, not engineering paperwork. Slice 1 cannot honor "accept requires policy acknowledgment" if policy capture is deferred.
- Policy text lives in Dynamics from day one (parent `wmkf_policy` + child `wmkf_policy_version` entity pair), aligned with the strategic direction of "Dynamics is ground truth for staff-editable content" (see memory `project_dynamics_as_prompt_ground_truth.md`). Staff edit policy text from Dynamics — no PR / deploy required for wording changes.
- Engagement-scope contact corrections live on the suggestion row only — no contact-record or potentialreviewer-snapshot writes from Stage 2a. Eliminates the three-row truth problem and the prior `emailaddress2/3` routing complexity (Codex findings #1, #3, #6).

**Not in this slice:**
- Calendar invites (Stage 3 — separate build)
- Stage 2b transition logic (materials-available state)
- Reminder cadence (Stage 4)
- Acknowledgment + referral-handoff emails on decline (PA-side trigger, deferred)

---

## 2. Schema changes

Catalog all schema changes in `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` after-the-fact (per Connor's delegation memo, summary-after model).

### New entity: `wmkf_policy` (parent — the slot / category)

A library entry per policy slot the system recognizes. One row per stable identifier; lifetime is essentially permanent.

| Field | Type | Purpose |
|---|---|---|
| `wmkf_code` | String | Stable slot identifier — e.g., `reviewer-coi`, `reviewer-ai-use`. Page render code references slot codes directly. |
| `wmkf_display_name` | String | Human-readable slot name for staff browsing. |
| `wmkf_description` | String (Memo) | Internal note: what this slot is for, where it surfaces. |
| `wmkf_active_version` | Lookup → `wmkf_policy_version` | The currently-active child. Staff sets this to atomically activate a draft. |
| `statuscode` | Status | Slot lifecycle (active/retired). |

Seed two rows for slice 1: `reviewer-coi` and `reviewer-ai-use`.

### New entity: `wmkf_policy_version` (child — versioned text)

A row per actual versioned policy body. Multiple versions per parent over time; only one parent's `wmkf_active_version` lookup points at any given child at a time.

| Field | Type | Purpose |
|---|---|---|
| `wmkf_policy` | Lookup → `wmkf_policy` | Parent slot. |
| `wmkf_version` | String | Version label (e.g., `2026-05-09`, `v1.2`). Free-form; staff convention. |
| `wmkf_title` | String | Card heading rendered in the modal (e.g., "Confidentiality and Conflict of Interest"). |
| `wmkf_body` | String (Memo) | Full policy text (markdown or plain). |
| `wmkf_effective_date` | DateTime | When staff intended this version to take effect. Informational. |
| `statuscode` | Status | `Draft` / `Active` / `Retired`. |

For slice 1: seed one `Active` child per parent. AI-use body lifts from existing review form footer; COI body needs fresh write before slice 1 ships.

### Engagement-entity correction (verified via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`, last verified 2026-05-07)

**Stage 2a's engagement row is `wmkf_appreviewersuggestions`, not `wmkf_potentialreviewers`.** This is the row the existing magic-link primitive resolves the token against (`lib/external/verify-suggestion-token.js`), the row the staff Review Manager outreach lifecycle writes to, and the row that already carries token state, accept/decline flags, response metadata, structured review fields, and review-file metadata. `wmkf_potentialreviewers` is the reusable directory entry — read from but not written by Stage 2a.

This collapses the three-row truth problem: contact-shaped state lives on the suggestion (engagement-scope), not on potentialreviewer (directory) or contact (CRM record). Reviewer self-confirmations at Stage 2a never overwrite directory or CRM records — those are staff-curated downstream.

### Existing fields on `wmkf_appreviewersuggestions` we will reuse (no schema change)

| Field | Use |
|---|---|
| `wmkf_accepted` (Boolean) | Set true on accept; false on decline-after-accept flip |
| `wmkf_declined` (Boolean) | Set true on decline; false on accept-after-decline flip |
| `wmkf_responsetype` (Picklist: `accepted=100000000 / declined=100000001 / no_response=100000002`) | Set to match the booleans on every state change |
| `wmkf_responsereceivedat` (DateTime) | Set on every accept/decline event |
| `wmkf_emailsentat` (DateTime) | Already populated by Review Manager send-emails; treat as the "invited at" timestamp — no `wmkf_invited_at` field needed |
| `wmkf_revieweraffiliation` (String) | Engagement-scope affiliation. Stage 2a writes here when reviewer edits affiliation |
| `wmkf_proposalfirstaccessed` (DateTime) | Already stamped by `/api/external/review/[token]/context.js` on first GET; treat as the page-visit audit |
| `wmkf_reviewstatus` (Picklist) | Read-only at Stage 2a; advances to `materials_sent` later in the journey, which gates reversibility (see §7 state-machine) |

### Field deployed alongside Stage 2a slice 1 (2026-05-09)

- `wmkf_declinereason` (Memo, max 2000) — DEPLOYED 2026-05-09 as part of the Stage 2a slice 1 schema batch. Captures the freeform decline-reason follow-up. See the deployed-field list in `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`.

### New fields on `wmkf_appreviewersuggestions`

| Field | Type | Purpose |
|---|---|---|
| `wmkf_reviewerfirstname` | String | Engagement-scope first name correction. |
| `wmkf_reviewerlastname` | String | Engagement-scope last name correction. |
| `wmkf_reviewernickname` | String | Display preference (nickname) at engagement scope. |
| `wmkf_reviewertitle` | String | Engagement-scope job title. |
| `wmkf_revieweremail` | String | Engagement-scope correspondence email. **Replaces the prior plan's "write to `contact.emailaddress2/3`" routing — reviewer-correspondence email lives on the engagement row, full stop. Contact's `emailaddress1` is never touched.** |
| `wmkf_reviewerorcid` | String | Engagement-scope ORCID. |
| `wmkf_declinereasonpicklist` | Picklist | `too-busy=100000000 / coi=100000001 / outside-expertise=100000002 / bad-timing=100000003 / other=100000004`. Optional. (Companion to existing/locked `wmkf_DeclineReason` Memo for free-text.) |
| `wmkf_declinereferral` | String (Memo) | Reviewer's freeform referral text; optional. |
| `wmkf_withdrawnsufficientat` | DateTime | Set on "we're full" withdrawal. |
| `wmkf_honorariumoptout` | Boolean | Default false. Captured at accept. |
| `wmkf_coipolicyversion` | Lookup → `wmkf_policy_version` | The exact COI version the reviewer acked. Non-null IFF acked. Pinning preserves "what they actually saw" — see §4a immutability rules. |
| `wmkf_coiackedat` | DateTime | When the COI ack was captured. |
| `wmkf_aiusepolicyversion` | Lookup → `wmkf_policy_version` | Same shape, AI-use slot. |
| `wmkf_aiuseackedat` | DateTime | When the AI-use ack was captured. |

### `wmkf_responsetype` picklist extension

Add new value: `withdrawn_sufficient=100000003` (next free slot). Distinct from `declined` (reviewer initiative) and `no_response` (timeout) so staff analytics on decline rate aren't muddied by capacity-cancellations.

ICS UID tracking (for Stage 3 calendar invites) is **deferred** with the calendar build.

### Audit model

Stage 2a relies on three layers of audit, each scoped to a different event class. Codex's review highlighted that one undifferentiated "field write" log conflates page visits, drafts, state changes, and submitted values — so we name each layer:

| Event class | Captured by | Source-of-truth |
|---|---|---|
| Page visit | `wmkf_proposalfirstaccessed` (existing; stamped on first GET) | Suggestion row |
| Contact-correction draft/save | n/a (no autosave in slice 1; corrections persist only on accept submit) | — |
| Accept / decline state change | `wmkf_responsetype` + `wmkf_responsereceivedat` + the `wmkf_accepted` / `wmkf_declined` booleans (all existing) | Suggestion row |
| Submitted contact-correction values | The new engagement-scope fields above (`wmkf_reviewerfirstname`, etc.) | Suggestion row |
| Field-level before/after for corrections | Dataverse built-in entity audit on `wmkf_appreviewersuggestions` (verify it's enabled before slice 1; if not, enable per Connor's delegation memo) | Dataverse audit log |

**Decision:** rely on Dataverse's native entity audit for field-level before/after rather than building a parallel `wmkf_reviewer_audit` entity. Reuses an existing capability, no new schema, staff-browsable in the same place as other entity audits. Native audit was enabled on `wmkf_appreviewersuggestion` via `scripts/enable-suggestion-audit.mjs` on 2026-05-09 as part of the slice 1 deploy.

---

## 3. Prefill rules

For each field shown on Stage 2a, fall through this priority — first non-null/non-empty wins:

1. **Suggestion engagement value** (`wmkf_appreviewersuggestions` — `wmkf_revieweraffiliation`, plus the new engagement-scope correction fields once any prior visit populated them). The reviewer's most-recent input on this engagement.
2. **Potential-reviewer snapshot** (`wmkf_potentialreviewers` — `wmkf_firstname`, `wmkf_lastname`, `wmkf_organizationname`, `wmkf_emailaddress`, `wmkf_title`). The directory entry, populated when staff first added the reviewer.
3. **Linked `contact` row's authoritative field** (when potentialreviewer's `_wmkf_contact_value` is set).
4. **For affiliation only:** if all three above are null but the contact's `parentcustomerid` resolves to an account, prefill the account's name with an inline hint: *"From your prior role as PI on a [Account Name] grant — please update if your home institution has changed."* This avoids the "you have stale data on me" feeling for someone who's moved.
5. Empty.

### Field-by-field prefill targets

| Stage 2a label | Engagement source (1st priority) | Snapshot source (2nd) | Contact source (3rd) |
|---|---|---|---|
| First name | `wmkf_reviewerfirstname` (new) | `wmkf_firstname` | `firstname` |
| Last name | `wmkf_reviewerlastname` (new) | `wmkf_lastname` | `lastname` |
| Display preference (nickname) | `wmkf_reviewernickname` (new) | — | `nickname` |
| Title | `wmkf_reviewertitle` (new) | `wmkf_title` | `jobtitle` |
| Affiliation | `wmkf_revieweraffiliation` (existing) | `wmkf_organizationname` | `adx_organizationname` (account fallback per rule above) |
| Email | `wmkf_revieweremail` (new) | `wmkf_emailaddress` | `emailaddress1` |
| ORCID | `wmkf_reviewerorcid` (new) | — | `wmkf_orcid` |

---

## 4. Write rules

**Stage 2a only writes to `wmkf_appreviewersuggestions`.** No mirroring to `wmkf_potentialreviewers`, no mirroring to `contact`. Reviewer self-confirmations are engagement-scoped — they describe what the reviewer told us during *this* engagement. Promotion of engagement-scope edits to the directory entry or CRM contact is a separate, staff-controlled step (out of scope for slice 1).

### Engagement row writes (suggestion only)

| Stage 2a field | Suggestion column | Rule |
|---|---|---|
| First name | `wmkf_reviewerfirstname` | Overwrite if changed |
| Last name | `wmkf_reviewerlastname` | Overwrite if changed |
| Display preference | `wmkf_reviewernickname` | Overwrite if changed |
| Title | `wmkf_reviewertitle` | Overwrite if changed |
| Affiliation | `wmkf_revieweraffiliation` (existing) | Overwrite if changed |
| Email | `wmkf_revieweremail` | Overwrite if changed |
| ORCID | `wmkf_reviewerorcid` | Overwrite if changed |
| Honorarium opt-out | `wmkf_honorariumoptout` | Set on accept |
| Decline reason (picklist) | `wmkf_declinereasonpicklist` | Set on decline |
| Decline reason (free text) | `wmkf_DeclineReason` (locked-for-add field) | Set on decline |
| Decline referral | `wmkf_declinereferral` | Set on decline |
| COI ack | `wmkf_coipolicyversion` + `wmkf_coiackedat` | Set on accept |
| AI-use ack | `wmkf_aiusepolicyversion` + `wmkf_aiuseackedat` | Set on accept |

### What we do NOT touch from Stage 2a

- **`wmkf_potentialreviewers`** — read-only at Stage 2a. Directory entry; staff-curated.
- **`contact`** — read-only **at Stage 2a** (the response handler). CRM record; staff-curated. No write to `firstname`, `lastname`, `nickname`, `jobtitle`, `emailaddress1/2/3`, `wmkf_orcid`, `adx_organizationname`, `parentcustomerid`, or anything else. This eliminates the prior plan's email-routing-to-`emailaddress2/3` complexity entirely (Codex finding #3). **This read-only rule is scoped to the Stage 2a handler; promotion-time sync is a separate, now-decided step — see the dated update under "Promotion to directory / CRM record" below.**

### Promotion to directory / CRM record (deferred, staff-controlled)

When staff later acts on engagement-scope corrections — e.g., during a "promote reviewer to contact" or directory-cleanup pass — they may copy values from the engagement row to potentialreviewer or contact. That UX is a separate build (Wave 2 reviewer migration territory). For slice 1, the suggestion row is authoritative for "what this reviewer told us"; the directory and CRM entries reflect staff curation only.

> **UPDATE 2026-06-27 (owner decision — supersedes the "staff-controlled, deferred" framing above for name/title).** Promotion of engagement-scope name/title to the CRM contact is now an **automatic, promotion-time sync** (NOT a manual staff copy): on the accept/promotion path, the reviewer's self-reported `firstName`/`lastName`/`title` **overwrite** `contacts.firstname`/`lastname`/`jobtitle` (reviewer-self-report-wins, silent, no conflict alert), gated to `wmkf_identitystatus ∈ {confirmed, probable}`. This is "Increment 2a" — see `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §"Increment 2a" for the full rationale. Affiliation/email/nickname remain deferred (2b). The Stage 2a *response handler* itself still does not write `contact` (§"What we do NOT touch" above) — the sync fires at promotion, mirroring the existing ORCID back-prop site.

**Downstream read contract.** Once Stage 2a ships, any reviewer-facing or staff review surface that displays reviewer contact info (review manager, COI tooling, reviewer history reports, expertise-matching, etc.) must prefer engagement-scope suggestion fields when populated, falling back to potentialreviewer / contact only when the suggestion field is null. Without this rule, downstream code silently reads stale directory data after a reviewer corrects something at Stage 2a. Spelling it out here so audits and reviews of those downstream surfaces have a rule to check against.

### `parentcustomerid` discrepancy signal (backlog)

When `wmkf_revieweraffiliation` (engagement-scope) differs from the linked contact's `parentcustomerid` account name, that's potentially load-bearing for COI judgment. Out of scope for slice 1, but per Codex finding #2 it's worth recording as a first-class backlog item rather than a "soft staff flag" handwave. Likely shape: a simple computed-or-staff-visible flag on the suggestion row that downstream COI tooling can read. Tracked in `docs/STRATEGY.md` or a dedicated backlog file once the surface is decided.

---

## 4a. Policy fetch and rendering

Policy text is fetched from Dynamics at page-render time and rendered inline in the modal. No code constants, no `lib/external/reviewer-policies.js`, no `check:policies` CI gate (drift impossible — there's no body in code to drift).

### Slot codes referenced by Stage 2a

Hardcoded in the page render path:

- `reviewer-coi` — Confidentiality and Conflict of Interest
- `reviewer-ai-use` — AI Use in Review

Adding a third policy to Stage 2a is a code change (extending the slot list); adding a new policy *body* for an existing slot is purely a Dynamics edit.

### Fetch path

The landing endpoint resolves each slot to its currently-active child:

```
GET wmkf_policys?$filter=wmkf_code eq 'reviewer-coi' and statecode eq 0
  &$expand=wmkf_active_version($select=wmkf_policy_versionid,wmkf_version,wmkf_title,wmkf_body)
```

Response payload includes `policies: { 'reviewer-coi': { id, version, title, body }, 'reviewer-ai-use': {...} }`. Cache pattern mirrors `prompt-resolver` — 5-minute TTL, invalidate on staff edit if needed.

### Acknowledgment semantics (named explicitly)

- **Per-engagement, not per-reviewer.** Each `wmkf_appreviewersuggestions` row is one engagement (one reviewer + one proposal). Acks live on that row. A reviewer who reviews three proposals across the same cycle acks three times across three rows. There is no cross-engagement carryover, no "this person acked last cycle" memo. The user-facing rule: *the reviewer acknowledges the current policy every time they review.*
- **Re-accept overwrites the prior ack timestamp + lookup.** If a reviewer accepts, comes back, declines, and re-accepts, the latest accept is binding; previous values are not preserved on the row. (Audit-row approach in §4 captures the prior values if a question ever arises.)
- **Historical acks pin to the exact version row.** The lookup `wmkf_coipolicyversion` points at the specific `wmkf_policy_version` row the reviewer saw. Even after staff retires that version and activates a new one, the historical ack still resolves to the original text via the lookup chain. No body-snapshot field needed on the engagement row — the version row IS the snapshot.
- **No version-mismatch race handling.** Policies don't change mid-cycle (per design doc + user direction). The accept endpoint records whichever child is active at accept time. The "page rendered v1, staff swapped to v2 in the seconds before submit" race is exceedingly unlikely and not designed for; if it ever happens, the audit + lookup chain make it trivially recoverable post-hoc.

### Immutability rules and staff-edit guardrails

These rules are what make the "version row IS the snapshot" provenance model actually hold. They're staff-policy plus a small amount of referential enforcement, not feature work — but they need to be named explicitly so future-us doesn't quietly violate them.

1. **Version rows are immutable once referenced.** Once any `wmkf_appreviewersuggestions` row's `wmkf_*_policy_version` lookup points at a `wmkf_policy_version`, that child's `wmkf_body`, `wmkf_title`, and `wmkf_version` fields must not be edited. To change the text, staff create a new child row under the same parent, mark it `Active` on the parent (which automatically retires the prior active), and the old child stays in place forever as the snapshot of what historical acks pointed at.
2. **Hard-delete is disallowed for used version rows.** Two enforcement layers, both required:
   - **Referential**: the lookup from `wmkf_appreviewersuggestions` to `wmkf_policy_version` uses `Restrict` cascade on delete, so a delete of a referenced child fails at the database level. Unreferenced drafts can be hard-deleted; referenced rows cannot.
   - **Security role**: `wmkf_policy_version` and `wmkf_policy` should have edit / delete privileges restricted to a small admin role. Ordinary staff who can edit policy bodies should NOT have delete privilege on used rows. Application-level "don't delete used rows" guidance is not enforcement — Dataverse security roles are. Configure as part of the schema-deploy commit.
3. **Activation is staff-controlled, not date-driven.** `wmkf_effective_date` on the child is informational/audit only — the page render and accept paths read `wmkf_active_version` on the parent. There's no scheduled activation; staff flip the lookup when they want a new version live.
4. **Version labels are operationally meaningful.** They appear in screenshots, printouts, and audit trails. Staff convention should be deliberate (date stamps like `2026-05-09` or explicit version numbers like `v1.2`), not random strings.
5. **Acknowledgments are per-engagement.** There is no person-level "this reviewer has acked COI" cache. Every engagement requires its own ack against the then-active version. Cross-cycle/person-level consent reuse is explicitly out of scope; if a future surface needs that semantic (e.g., applicant T&C with one-time-per-person acceptance), it requires a separate acknowledgment entity, not a change to this model.

---

## 5. API surface

Stage 2a **extends the existing `/external/review/[token]` route family** rather than adding a parallel `/external/landing/*` (Codex finding #6). The existing context endpoint already loads the suggestion + request + reviewer in one round trip; we widen its response payload, add accept/decline endpoints under the same prefix, and let page state drive which UI renders.

All token-authenticated via the existing `verifySuggestionToken` primitive in `lib/external/verify-suggestion-token.js`. All writes go through `lib/dataverse/adapters/reviewer-suggestion.js` (the canonical write path) so picklist mapping and field-name conventions stay centralized.

### `GET /api/external/review/[token]/context` (existing — extended)

Currently returns: token verification + suggestion + request + reviewer. Stage 2a widens the response to add:
- Proposal summary card data: `akoya_request` title, applicant institution (account display name via `akoya_applicantid` expansion), abstract, PI name, co-PI list (from `wmkf_copi1..5` lookups)
- Prefilled contact form values (per priority list in §3)
- Honorarium default state (false unless previously set)
- Active policies (fetched once per request, cached 5 min): `policies: { 'reviewer-coi': {...}, 'reviewer-ai-use': {...} }`
- Current engagement state: `responseType` from `wmkf_responsetype`, `responseReceivedAt`, `accepted`, `declined`, `reviewStatus` (drives which view shows)
- Reversibility flag: `canFlipState` — true if `wmkf_reviewstatus` is at or before `accepted` (i.e., materials have not been sent and not been downloaded). When false, accept/decline buttons are hidden and copy explains "contact your PD to change your response."
- The existing `wmkf_proposalfirstaccessed` stamp behavior on first GET is preserved (best-effort; non-fatal).

### `POST /api/external/review/[token]/respond` (new — handles both accept and decline)

A single endpoint instead of two, because the decision-tree on the server side is identical (state guards + idempotency + adapter call), and the picklist that distinguishes them (`wmkf_responsetype`) is already structured around accept/decline/no_response/withdrawn_sufficient. The body discriminates:

```
POST /api/external/review/[token]/respond
{
  "action": "accept" | "decline",

  // For action: "accept"
  "contactEdits": { firstName?, lastName?, nickname?, title?, affiliation?, email?, orcid? },
  "honorariumOptOut": boolean,
  "policyAcks": { "reviewer-coi": true, "reviewer-ai-use": true },

  // For action: "decline"
  "decline": { reasonPicklist?: string, reasonText?: string, referral?: string }
}
```

#### Server-side checks (in order)

1. **Token verification** — existing `verifySuggestionToken`. Failure → existing reason-coded error states (expired/revoked/etc.).
2. **State-machine guard** — read current `wmkf_responsetype` and `wmkf_reviewstatus`. Compute permitted transitions per §6a state-machine table; reject 409 if requested action isn't permitted from current state. Hard-locks once `wmkf_reviewstatus >= materials_sent` (configurable boundary; see §6a).
3. **Idempotency** — if requested `action` matches current state already (e.g., already-accepted reviewer clicks accept again), return 200 with same confirmation payload as a fresh accept; do **not** re-stamp `wmkf_responsereceivedat` or rotate ack lookups. The audit log captures the no-op as a `wmkf_proposalfirstaccessed`-style read; no state mutation. This handles double-click and two-device cases naturally.
4. **For `accept` only — policy-ack validation:**
   - Both `policyAcks['reviewer-coi']` and `policyAcks['reviewer-ai-use']` are `true` (else 400).
   - Active-child sanity check per slot (else 500): parent exists and is active; `wmkf_active_version` is non-null; child belongs to parent; child is `Active`. Failure logs an alert and returns "this is on us" to the reviewer.

#### Effects on `accept`

Single transaction (rollback on any failure):
1. Write engagement-scope contact corrections to suggestion (per §4 write rules — only changed fields, only the suggestion row).
2. Re-fetch each slot's `wmkf_active_version` lookup; set `wmkf_coipolicyversion` + `wmkf_coiackedat` + `wmkf_aiusepolicyversion` + `wmkf_aiuseackedat`.
3. Set `wmkf_honorariumoptout = body.honorariumOptOut`.
4. Set `wmkf_accepted = true`, `wmkf_declined = false`, `wmkf_responsetype = accepted`, `wmkf_responsereceivedat = now()`.
5. Clear `wmkf_DeclineReason`, `wmkf_declinereasonpicklist`, `wmkf_declinereferral` if a prior decline state existed (transitioning from declined to accepted).
6. Return the accepted engagement state. The subsequent verified `/context`
   refresh resolves the request's assigned active Program Director to
   `{ name, email }` for the confirmation view; missing, disabled, incomplete,
   or unreadable staff data leaves the generic guidance in place.

#### Effects on `decline`

1. Set `wmkf_DeclineReason`, `wmkf_declinereasonpicklist`, `wmkf_declinereferral` from body.
2. Set `wmkf_accepted = false`, `wmkf_declined = true`, `wmkf_responsetype = declined`, `wmkf_responsereceivedat = now()`.
3. Leave existing policy-ack lookups intact (they describe the prior accept; not load-bearing while declined; per §4a immutability rules).
4. Return decline confirmation copy.
5. **Email triggers deferred** — the design doc's decline-acknowledgment email + referral-deep-link-to-PD email tie to PA workflows that don't exist yet. Stamp the response on the row; trigger emails in a follow-up build.

### Optimistic locking on the suggestion row

All writes to `wmkf_appreviewersuggestions` use `If-Match` with the row's `_etag` from the page load. On 412 conflict (row modified between load and submit — staff intervened, or a parallel-tab submit landed first), the page re-fetches and re-renders rather than retrying blindly. The token primitive already supports this; standard Dynamics Web API behavior.

---

## 6. Page composition

**Same ROUTE/page across the journey** — `pages/external/review/[token].js`, with page state driven by `/context` picking which view renders — rather than a parallel `pages/external/landing/[token].js`. NOTE (corrected 2026-06-21): the design doc's older "the URL does not change" wording was wrong about the LINK — the send path re-mints the token per email, so the full URL (its token) changes between invitation/materials/reminders; the stable thing is the route + the engagement it resolves, not the link. See `REVIEWER_INTERACTION_DESIGN.md` Stage 4.

### View dispatch (driven by `/context` response)

| Engagement state | View shown |
|---|---|
| Not yet accepted/declined, materials not sent | **Stage 2a (this slice)** — proposal summary + contact-correct + honorarium + policy acks + accept/decline |
| Accepted, materials not sent | Post-accept confirmation with assigned Program Director name/email when available (ICS calendar invites deferred) |
| Declined, before any materials access | Post-decline confirmation (Stage 3 — minimal copy in slice 1) |
| Accepted, materials sent | Stage 2b — current behavior of `pages/external/review/[token].js`, file list + review form (out of scope; existing) |
| Submitted, within 7-day post-submission window | Read-only review (existing behavior) |
| Withdrawn-Sufficient | "Thanks; we no longer need you for this review" terminal screen (Stage 4 build) |

The current `pages/external/review/[token].js` already dispatches loading/error/ready states; the change is widening the ready-state to a state-machine switch.

### Stage 2a stack

Stack on the page:
1. Proposal summary card — title, applicant institution, PI, co-PIs, abstract. Read-only.
2. "Confirm your contact info" card — six text fields (first name, last name, nickname, title, affiliation, email) + ORCID. Inline-editable.
3. "Honorarium" card — single checkbox: "I'd prefer to decline the honorarium." Default unchecked.
4. **Policy acknowledgment cards (two, stacked, compact).** Each card shows the policy title + a `Read policy →` button that opens a modal containing the active version's full body. The modal's `I have read and acknowledge` button is initially disabled (label: `Scroll to acknowledge`); enabled when the reviewer scrolls the body container to within ~20px of the bottom, OR immediately if the body fits without overflow (short policy edge case). Closing the modal without acknowledging leaves the parent card unchanged. After ack, the card flips to `✓ Acknowledged · v<wmkf_versionlabel>` with a quieter `View again` link to re-open the modal read-only. Version label visible in card state so it's captured in any screenshot/print.
5. Accept / Decline buttons. **Accept is disabled until both policy cards are in the acknowledged state.** Decline transitions the page dispatcher to a dedicated `decline-form` view (not a modal — referral capture is the highest-value field and benefits from a full-page layout with generous textarea + helper copy). Same URL, same token; back-navigation returns to Stage 2a.

### Behavior

- **Decline UI:** dedicated `decline-form` view in the dispatcher (locked S143). Page layout, not modal — generous referral textarea (6+ rows), reason picklist + optional reason text, primary `Submit` button + secondary `Submit without explanation` affordance. Referral-first / reason-second field order per design doc.
- **Policy ack UI:** modal per policy (locked S143) with scroll-to-bottom-enables-ack (auto-enable for short policies that don't overflow). Reviewers expect the read-and-click compliance pattern; AI-use policy in particular is content reviewers will want to read substantively.
- **Form-factor target:** desktop / laptop / iPad. Mobile renders gracefully via Tailwind defaults but is not a design target; address mobile-specific issues only on user complaint.
- Decline does not require contact-form completion or policy acks.
- Accept requires both policy acks (UI gate + server validation). Does **not** require contact-form completion — fields are pre-filled from suggestion / potentialreviewer / contact. If the reviewer hasn't edited anything, no engagement-row corrections are written; only the ack lookups, honorarium opt-out, and response stamps. (This is named explicitly because Codex finding #8 flagged it as an implicit decision.)
- Honorarium opt-out is **editable on the page but only persists on accept submit.** No autosave. Same applies to contact corrections — slice 1 does not implement Google-Docs-style draft persistence (per design doc that's a Stage 4 working-window feature).
- Both buttons disabled during in-flight save with optimistic-lock guard (the suggestion row's `_etag` round-trips through the page; 412 → re-fetch and re-render).
- Reversibility-flip case: a reviewer returning to the page after acceptance and flipping to decline is handled the same as a fresh decline (no policy ack needed; engagement decline fields set, response stamps updated). The accepted policy ack lookups remain on the row but aren't load-bearing while `wmkf_responsetype = declined` — see §4a immutability rules.

---

## 6a. State-machine and reversibility lock

Per Codex finding #7. Defines what state transitions Stage 2a permits, and what locks them.

### Permitted transitions (server-enforced)

| From | To `accept` | To `decline` | Notes |
|---|---|---|---|
| `no_response` (initial) | ✓ | ✓ | First click of either button |
| `accepted` | (idempotent) | ✓ | Reversibility flip; allowed until materials sent |
| `declined` | ✓ | (idempotent) | Reversibility flip; allowed until materials sent |
| `accepted` w/ `reviewstatus >= materials_sent` | ✗ | ✗ | **Locked.** Reviewer redirected to "contact your PD" copy. |
| `withdrawn_sufficient` | ✗ | ✗ | Terminal; staff withdrew the invitation. |

### What "until materials sent" means concretely

The reversibility lock is keyed off `wmkf_reviewstatus`. The picklist already exists on the suggestion: `accepted=100000000 / materials_sent / under_review / review_received / complete=100000004`. Stage 2a permits flip while `wmkf_reviewstatus` is at or before `accepted`; locks once it reaches `materials_sent`.

This is more conservative than the design doc's "until materials are downloaded" — `materials_sent` is the staff action of releasing materials, which precedes any reviewer download. Picking the earlier signal avoids a TOCTOU question (downloads can happen concurrently with a flip submit). If staff have explicitly released materials to a reviewer, that reviewer no longer has a self-service flip button.

### Idempotency

A repeat of the current action (e.g., already-accepted reviewer clicks accept again, or a double-click sends two requests) returns success without re-stamping `wmkf_responsereceivedat` or rotating policy-ack lookups. The `wmkf_proposalfirstaccessed` field captures the page-visit; the engagement row is not mutated by a no-op submit. Two-device concurrent accept-clicks land on the same outcome via the same idempotency check.

### What is **not** designed for

- Concurrent staff-write + reviewer-write race past optimistic locking. If a staff member edits the suggestion row between the reviewer's page load and submit, the reviewer's submit fails 412 and re-renders. Reviewer can re-confirm; staff edit is preserved.
- Token reuse across multiple sessions on different devices is supported by the existing primitive (token isn't bound to a session). Both sessions hit the same suggestion row and the idempotency + state-guard rules handle the rest.
- A reviewer who declines and then waits past materials_sent before returning is locked out of self-service flip; "contact your PD" is the path. Reviewer never sees a Reset button.

---

## 7. What's deferred to follow-ups

| Item | Build | Notes |
|---|---|---|
| Calendar invites (ICS) on accept | Slice 3 | Includes `wmkf_ics_uid_materials` / `wmkf_ics_uid_due` fields on potentialreviewer for reschedule support |
| Decline-acknowledgment + referral-handoff emails | Slice 3 or PA-side | Trigger lives on accept/decline endpoints; email body templates pending design |
| Stage 2b (materials-available) state on same URL | Stage 4 build | Backend status flip already accounted for |
| Reminder cadence | Stage 4 build | Cron job per design doc |
| "We're full" cancellation | Stage 4 build | PD-initiated; needs Review Manager UI affordance |

---

## 8. Open questions

1. ✓ **Dataverse entity audit on `wmkf_appreviewersuggestion`** — enabled in Session A via `scripts/enable-suggestion-audit.mjs`.
2. ✓ **PD email/name on the post-accept confirmation screen — resolved
   2026-07-24.** The verified request supplies
   `akoya_request._wmkf_programdirector_value`; only the
   `accepted-pre-materials` context branch reads that active `systemuser` for
   `fullname` + `internalemailaddress`. The page shows both parenthetically
   with a `mailto:` link. Missing, disabled, incomplete, or failed lookup data
   is non-fatal and preserves the generic "your Program Director" guidance.
   `[VERIFIED via lib/services/external-review/context-service.js,
   pages/external/review/[token].js,
   shared/components/external/AcceptedConfirmationView.js, and focused
   service/route/component tests]`
3. ✓ **`wmkf_DeclineReason` deployment** — shipped in Session A wave 3.
4. ✓ **`wmkf_responsetype` picklist extension** — `withdrawn_sufficient=100000003` added in Session A via `scripts/extend-responsetype-picklist.mjs`.
5. **`parentcustomerid` discrepancy signal — backlog framing.** Deferred from slice 1 but should not stay vague indefinitely. Decide before COI tooling builds whether this is a computed staff-visible flag, a discrepancy-detection cron, or a real-time check at COI judgment time.
6. ✓ **Decline UX = dedicated page in dispatcher; policy acks = scroll-to-ack modals (locked S143).** See §6 page composition.
7. **COI policy body content.** AI-use body lifts directly from the existing review form footer. COI body uses an explicit `[PLACEHOLDER]` in the seeded `wmkf_policyversion` row; staff feedback must land, then create a new version row in Dynamics and flip the `reviewer-coi` parent's `wmkf_activeversion` lookup before slice 1 ships to a real cycle.
8. ✓ **Form-factor target = desktop / laptop / iPad** (locked S143). Mobile renders gracefully via Tailwind defaults; not optimized; address only on user complaint.
9. **Dataverse security role for `wmkf_policy*` delete privilege** — TODO before slice 1 ships to a real cycle. Restrict delete to admin role; ordinary policy-body editors should not be able to hard-delete used version rows. Per immutability rules in §4a.

---

## 9. Out-of-scope reminders (carried from design doc)

- No PD-comparative metrics
- No "willing to review again" capture
- No outcome notification
- No inline guidance on the form itself

---

## 10. Sessions A–B status (shipped) and Session C self-check

### Sessions A and B — shipped

- [x] Wave 3 schema deployed (commit `d07e72a`): `wmkf_policy`, `wmkf_policyversion`, 13 new fields on `wmkf_appreviewersuggestion`, two policy lookups, alt-key on `wmkf_policy.wmkf_code`
- [x] `wmkf_responsetype` picklist extended with `withdrawn_sufficient = 100000003`
- [x] Dataverse entity audit enabled on `wmkf_appreviewersuggestion`
- [x] Two `wmkf_policy` parents seeded with one Active child each (COI body is an explicit placeholder pending staff wording — open question 7)
- [x] Atlas pages updated: `dataverse-wmkf-appreviewersuggestion.md` extended, new `dataverse-wmkf-policy-and-policy-version.md`
- [x] `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` audit row appended
- [x] Backend code (commit `18c69ec`): policy-fetcher, extended `/context`, new `/respond` endpoint, adapter additions including `applyStage2aResponse`, optimistic locking via `If-Match`, idempotency, active-child sanity, state-machine guard
- [x] `docs/API_ROUTE_SECURITY_MATRIX.md` updated for new `/respond` route
- [x] All five CI gates green throughout: `check:atlas`, `check:atlas:self-test`, `check:api-routes`, `check:doc-currency`, `check:doc-currency:self-test`
- [x] `npm run build` succeeds end-to-end

### Session C — self-check before commit

- [ ] State-driven view dispatcher renders the right Stage 2a / accepted-pre-materials / declined / decline-form / stage2b / submitted / withdrawn-sufficient view based on `engagementState.view` from `/context`
- [ ] Browser back-button works for Stage 2a ⇄ decline-form transitions (use `history.pushState` with discriminated state object, not just local React state)
- [ ] Browser refresh on any view lands deterministically — view comes from server engagement state, not preserved client state
- [ ] Screen-reader focus moves to the new view's heading on dispatch transitions
- [ ] Modal scroll-to-bottom detection re-checks on viewport resize, font-size change, and after first markdown render (not just at initial mount)
- [ ] Auto-enable for short policies (body fits without overflow at first measurement) works correctly
- [ ] Accept button disabled until both local ack states are true; mirrors server's `policy_ack_required` validation
- [ ] Decline form allows submit without contact-correction or policy-ack completion
- [ ] 409 (state-machine guard) and 412 (optimistic-lock conflict) paths render clear, recoverable copy and re-fetch where appropriate
- [ ] Idempotent repeat actions (double-submit, two-device click) don't mutate visible state unexpectedly
- [ ] Existing Stage 2b review-form path remains functional for `view === 'stage2b'` users (regression check on the materials-view flow)
- [ ] All five CI gates green
- [ ] `npm run build` succeeds
- [ ] Smoke verification against the production test suggestion: end-to-end accept and decline flows on a real engagement
