---
title: "Reviewer ORCID Back-Propagation Design (S216)"
domain: reviewer-identity
kind: spec
status: active
summary: "Shipped reviewer-to-Contact ORCID propagation design; the historical backfill's rollback window closed after aggregate production reconciliation."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/backprop-reviewer-orcid.js
  - scripts/backfill-contact-orcid.js
  - docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md
  - scripts/probe-orcid-cross-store-matches.js
---

# Reviewer ORCID Back-Propagation Design (S216)

**Status:** **SHIPPED** (updated 2026-07-27) — was "DESIGN rev3, build-ready for PR1". Both
increments are live: PR1 (resolver-gated reviewer ORCIDs flow onto matched contacts at
outreach/promotion) is `lib/services/backprop-reviewer-orcid.js` via
`contactAdapter.setOrcidIfAbsent`; PR2 (one-shot historical catch-up of the already-eligible pool)
is `scripts/backfill-contact-orcid.js`. Both use the fill-only, conflict-surfacing,
contact-never-created safety described below. A read-only production reconciliation
confirmed all 162 historical fills still match exactly, so the PR2 rollback window is
closed. The ignored checkpoint sources were disposed on 2026-07-27 after their
byte-preserved private archive copies and the aggregate reconciliation were verified.
Read the design body as historical rationale.
**Author:** S216. **Depends on:** S214/S215 identity resolver + ORCID backfill
(`docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`, memory
`project-reviewer-identity-resolution-phase1`).

## 1. Problem & goal

The S215 backfill wrote authoritative ORCIDs to **1,533** `wmkf_potentialreviewers`
rows. The S216 cross-store probes (`scripts/probe-orcid-cross-store-matches.js`,
`probe-orcid-contact-direct-join.js`, `probe-contact-orcid-provenance.js`) measured
ORCID's *current* cross-store power as modest because the **far side of each join is
ORCID-sparse**: only 18 reviewer ORCIDs appear in `contact`, and `contact`'s 423
ORCID values are a largely-disjoint GOapply *applicant* population (52% are PIs via
`wmkf_projectleader`).

**De-fragmentation is therefore a FLOW problem, not a one-shot collapse**
(memory `reviewer-identity-fragmentation`). This design makes the reviewer-pool
ORCIDs **flow onto their matched `contact` rows** so `contact.wmkf_orcid` becomes a
durable cross-store join key over time — without creating or polluting contacts.

> **Not purely backend — two visibility surfaces (Codex #17 + confirmation pass).**
> (a) *Reviewer-facing*: `pages/api/external/review/[token]/context.js` reads
> `contact.wmkf_orcid` as a **lowest-priority Stage 2a prefill**, but only
> `if (contactId)` — i.e. only when the reviewer is *already promoted*. So a
> back-propagated ORCID reaches a reviewer (as editable prefill) **only after genuine
> promotion**, never on a bare email match; the no-auto-promotion decision (§8.1)
> bounds this. (b) *Staff-facing*: Dynamics Explorer exposes `contact.wmkf_orcid` as a
> readable contact field (`shared/config/prompts/dynamics-explorer.js`), so any
> back-propped value is visible to staff querying that contact — **accepted as intended**
> (it's a standard CRM field staff can already browse). Both surfaces are why we keep
> the institution-corroborated-`probable` bar: the value is user-visible, not just a
> backend key.

### Non-goals (explicit scope fences)
- **No contact creation by back-prop.** The ~1,348 reviewers with no existing contact
  match stay unmatched. Creating contacts = registry pollution (fragmentation memory:
  "de-dupe + curation, not creation"). **Clarification (Codex #11):** PR1's runtime hook
  runs *after* the existing outreach promotion, which legitimately find-or-creates a
  contact; filling ORCID on that just-created contact is in scope. What's out of scope
  is creating a contact *solely* to hold an ORCID — the PR2 backfill never creates.
- **No auto-promotion.** Back-propagation must NOT set the reviewer→contact link
  (`wmkf_Contact` / `_wmkf_contact_value`) — see §8.1.
- **No bibliometric propagation.** `contact` has only `wmkf_orcid` (no `wmkf_orcidurl`,
  no identity-status fields). We write the bare iD only; no new contact schema.
- **No writes to `akoya_request`.** Honorarium rows carry no ORCID field; the reviewer
  person lives in the linked `contact`, covered by contact back-prop.
- **No reviewer-side import.** We do NOT pull GOapply applicant ORCIDs into the reviewer
  pool here (applicants ≠ reviewers, mostly). Possible future, separate design.

## 2. Eligibility gate (correctness-critical)

> **Eligible iff** `wmkf_orcid` is present AND `wmkf_identitystatus ∈ {confirmed, probable}`.

Rationale: the S214/S215 persistence gate already blocks ungated ORCID writes and the
S214 remediation *cleared* wrong-match ORCIDs (Noe→Clementi). Reading
`wmkf_identitystatus` rather than trusting field-presence is defensive against any
pre-gate legacy value still sitting on a row. The status field is on the same row
(written by `researcher.writeIdentityDecision`, S214).

**Null-status exception (Codex #5).** Exactly **1** of the 1,533 ORCID rows has a null
`wmkf_identitystatus` (a pre-gate value the S215 backfill skipped because it already had
an ORCID). The gate correctly drops it. PR2 `--resolve` emits these as an explicit
`action: 'status_null'` exception category (not silently `nocontact`) so identity-state
drift is visible and can be remediated separately, not buried.

## 3. Matching: reviewer → contact

A shared resolver (used by both mechanisms) resolves the target contact for an eligible
reviewer, in this precedence:

1. **Already linked** — `_wmkf_contact_value` set → use that contactid directly.
2. **Email match** — normalized `contact.emailaddress1 == wmkf_emailaddress`. If the
   email matches **>1 contact → return `ambiguous` → skip + log**; do not guess.
3. No contact → return `none` → skip (non-goal: no creation).

**Ambiguity is unenforceable on the current adapter (Codex #1 HIGH + confirmation pass —
accepted).** `contactAdapter.findByEmail` uses `top: 1`, so it silently returns an
arbitrary contact and *cannot detect* the 7 ambiguous cases. PR1/PR2 MUST add a **new,
separate** resolver — `resolveForBackprop(email)` selecting `top: 2` and returning
`{ contactId }` | `{ ambiguous: true }` | `{ none: true }`. **Leave `findByEmail` (top:1,
record|null) and `findOrCreateByEmail` UNCHANGED** — the latter relies on
`findByEmail`'s truthy-record-or-null contract to create-on-true-miss, and the existing
promotion flow depends on that. Do not retrofit ambiguity onto the existing functions;
the back-prop path calls the new resolver, the promotion-create path keeps the old one.
The skip is only real if the resolver can see the duplicates.

**Email normalization (Codex #2 — accepted).** Trim + lowercase the reviewer email
before the lookup, and compare normalized emails in code rather than relying solely on
Dataverse collation. The OData filter uses the normalized value; the in-code compare is
the authority.

**ORCID normalization (Codex #4 — accepted, centralized).** A single shared helper
extracts the canonical `\d{4}-\d{4}-\d{4}-\d{3}[\dX]` shape **and validates the ORCID
mod-11-2 checksum**, returning one of `{ empty, valid(id), malformed }`. This makes the
conflict policy (§4) honest: a shaped-but-checksum-invalid value classifies as
`malformed`, never as a "different valid iD." Used by the resolver, `setOrcidIfAbsent`,
and the probes.

**Measured action breakdown (S216).** Of the 1,533 ORCID rows, 1 has null status →
**1,532 eligible**. Matching the eligible set to contacts by **distinct, present** email
(the probe dedupes by email and drops no-email rows, so this sums to 1,531 — one eligible
row lost to that dedup/no-email): **162 WRITE** (target ORCID empty), 14 noop (same iD),
**0 conflict**, 0 malformed-target, 7 ambiguous, 1,348 no-contact. Backfill yield = **162
writes**; the 183 email-match figure = 162 + 14 + 7. **Live note (Codex #18):** only **2**
reviewers carry `_wmkf_contact_value` today and **neither has an ORCID** — so the
already-linked-with-ORCID set is 0 *today*; §3.1's already-linked handling is a
**forward**-correctness requirement (it bites as `enrich-recommended` links more), not a
current-data bug.

## 4. Conflict policy on the target contact (correctness-critical)

`setOrcidIfAbsent` re-reads the contact's **current** `wmkf_orcid` by contactid, runs it
through the centralized normalizer (§3), and branches:

| Contact ORCID state | Action |
|---|---|
| empty / null | **WRITE** the reviewer's ORCID (the happy path) |
| same iD (normalized) | no-op |
| **different valid iD** | **DO NOT overwrite** — return `conflict` + log. Two authoritative-but-different ORCIDs for one email is a real identity problem; GOapply self-report stays authoritative. Surface, never clobber. |
| **malformed** | return `malformed` + log for manual cleanup. Never auto-overwrite. |

We **only ever fill an empty contact ORCID** — safe, idempotent, respects GOapply as an
authoritative self-report source. Malformed values **exist in the wild** (the probe found
`wmkf_orcid = "1234567"` on a live contact; 14 of 423 are unparseable), so the malformed
branch is live code, not defensive dead weight.

## 5. Shared back-prop helper (resolves Codex #7/#8/#9/#10/#22)

The single most important review catch: ORCID back-prop must NOT live inline in
`send-emails.js`. Every site that links a reviewer to a contact is a back-prop trigger.
Encapsulate the flow in one helper:

```
backPropReviewerOrcidToContact({ reviewer, contactId, actingUserSystemId }):
  if reviewer not eligible (§2): return { skipped: 'ineligible' }
  cid = contactId ?? reviewer._wmkf_contact_value      // run even when already linked
  if !cid: return { skipped: 'no_contact' }
  return contactAdapter.setOrcidIfAbsent(cid, reviewer.orcid, { actingUserSystemId })
```

Crucially it runs against `contactId (just promoted) ?? existing pointer` — **not** gated
behind `if (!_wmkf_contact_value)` — so already-linked reviewers with an empty-ORCID
contact are still filled (Codex #8, HIGH).

> **Caller field-hydration contract (Codex confirmation pass, HIGH).** The helper reads
> `reviewer.{wmkf_orcid, wmkf_identitystatus, _wmkf_contact_value}`. None of the three
> call sites currently loads all three — **each caller MUST hydrate them before calling**,
> or the helper silently no-ops (eligible→ineligible, or pointer→undefined). This is the
> finding that keeps PR1 from being a one-line insert. Per site:
> - **send-emails**: extend the `person` `$select` (L145) — currently
>   `…,_wmkf_contact_value` but **no** `wmkf_orcid,wmkf_identitystatus`.
> - **honorarium**: the `reviewer` object originates from `verifySuggestionToken`
>   (`lib/external/verify-suggestion-token.js` select, ~L77) and is passed through
>   `respond.js` (~L257) — that select also lacks the three fields; extend it there.
> - **enrich-recommended**: the endpoint **fetches then discards** the person after using
>   affiliation (~L149→L251), so `_wmkf_contact_value` is out of scope at the writeback
>   call — retain the person (or its pointer) through to the post-writeback hook.

### Call sites
1. **`pages/api/review-manager/send-emails.js`** (Codex #8) — the outreach promotion
   block (~L300-312). Call the helper after promotion, with the just-found/created
   `contactId` OR the existing pointer. Non-fatal (email already shipped; the helper's
   operational throw is caught by the existing inner try/catch — confirmation pass
   verified this does NOT move the recipient to `failed`). **The Candidates invite path
   routes through this endpoint (Codex #10, confirmed), so it's covered for free once the
   helper is correct.**
2. **`lib/bill/honorarium-onboard-orchestrator.js`** (Codex #7, HIGH) — `ensureContact` /
   the promote-on-accept fallback (L131/L142) is a *second* promotion site. Wire the same
   helper there. Requires (a) threading `actingUserSystemId` into the orchestrator's
   contact helpers, which they don't accept today (Codex #13), and (b) the
   `verify-suggestion-token` select extension above — do both first.
3. **`pages/api/workbench/enrich-recommended.js`** (Codex #9) — writes a reviewer's
   `wmkf_orcid` + `wmkf_identitystatus` without promoting. After that identity writeback,
   if the reviewer is already linked (`_wmkf_contact_value`), call the helper so a newly
   eligible ORCID flows immediately instead of waiting for a later send. Keep the fetched
   person in scope (see hydration contract above).

### `contactAdapter.setOrcidIfAbsent(contactId, orcid, { actingUserSystemId })` contract
- **Re-read by contactid** (Codex #12) — `getRecord('contacts', contactId, { select:
  'contactid,wmkf_orcid' })`. Do NOT reuse `findByEmail` (wrong field set + reintroduces
  ambiguity).
- Apply §4; return a **data-state status** `{ action: 'write'|'noop'|'conflict'|'malformed' }`.
- **Error posture (Codex #14):** data-state classifications return a status and do not
  throw. **Operational** errors (transport, 403/permission, Dataverse validation) THROW —
  callers decide. This prevents the backfill from reporting "safe" while silently not
  writing.
- **Atomicity (Codex #3 — right-sized):** the write is get-then-PATCH. Because the policy
  is fill-only, a race only matters if two writers PATCH *different* ORCIDs onto one empty
  contact (the §5 duplicate-target case). Mitigations, in order: (a) emit an `If-Match`
  conditional PATCH if `DynamicsService.updateRecord` supports an ETag/precondition (verify
  during impl; 412 → re-read + re-evaluate); (b) else operationally serialize — do not run
  the PR2 backfill during active outreach — and the doc's claim is "race-tolerant,
  last-writer-wins on an empty field," not "atomic." Not a build blocker.

## 6. PR2 — one-shot historical backfill (162 writes; 183 email matches)
New `scripts/backfill-contact-orcid.js`, mirroring `backfill-orcid-identity.js`'s
resumable two-phase shape:
- `--resolve` (read-only): for every eligible reviewer, resolve the target contact (§3),
  classify against current contact ORCID (§4), emit `scripts/.contact-orcid-backfill.jsonl`
  (gitignored — person data) with `{reviewerId, email, orcid, status, contactId, action}`
  where `action ∈ write|noop|conflict|malformed|ambiguous|nocontact|status_null`.
  **Group by `contactId` (Codex #6):** if two eligible reviewers resolve to the same empty
  contact, only the first is `write`; the rest become `noop`/`conflict` against the
  pending write. Surface duplicate-target collisions so the `+162` projection is stable.
- `--summary`: tally the JSONL without writing.
- `--apply`: write only `action==='write'` rows via `setOrcidIfAbsent` (re-reads → still
  safe if state changed since `--resolve`). Resumable checkpoint (gitignored).
- Writes through `bypassDynamicsRestrictions('backfill-contact-orcid', …)` with the same
  gated adapter path production uses.

## 7. Provenance and closed rollback window — via native Dataverse audit

Codex #15 (HIGH) correctly flagged that a gitignored JSONL is not durable provenance for
runtime writes. **Resolved without new schema by an S216 capability probe**
(`scripts/probe-dataverse-audit-capability.js` + targeted check):
- Org auditing **ON**; `contact` entity auditing **ON** (268/412 attrs);
  **`contact.wmkf_orcid` `IsAuditEnabled = true`.**
- `RetrieveRecordChangeHistory(contacts(id))` returns **200** and surfaces `wmkf_orcid`
  changes with **actor + old value + timestamp**. (The bulk `/audits` aggregate is **403**
  — `ReadAuditSummary` privilege gap — but the per-record path is what we need.)

So every back-prop write is **durably captured natively**: actor distinguishes our
service principal from GOapply's "# BCO akoyaGO Integration" and manual "Bromelkamp Admin"
edits; the prior value is retained. **No `wmkf_orcidsource` field** (§8.3). Reversibility
(Codex #16) was available during the bounded post-run window: the JSONL/runtime counters
indexed contacts touched, while the Dataverse per-record audit remained the durable
truth.

**Rollback-window closure (2026-07-27).** A read-only production reconciliation compared
the complete historical apply checkpoint with current Contact state. All 162 projected
writes had an applied decision, all 162 target Contacts still held the intended normalized
ORCID, and there were zero different-valid, missing, malformed, not-found, or read-failure
outcomes. The rollback window is therefore closed. The two ignored checkpoints are now
disposed source artifacts; their owner-only archived copies remain audit evidence, not
instructions for a future bulk clear. Clearing values based on those historical records
could erase a value independently confirmed after the backfill.
Any future correction must be a new reviewed remediation based on current evidence and
native record history. See
`docs/audits/local-operational-data-retention-audit-2026-07-27.md`.

## 8. Decisions

### 8.1 Auto-promotion — set the `wmkf_Contact` pointer during back-prop? → **NO**
The pointer is **load-bearing**: `honorarium-onboard-orchestrator.js:131` (payment-onboarding
contact), `external/review/[token]/context.js` (reviewer-facing contact name + ORCID
prefill), `send-emails.js:302` (gates outreach promotion), `membership-service.js`,
`contact-history.js`, `generate-emails.js`. Setting it on a fuzzy email match asserts
"this reviewer IS this CRM contact" into payment + reviewer-facing flows — the
discovery≠identity error class the resolver work exists to prevent
(`project-reviewer-identity-resolution`); the 7 ambiguous cases prove email isn't 1:1.
**Asymmetry:** writing `contact.wmkf_orcid` is fill-only + reversible (low stakes);
setting the pointer is an identity assertion (high stakes). Back-prop writes the ORCID
field only. This decision also *bounds Codex #17*: a back-prop ORCID becomes
reviewer-visible only after a genuine promotion sets the pointer, never on a bare match.

### 8.2 Conflict surfacing — log-only, or review queue / alert? → **log-only + counters**
**Measured conflicts = 0.** Conflict/malformed branches route to `console.warn` + the
backfill JSONL — no `system_alerts` row or review queue. **Runtime durability (Codex #21):**
the send-emails response already returns a per-recipient `contactPromoted` field; add an
`orcidBackprop: {action}` sibling, and aggregate `written/noop/conflict/malformed/error`
counters into the response so a runtime failure isn't a vanished `console.warn`. Native
audit (§7) is the durable record. Escalate to `system_alerts` only if the conflict counter
becomes non-trivial.

### 8.3 `contact.wmkf_orcidsource` provenance field → **NOT NEEDED** (was "defer")
Resolved by §7: native attribute auditing on `contact.wmkf_orcid` already records
actor/old/new/time per record. A custom source field would duplicate that and fight
schema-minimization (`feedback-human-legibility-schema-principle`). Revisit only if a
**read-time** consumer must branch on source without a history call (none today).

## 9. Verification / metrics
- Pre/post `count(contacts where wmkf_orcid ne null)` — expect **+162**.
- **Primary correctness check (Codex #24):** verify writes against the backfill/runtime
  audit set **by `(contactId, reviewerId)`** — confirm each intended empty target now
  holds the intended ORCID. Direct-join overlap (`probe-orcid-contact-direct-join.js`
  rising 18→~176) is a **secondary** health metric only (it can move from GOapply imports
  or manual edits, and doesn't prove *which* contact we wrote).
- Backfill JSONL tallies: write / noop / conflict / malformed / ambiguous / nocontact /
  status_null.

## 10. Tests (Codex #22/#23 — gaps closed)
- `setOrcidIfAbsent`: all four §4 data-states + an operational-error throw (not swallowed).
- ORCID normalizer: valid / checksum-invalid(→malformed) / URL-form / `"1234567"`-style junk.
- Ambiguity-aware resolver: **two contacts sharing a normalized email → returns
  `ambiguous`, no contactId** (test the concrete resolver, not just the classification
  table — else it passes while runtime still uses `top:1`).
- Shared helper: eligible + already-linked (pointer set) → fills the linked contact;
  ineligible (`unresolved`/null status) → skip; no contact → skip.
- send-emails promotion hook + honorarium `ensureContact` path both invoke the helper.

## 11. Codex pre-impl disposition (all 24)
- **Accepted as-is:** #1, #2, #4, #5, #6, #7, #8, #9, #11, #12, #13, #14, #18, #22, #23, #24,
  and #19/#20 (probe-comment cleanups — done in this revision's companion commit).
- **Accepted, right-sized:** #3 (atomicity — conditional-PATCH if supported, else serialize
  + soften claim; not a blocker); #17 (real but bounded by §8.1 to post-promotion editable
  prefill — keep corroborated bar + test); #21 (durability via §7 native audit + response
  counters).
- **Concern accepted, fix changed:** #15 (provenance) — Codex proposed a contact source
  field; resolved instead via native Dataverse audit (§7), no schema. #16 likewise.
- **Confirmation only:** #10 (Candidates routes through send-emails — verified true).

## 12. Phasing
- **PR1 — ✅ SHIPPED S217** (`main` 2026-06-03): centralized ORCID normalizer +
  ambiguity-aware contact resolver + `contactAdapter.setOrcidIfAbsent` + shared
  `backPropReviewerOrcidToContact` helper + wire all three call sites (send-emails,
  honorarium, enrich-recommended) + person-select fields + actingUserSystemId
  threading + tests (§10). Codex-reviewed (pre-impl + confirmation + an adversarial
  pass — tightened 412 detection to `err.status===412`, kept the missing-etag
  unconditional fallback per `updateIfEmpty`).
- **PR2 — ✅ SHIPPED + RAN S217**: `scripts/backfill-contact-orcid.js`
  (resolve/summary/apply/verify, group-by-contact, status_null exception). Live
  counts matched the projection exactly — **162 write / 0 conflict / 0 malformed /
  7 ambiguous / 14 noop / 1 status_null / 1,349 nocontact** of 1,533; all 162 fills
  verified by (contactId, reviewerId), 0 failures.
- **PR3 (DEFERRED — blocked, not yet buildable)**: carry ORCID through the intake
  portal applicant-suggested reviewer capture so the flow closes at intake, not
  just at outreach.

  **Status (probed S217):** there is NOTHING to carry ORCID through yet. The
  intake portal (`pages/api/intake/{draft,submit}`, `pages/apply/`) has **no
  reviewer-capture** — `submit.js` ships only `budget_lines`; `persons` is parked
  (blocked on Connor), and reviewers aren't even on the parked list. Today's
  applicant-suggested reviewers come from the **legacy GOapply slots**
  (`akoya_request.wmkf_potentialreviewer1..5` → existing person GUIDs, ingested by
  `/api/workbench/applicant-reviewers`), where the applicant supplies no ORCID —
  and that path is **already covered by PR1** (those persons back-prop their ORCID
  when staff enrich them via `enrich-recommended` or invite them via `send-emails`).
  So PR3 has zero incremental value until the intake-portal **direct** reviewer-
  capture form exists, which is a Connor-gated intake scope item, not part of this
  ORCID work.

  **Wiring note for whoever builds the intake reviewer-capture (do it from day
  one):** when an applicant enters a suggested reviewer, capture the reviewer's
  ORCID if offered (an optional `orcid` field on the reviewer sub-form) and/or
  resolve it via `ORCIDService.findContact(name, affiliation)` at materialization.
  Write it onto the `wmkf_potentialreviewers` person through the **gated** path —
  i.e. only persist when the identity resolver reaches `confirmed`/`probable`
  (`researcher.writeIdentityDecision` + `mayPersistIdentity`), never a bare
  applicant-typed string (same persistence gate `enrich-recommended` uses). Once
  `wmkf_potentialreviewers.wmkf_orcid` + `wmkf_identitystatus` are set, the EXISTING
  back-prop carries it to the matched contact automatically — no new ORCID code is
  needed in the intake path, only the capture+gated-write of the person field. The
  applicant's OWN ORCID (the PI) is a separate concern already captured by GOapply
  onto `contact.wmkf_orcid` at intake (§1; the disjoint 423-row population) — do
  NOT conflate it with their suggested reviewers'.

## 13. Codex confirmation-pass disposition (rev2 → rev3)
Second pass (post-rev2): **3 RESOLVED, 3 PARTIALLY-RESOLVED, 0 new architectural issues**;
it also independently verified `DynamicsService.updateRecord` supports `If-Match`/ETag
(so §5 conditional PATCH is real, not a fallback) and that the operational-throw posture
is safe inside send-emails' catch. The three partials are folded into rev3:
- **HIGH — caller field-hydration**: the helper's three reviewer fields aren't loaded at
  any of the three call sites today. Added the explicit hydration contract in §5
  (send-emails select, `verify-suggestion-token` select for the honorarium path,
  retain-person in enrich-recommended). This is the gating PR1 work item.
- **MEDIUM — resolver API**: §3 now states the ambiguity-aware `resolveForBackprop` is a
  **new, separate** function; `findByEmail`/`findOrCreateByEmail` stay untouched so the
  promotion-create path keeps its record|null contract.
- **MEDIUM — staff visibility**: §1 now records the second visibility surface — Dynamics
  Explorer exposes `contact.wmkf_orcid` to staff — **accepted as intended** (standard CRM
  field), reinforcing the corroborated-`probable` bar rather than narrowing the claim.
- **RESOLVED, no change needed**: throw-compatible-with-send-emails, native-audit
  provenance sufficiency, conditional-PATCH availability.

## 14. Reviewer-self-reported ORCID capture (PR4 — the reviewer-side twin of PR3)
**Built S217.** At Stage 2a the reviewer confirms/corrects their **own** ORCID on
the authenticated magic-link form (`Stage2aView` ORCID field → `respond.js` →
`wmkf_reviewerorcid` on the engagement row). That self-confirmation is the
highest-trust ORCID source we have (the person attested it, having received the
token at their own email), yet pre-PR4 it never left the engagement row. PR4
captures it onto the **person** and the **contact** so it joins the flow.

- **Service** `lib/services/capture-self-reported-orcid.js`: normalize (§3
  checksum) → if valid, **person** (`researcher.updateById`) OVERWRITE
  `wmkf_orcid`+`wmkf_orcidurl` (human self-report beats a prior resolver guess) +
  mark identity **`confirmed`**; then **contact** `setOrcidIfAbsent` (fill-only,
  §4 conflict policy still applies — a genuine different-iD case is surfaced, not
  clobbered). Invalid iD / missing person → clean skip.
- **Trust model — `confirmed` is a sticky human-attestation sentinel.** The
  resolver may emit `confirmed` as a confidence decision, but the persistence
  adapter requires a server-only origin marker. Only `self_report` may persist
  `confirmed`; every automated writer identifies itself, is capped at
  `probable`, and must successfully read current status before writing. Both
  `writeIdentityDecision` and `clearIdentityFields` skip a stored `confirmed`
  and fail closed on read errors. This is transitional containment rather than
  durable provenance: legacy rows do not encode who attested them, and the
  read-then-write guard is not atomic.
- **Wiring** (`respond.js`): runs on a fresh **decline** (person + contact-if-
  promoted) AND on **accept** (after honorarium, using its just-created
  `contactId` ?? the invite-time pointer); independent of honorarium opt-out; all
  NON-FATAL (the response already committed). Idempotent on repeat accepts.
- **Interaction note:** on accept the honorarium back-prop runs first with the
  reviewer's *prior* (resolver) ORCID; PR4's contact write then fills/None-ops. If
  the self-report differs from a prior resolver iD already on the contact,
  `setOrcidIfAbsent` surfaces a conflict rather than clobbering — correct (two
  different valid iDs for one person is a real identity signal). The common case
  (reviewer had no iD → self-reports one → fills the empty contact) is clean.
- Tests: `capture-self-reported-orcid.test.js`,
  `researcher-identity-confirmed-sticky.test.js`.

**Codex adversarial review (S217) — dispositions:**
- **#1 (HIGH) FIXED — guard fail-open.** The sticky-`confirmed` guard's status read
  used `.catch(()=>null)` and then proceeded, so a transient read error could let a
  resolver verdict downgrade/clear an attestation. Now it FAILS CLOSED: the read
  must succeed; a read error propagates (callers handle identity writes per-row).
- **#3 (MED) FIXED — confirm-without-edit missed capture.** The Stage 2a client
  sends only CHANGED fields, so a reviewer who confirms a prefilled ORCID sends no
  `contactEdits.orcid`. Capture now sources `contactEdits.orcid || suggestion.
  wmkf_reviewerorcid` (`selfReportedOrcidOf`), so confirmed-from-prefill and the
  repeat-accept repair path are covered.
- **#2 (MED) FIXED — honorarium back-prop strands self-report.** On accept the
  honorarium back-prop runs first; now respond.js reflects a valid self-report onto
  the in-memory `reviewer` (`wmkf_orcid` + `wmkf_identitystatus='confirmed'`)
  BEFORE honorarium, so its contact back-prop carries the self-reported iD — no
  fill-then-conflict. The rare prior-session-different-corroborated-iD case still
  surfaces a §4 conflict (correct — a self-report differing from an
  institution-corroborated iD must not silently clobber; could be a typo).
- **#4 (LOW) ACCEPTED as-is.** Malformed `contactEdits.orcid` can still land on the
  RAW engagement field `wmkf_reviewerorcid` (it's the reviewer's verbatim record,
  64-char capped). The person/contact canonical stores are checksum-gated by the
  capture service, and an accept must not 400 over a typo'd optional field.
