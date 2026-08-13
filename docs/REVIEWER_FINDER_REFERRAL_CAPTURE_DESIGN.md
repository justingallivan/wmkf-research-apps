---
title: "Reviewer-Finder Referral Capture — Design (S249)"
domain: reviewer-identity
kind: spec
status: active
summary: "The \"hard part\" the memory flags — free-text → canonical-person resolution with abstain-or-confirm safety — is already solved by the S236..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/workbench/manual-reviewer.js
---

# Reviewer-Finder Referral Capture — Design (S249)

> **Status:** APPROVED S249 (Justin) — building. Decisions: **D1** match-reason text
> (no new Dataverse field) · **D2** grounded-rank bonus ≈ proposal_named · **D3**
> selectable-with-verify (exempt) like proposal_named · **D4** full build incl. UI ·
> **D5** Codex pass before commit. Endorsed feature (S244, Justin):
> "add suggested candidate" — capture reviewer-REFERRED candidates. Memory:
> `project-reviewer-referral-capture`. This doc is decision-oriented: §6 lists the
> open decisions that need a yes/no before build.

## 1. Why (validated)

J26 coverage tests showed referral chains are how panels actually fill perspective
gaps: for 1002379, Claude surfaced **Abby Doyle**; she was contacted, **declined**,
and **referred Tim Newhouse** — a synthesis reviewer no lane had surfaced. The tool's
job is a strong candidate pool + efficient human curation + **referral capture**, not
full automation. A referral from a respected reviewer is a STRONG signal worth
surfacing in ranking and UI.

## 2. The key finding — the hard part is already built

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

**So referral capture is NOT a new resolution engine. It is a thin provenance +
referrer layer over the existing manual-add path.**

## 3. What's actually missing

1. **No `referred` provenance.** `reviewer-provenance.js` `PROVENANCE_KINDS` has
   cited_reference / proposal_named / applicant_suggested / literature_retrieved /
   grounded_seed / barred_parametric — **no referred (and no staff_manual)**. A
   referred candidate currently has no source token that maps to a positive kind, so
   `buildReviewerProvenance` would fall to `barred_parametric`.
2. **No `referredBy`** anywhere — who suggested the candidate is not captured.
3. **No "add suggested candidate" UI** with a referrer field.

## 4. Proposed design

### 4a. Provenance: new `REFERRED` kind (`reviewer-provenance.js`)
- `PROVENANCE_KINDS.REFERRED = 'referred'`; `SEED_ROLES.REFERRED_BY = 'referred_by'`.
- `buildReviewerProvenance`: when `candidate.referredBy` (or `provenanceKind ===
  'referred'`) is set → kind `referred`, seedRole `referred_by`. Carry `referredBy`
  through `normalizeProvenance` as a passthrough string field.
- **Ranking** (D2): add `REFERRED` to `GROUNDED_RANKING_BONUS_KINDS` so a referral
  ranks like a grounded signal (≈ proposal_named). *Recommended per the memory.*
- **Selectability** (D3): add `REFERRED` to `isIdentityReviewExemptProvenance` so an
  unresolved-but-staff-asserted referral is **selectable-with-verify** (routes to the
  `cited_or_proposal_named`-style exempt group), with the existing
  `contactBlockedForUnresolvedExempt` save-gate force-nulling contact until identity
  is confirmed/probable. *Recommended — mirrors proposal_named exactly and reuses the
  existing gate; a referral is a strong human signal, not a system-discovered row.*
- `provenanceLabelForCandidate`: `Referred (by {referredBy})`.

### 4b. Endpoint: extend `manual-reviewer.js` (reuse, don't rebuild)
- Accept an optional `referredBy` (cleanString, ≤180). When present:
  - set the candidate's `provenanceKind = 'referred'` + `referredBy`;
  - prepend `Referred by {referredBy}.` to `matchReason` (the **durable** home — see D1);
  - return `sources: ['referred']`, `referredBy`, `manualAdded: true` on the DTO.
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
  the "Why" prose. Pre-S424 rows keep the lossy legacy parse. Plus a structured `referredBy` on the in-session candidate DTO + provenance
  for ranking/label. Consistent with the project's conservative no-new-Dataverse-field
  posture.
- Alternative: a new `wmkf_referredby` field on `wmkf_appreviewersuggestion` (queryable
  "who refers the most", but a schema deploy + migration-manifest entry).

### 4d. UI (largest piece — candidate for a follow-up slice, D4)
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
- Exempt-selectability + contact force-null is the SAME machinery proposal_named uses
  (Codex-reviewed S235) — no new save-gate logic.
- Additive: no existing provenance kind or path changes behavior.

## 6. Open decisions (need yes/no before build)
- **D1 — referredBy storage:** match-reason-encoded, no schema *(recommended)* | new
  Dataverse field `wmkf_referredby`.
- **D2 — ranking strength:** grounded-bonus ≈ proposal_named *(recommended)* | neutral
  (no rank bump).
- **D3 — selectability when unresolved:** exempt / selectable-with-verify like
  proposal_named *(recommended)* | hard-block until resolved (like literature_retrieved).
- **D4 — this-session scope:** backend slice now (4a–4c + 4e), UI (4d) as a follow-up
  *(recommended given session length)* | full incl. UI.
- **D5 — Codex pass:** adversarial review before commit (norm for gate-touching
  reviewer work) *(recommended)* | skip given the small, reuse-heavy surface.
