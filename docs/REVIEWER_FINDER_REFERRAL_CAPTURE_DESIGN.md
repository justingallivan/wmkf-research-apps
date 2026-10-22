---
title: "Reviewer-Finder Referral Capture — Design (S249)"
domain: reviewer-identity
kind: spec
status: historical
summary: "S249 design history; candidate closure needs referred provenance and normalized exact name/email match to a selected or handled non-declined candidate."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/workbench/manual-reviewer.js
---

# Reviewer-Finder Referral Capture — Design (S249)

> **Historical design status:** APPROVED S249 (Justin); implementation is shipped.
> The D1–D5 record below preserves the approved design and review history. The
> current route contract is summarized here and verified in
> `lib/services/workbench/manual-reviewer-service.js`,
> `lib/utils/reviewer-provenance.js`, and the referral capture UI.
>
> **[VERIFIED via current source 2026-10-22] Current contract:** Manual Add/Refer accepts an optional referrer, persists
> `Referred by …` on line one of the durable match reason, and stores both
> `staff_manual` and `referred` source tokens so referral provenance survives a
> `my-candidates` reload. A referred name is a human referral signal, not proof
> of the referred person's identity. Find's `save-candidates` route keeps
> unresolved referral rows for review but withholds them before person/suggestion
> writes unless its exact identity/contact projection is ready. Manual Add/Refer
> is a distinct staff-entered path and intentionally permits a sparse selected
> person/suggestion; that path does not certify identity or outreach readiness.
> Candidate-based referral closure requires the `referred` source token and a
> selected or handled, non-declined candidate with a normalized exact name match
> and exact email match when the referral supplied one. Explicit row dismissal
> is a separate closure path. Neither closure path proves person identity.
>
> Decisions: **D1** match-reason text
> (no new Dataverse field) · **D2** grounded-rank bonus ≈ proposal_named · **D3**
> selectable-with-verify (exempt) like proposal_named · **D4** full build incl. UI ·
> **D5** Codex pass before commit. Endorsed feature (S244, Justin):
> "add suggested candidate" — capture reviewer-REFERRED candidates. Memory:
> `project-reviewer-referral-capture`. The decision list at §6 records the
> original approved choices, not open questions.

## 1. Why (validated)

J26 coverage tests showed referral chains are how panels actually fill perspective
gaps: for 1002379, Claude surfaced **Abby Doyle**; she was contacted, **declined**,
and **referred Tim Newhouse** — a synthesis reviewer no lane had surfaced. The tool's
job is a strong candidate pool + efficient human curation + **referral capture**, not
full automation. A referral from a respected reviewer is a STRONG signal worth
surfacing in ranking and UI.

## 2. S236 manual-add foundation and current referral path

The "hard part" the memory flags — free-text → canonical-person resolution with
abstain-or-confirm safety — is **already solved** by the S236 manual-add path:

- `pages/api/workbench/manual-reviewer.js` takes `{requestId, name, email?,
  affiliation?, orcid?, note?, resolution?}`, calls `lookupReviewerIdentity()`
  (`reviewer-lookup.js`), and:
  - `confident` + name-consistent → auto-resolves (reuse_reviewer / reuse_contact);
  - `none` → `create_new` (a sparse staff-asserted person);
  - `candidates` / `conflict` → **HTTP 409** with the lookup payload, so the staffer
    picks the right person (1-click) or the request is rejected. Never auto-binds a
    namesake.
- This is exactly the "resolve confidently OR present top matches for human
  confirmation; never auto-resolve to a namesake" posture the referral memory asks
  for — and it now rides the **hardened identity spine** (S249 work-grounding rescue).

The S249 implementation adds referral provenance and a referrer layer over this
manual-add foundation. The route still resolves, confirms, or abstains according
to the lookup result. A `none` result may intentionally create a sparse,
staff-entered person and selected suggestion; that manual workflow is distinct
from Find promotion's readiness gate.

## 3. What was missing at S249 approval

1. **No `referred` provenance at that time.** `reviewer-provenance.js` then had
   cited_reference / proposal_named / applicant_suggested / literature_retrieved /
   grounded_seed / barred_parametric — **no referred (and no staff_manual)**. A
   referred candidate at that snapshot had no source token that mapped to a
   positive kind, so `buildReviewerProvenance` would have fallen to
   `barred_parametric`.
2. **No `referredBy` field at that time** — who suggested the candidate was not captured.
3. **No "add suggested candidate" UI at that time** with a referrer field.

## 4. Approved design and implementation record

The subsections below preserve the approved S249 design. They are not a current
build checklist; current behavior is summarized in the status block above.

### 4a. Provenance: new `REFERRED` kind (`reviewer-provenance.js`)
- `PROVENANCE_KINDS.REFERRED = 'referred'`; `SEED_ROLES.REFERRED_BY = 'referred_by'`.
- `buildReviewerProvenance`: when `candidate.referredBy` (or `provenanceKind ===
  'referred'`) is set → kind `referred`, seedRole `referred_by`. Carry `referredBy`
  through `normalizeProvenance` as a passthrough string field.
- **Ranking** (D2): add `REFERRED` to `GROUNDED_RANKING_BONUS_KINDS` so a referral
  ranks like a grounded signal (≈ proposal_named). Approved in D2 and present in
  the current helper.
- **Selectability** (D3, historical S249 design): add `REFERRED` to
  `isIdentityReviewExemptProvenance` so an unresolved-but-staff-asserted referral
  is **selectable-with-verify** (routes to the
  `cited_or_proposal_named`-style exempt group). The approved S249 design described
  the then-existing save gate as force-nulling contact until identity was
  confirmed/probable. A referral is a strong human signal, not identity proof.
  **[VERIFIED via current source 2026-10-22]** Find now computes
  `projectReviewerContact` before writes; referral provenance does not establish
  independent address authority. The exact address/source pair must be coherent
  and contact persistence must be authorized, or the row is withheld before
  person/suggestion writes. Manual Add/Refer remains a separate sparse staff path.
- `provenanceLabelForCandidate`: `Referred (by {referredBy})`.

### 4b. Endpoint: extend `manual-reviewer.js` (reuse, don't rebuild)
- Accept an optional `referredBy` (cleanString, ≤180). When present:
  - set the candidate's `provenanceKind = 'referred'` + `referredBy`;
  - prepend `Referred by {referredBy}.` to `matchReason` (the **durable** home — see D1);
  - return `sources` containing `staff_manual` and `referred`, plus `referredBy`
    and `manualAdded: true` on the DTO.
- Everything else (lookup → resolution → 409-confirm → create person → ensure
  candidate row → fill-only contact/ORCID → applicant-exclusion gate) is unchanged.
- Security matrix: route already registered (`requireAppAccess('reviewer-finder',
  'reviewers')`); no new row, just a note that it now also captures referrals.

### 4c. referredBy storage (D1)
- **Recommended: encode in the match-reason text** (`Referred by {referredBy}.`) — no
  new Dataverse field, durable, human-legible in the why-chosen the staffer already
  reads. **S424 correction:** the clause owns **line 1** — the note follows after a
  newline, not a space. A period cannot terminate the name (titles and initials carry
  one), so the original space-joined form truncated "Dr. Abby Doyle" to "Dr" on reload.
  Encode/decode is now the canonical trio `formatReferredByReason` /
  `splitReferredByReason` / `parseReferredByReason` in `lib/utils/reviewer-provenance.js`
  [VERIFIED via `lib/utils/reviewer-provenance.js:361`, `:379`, `:390`]; every producer
  and the single consumer route through it. `splitReferredByReason` also yields the
  rationale remainder, which is how the card labels the referrer without repeating it in
  the "Why" prose. Pre-S424 rows keep the lossy legacy parse.
  [RECHECKED after lib/utils/reviewer-provenance.js change: lib/utils/reviewer-provenance.js:361, :379, :390 — the three function definitions re-derived from source after `splitReferredByReason` was added; complement grep over lib/pages/shared/scripts found no hand-rolled `Referred by` producer outside the helper.] Plus a structured `referredBy` on the in-session candidate DTO + provenance
  for ranking/label. Consistent with the project's conservative no-new-Dataverse-field
  posture.
- Alternative: a new `wmkf_referredby` field on `wmkf_appreviewersuggestion` (queryable
  "who refers the most", but a schema deploy + migration-manifest entry).

### 4d. UI (approved full-build scope, D4)
- An "Add suggested candidate" action on a contacted/declining reviewer's card in the
  Workbench invite/track flow → the existing manual-add modal + a **"Referred by"**
  field (prefillable with the declining reviewer's name). Reuses the 409-confirmation
  UX verbatim. Surface a "Referred by X" pill on the candidate card.

### 4e. Tests
- provenance: referred kind routing, label, ranking-bonus membership, exempt
  selectability.
- endpoint: referredBy tagging + matchReason encoding; unchanged resolution/409 paths.

## 5. Safety / non-regression
- Reuses the exact resolve-or-confirm flow → no new namesake risk; rides the hardened
  spine.
- Find keeps unresolved referrals visible for staff review and withholds promotion
  until its contact projection is ready. This preserves recall without granting
  contact authority (Codex-reviewed S235).
- Additive: no existing provenance kind or path changes behavior.

## 6. S249 decision record (closed)
- **D1 — referredBy storage:** Justin approved match-reason encoding with no new
  Dataverse field; a new `wmkf_referredby` field was the considered alternative.
  The S424 correction makes the referrer clause line one and keeps the note on
  the next line; the shared formatter/parser preserves names containing periods.
- **D2 — ranking strength:** Justin approved the grounded-ranking bonus; neutral
  ranking was the considered alternative. The current helper includes `referred`
  in that set.
- **D3 — selectability when unresolved:** Justin approved selectable-with-verify
  identity review; hard-blocking until resolved was the considered alternative.
  The S249 design's contact force-null description is historical; current Find
  promotion withholds before writes unless its independent identity and address
  authority checks pass. Manual Add/Refer remains a separate sparse staff-entry path.
- **D4 — scope:** the S249 note recommended a backend slice with UI follow-up,
  while full build was the alternative; Justin approved the full build including
  UI, which is shipped.
- **D5 — Codex pass:** the S249 note recommended adversarial Codex review before
  commit, with skipping as the alternative. The implementation received the
  requested review and the reload durability gap was fixed.
