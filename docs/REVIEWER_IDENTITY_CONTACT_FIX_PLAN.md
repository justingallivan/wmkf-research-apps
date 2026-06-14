# Reviewer Identity / Contact-Enrichment Fix Plan

Date: 2026-06-08
Status: **SHIPPED** (updated S253, 2026-06-13) — was PROPOSED for Codex review. The core fix —
contact/bibliometric enrichment now consumes the resolved identity's anchors and drops a
search-sourced email whose domain contradicts the OpenAlex-verified institution domain — is live
in `lib/services/contact-enrichment-service.js` (`_attachOpenAlexMetrics`,
`_validateEmailAgainstVerifiedDomain`, `emailPersistAllowed`/`scholarPersistAllowed` gates). The
live boundary is owned by `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` §6–§7. Read the fixes
below as the original problem analysis (historical), and re-verify any specific sub-fix against
source before treating it as open.
Author: Claude (Opus 4.8), grounded in live trace of request 1002794 + independent code verification.

Related artifacts (all in `docs/`):
- `REVIEWER_IDENTITY_STRATEGY_EVALUATION.md` — Codex strategy review.
- `REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md` — Codex trace of the two inferred claims (independently re-verified by Claude).
- `REVIEWER_IDENTITY_RECONCILIATION_EDITS.md` — proposed doc reconciliation (separate workstream, NOT in scope here).

---

## 1. Problem statement (VERIFIED, not assumed)

Two reviewers on request 1002794 (attosecond physics) surfaced with wrong contact/bibliometric data:

- **Olga Smirnova** — ORCID `0000-0002-7746-5733` correctly resolves her to Max-Born-Institute, but the displayed/savable email is `olga.smirnova@metalab.ifmo.ru` (an ITMO/St-Petersburg namesake) and website is her ITMO namesake page.
- **Yanjun Chen** — identity is **correctly work-grounded** (`identityNote` = "Identity confirmed (no public ORCID)…"; grounded on 8 real attoclock papers; per `reviewer-identity-resolver.js:165`, `confirmed` without ORCID *requires* an `authorship_grounded` anchor). But the email `nickchenyj@gmail.com` and website `cliburn.org/.../2025-competitors/yanjun-chen` belong to a **Van Cliburn piano competitor**, and h-index 5 is a different academic's.

**Root cause (re-framed after verification):** identity *resolution* is working. The defect is that **contact + bibliometric enrichment does not consume the resolved identity's anchors** — it runs bare-name web/Scholar searches and attaches whatever it finds. When discovery-time `candidate.affiliation` is empty (true for arXiv-discovered authors), the query has no institution qualifier → namesake collapse. The wrong fields then **persist on save**.

Verified mechanics (file:line confirmed against HEAD `77799eb`):
- `serp-contact-service.js:33-43` / `:452-455` — both the Google contact query and the Scholar query are built from `candidate.affiliation`; empty → bare-name `"Name" email`.
- `contact-enrichment-service.js:68-75` — the identity anchor's institution is `candidate.affiliation` (empty for these cases); ORCID's real affiliation is collected into `contactEnrichment.orcidAffiliation` only **after** Tier 2 and is never threaded into Tier 3/4.
- `contact-enrichment-service.js:115-128` — `_institutionsContradict` short-circuits to `false` when the anchor institution is empty → the contradiction guard is toothless exactly when it's needed.
- `save-candidates.js:122-156, :168` — `blockByIdentity` only fires when a resolver verdict exists and fails `mayPersistIdentity`; it nulls **only** ORCID/Scholar/bibliometrics. **email/website/affiliation are written unconditionally.** Deferred candidates (no verdict) aren't gated at all.
- `discovery-service.js:274-291` — deferred Track-B candidates (beyond `TRACK_B_IDENTITY_RESOLUTION_LIMIT`) merge into `results.discovered` with no `identityStatus`/`needsIdentification`, so the UI grouper treats them as ordinary selectable `literature_retrieved`.
- `reviewer-identity-evidence.js:249-258` — `buildIdentityNote` lists `topic_match` as a corroborator but never lists `authorship_grounded`, so a work-grounded confirm reads as "corroborated by research-topic overlap."

**Governing principle (already adopted in this codebase):** *unresolved is acceptable; wrong-and-confident is not.* Extended here: **a confirmed identity does NOT license unvalidated contact details.** Identity-confirmed ≠ contact-validated.

**Binding constraint:** latency. A program director won't use the tool if enrichment is slower than Googling the names themselves. SerpAPI call budget (~15k/mo) is NOT the constraint; sequential wall-clock is. The preferred fixes therefore **reuse anchors already fetched** and **abstain**, rather than adding round-trips.

---

## 2. Design principles for the fix

1. **Anchor contact to the resolved identity, don't re-derive it.** When a candidate is work-grounded (Track-B resolver gives an OpenAlex author id) or ORCID-anchored, use *that* author's institution to scope and validate contact/Scholar lookups.
2. **Abstain over guess.** If no institution anchor is available (no ORCID affiliation, no OpenAlex author institution), do **not** run a bare-name contact/Scholar search and accept the result. Emit no email/website/bibliometrics; mark contact `unresolved`.
3. **A wrong-namesake result must be rejectable by institution OR email-domain contradiction**, using the *effective* (anchor-or-ORCID-resolved) institution, not the empty discovery affiliation.
4. **Persistence is the last line of defense.** Never write a contact/bibliometric field that wasn't identity-validated, regardless of `identityStatus`.
5. **No added sequential round-trips on the hot path** without an offsetting removal; prefer reusing data already in hand.

---

## 3. The fixes

### Fix A — Thread the ORCID-resolved affiliation into Tier 3/4 (Smirnova class)
**Files:** `contact-enrichment-service.js`, `serp-contact-service.js`
- After Tier 2 resolves ORCID, compute `effectiveInstitution = contactEnrichment.orcidAffiliation || candidate.affiliation`.
- Pass `effectiveInstitution` into the Tier-3 (`claudeWebSearch`) and Tier-4 (`SerpContactService.findContact`) calls — via a **search-only candidate clone** (`{ ...candidate, affiliation: effectiveInstitution }`), NOT by mutating `candidate` (preserves the S224 invariant that `resolveIdentity` runs on the original discovery affiliation).
- Use `effectiveInstitution` as `anchor.institution` in `_resultContradictsAnchor` for Tier 3/4 so an ITMO result contradicts the Max-Born anchor and is rejected.
- **Expected result on 1002794:** Smirnova's contact search becomes `"Olga Smirnova" Max-Born-Institute …`; the ITMO email/website are either not found or rejected by the contradiction guard.

### Fix B — Anchor contact/bibliometrics to the work-grounded author, else abstain (Chen class)
**Files:** `contact-enrichment-service.js`, handoff from `reviewer-work-author-resolver.js` / `discovery-service.js`
- Ensure the Track-B resolver's `openAlexAuthorId` + that author's institution (via `OpenAlexService` author record `lastKnownInstitution`) are carried onto the candidate and available to enrichment as an anchor (reuse — no new search if already fetched during resolution).
- In enrichment: if an institution anchor exists (from ORCID or the work-grounded author), scope the contact/Scholar search to it (same mechanism as Fix A).
- If **no** institution anchor exists for a candidate (no ORCID affiliation, no OpenAlex author institution), **abstain**: do not run the bare-name `findContact`/Scholar searches as authoritative; emit no email/website/bibliometrics; set a `contactStatus: 'unresolved'` (or equivalent) so the UI can show "contact not verified."
- **Expected result on 1002794:** Chen keeps his (correct) work-grounded identity and relevance, but shows no email/website/h-index — flagged "contact unresolved" — instead of the pianist's.

### Fix C — Persistence must not write unvalidated contact/bibliometric fields
**File:** `pages/api/reviewer-finder/save-candidates.js`
- Extend the gate so email/website/affiliation are also withheld (or written only when they came from an identity-anchored source — PubMed-of-the-right-person, ORCID, or anchor-scoped/validated search).
- Decouple from `identityStatus`: `confirmed` identity must NOT auto-permit contact/bibliometric persistence. Gate on a **contact/field-level provenance/validation flag**, not on the person-level identity verdict. (Chen is `confirmed` yet his contact is wrong — the current logic would persist it.)
- A deferred/unanchored candidate that is somehow submitted must be rejected or saved with contact fields nulled.

### Fix D — `buildIdentityNote` should surface authorship grounding
**File:** `reviewer-identity-evidence.js`
- Add `authorship_grounded` to the corroboration list in `buildIdentityNote` (e.g. "work authorship match") so a work-grounded confirm doesn't read as "corroborated by research-topic overlap" alone. Cosmetic-but-trust-relevant; pairs with the `reviewer-verify-fail-dangerous` concern.

### Fix E — Deferred/unanchored Track-B candidates must not be silently selectable
**Files:** `discovery-service.js` (and/or the UI grouper consumer)
- Give deferred candidates an explicit unresolved identity status (`identityStatus: 'unresolved'` / `needsIdentification: true`) so `provenanceGroupOf` routes them to `needs_identity_review`, **and** ensure `needs_identity_review` is rendered non-selectable (today `ReviewerSearchSection.js:1022` renders every section, including `needs_identity_review`, as a toggleable `CandidateCard`). Decide: relabel deferred as needs-review, and/or make that section read-only like the `unverified` section (`:1059-1067`).
- Alternatively/additionally: log the deferred count to the user so silent truncation isn't mistaken for "fully resolved."

---

## 4. Sequencing (highest-harm-first, latency-aware)

1. **Fix C** (persistence) + **Fix A** (Smirnova search/guard) — smallest, highest harm-reduction: stops wrong contact reaching Dataverse and fixes the ORCID-anchored class. Shippable together.
2. **Fix B** (Chen: anchor-or-abstain on contact) — the substantive correctness fix; depends on carrying the work-grounded author anchor into enrichment.
3. **Fix E** (deferred selectability) — independent; can land in parallel.
4. **Fix D** (note wording) — trivial; bundle with B.

---

## 5. Test / verification plan

- **Unit:** add cases to the contact-enrichment + serp-contact tests: (a) empty discovery affiliation + ORCID affiliation present → search uses ORCID institution; (b) result institution/email-domain contradicting the anchor → rejected; (c) no institution anchor → abstain (no email/website/bibliometrics emitted); (d) save path withholds contact fields when unvalidated even for `identityStatus='confirmed'`.
- **Resolver:** assert `buildIdentityNote` includes an authorship phrase for `authorship_grounded`.
- **Live trace (Claude runs; Codex cannot run build/jest):** re-run `scripts/trace-reviewer-provenance.mjs --request 1002794` and a fresh in-app discover with PubMed off; confirm Smirnova → correct/empty contact (no ITMO), Chen → identity kept, contact unresolved (no pianist), deferred candidates → not selectable.
- **Gates:** `npm run build` + `npx jest` (reviewer/contact/identity/discovery/openalex suites) + the affected red-gate set. Codex CANNOT run build/jest (Turbopack/EPERM in its sandbox) — Claude runs these.

---

## 6. Explicitly OUT of scope (so we don't over-build)

- Scholar-first reordering and topic-keyword query expansion — Codex's review judged these as relocating the failure / fragile; deferred unless the abstain-based fixes prove insufficient.
- Per-candidate multi-profile web fan-out — rejected on latency grounds.
- Doc reconciliation of `REVIEWER_TRACK_B_IDENTITY_SPEC.md` / `REVIEWER_IDENTITY_RESOLUTION_PLAN.md` — tracked separately in `REVIEWER_IDENTITY_RECONCILIATION_EDITS.md`, handle via `/sweep`.

---

## 7. Questions for Codex (this review)

1. Is the **identity-validated ≠ contact-validated** decoupling in Fix C the right gate model, or is there a cleaner existing provenance signal on contact fields to gate on?
2. For Fix B, is the work-grounded **OpenAlex author institution** reliably available post-resolution without an extra fetch, or does abstain become the common path (and is that acceptable)?
3. Does Fix A's **search-only candidate clone** fully preserve the S224 `resolveIdentity`-on-original-affiliation invariant, or are there other readers of `candidate.affiliation` mid-pipeline that would be affected?
4. Is **email-domain-vs-institution** contradiction worth adding to `_resultContradictsAnchor`, or does institution-scoped search make it redundant?
5. Any ordering/atomicity hazard in Fix C if a row is partially written (potential reviewer created, suggestion write fails)?
6. Anything in the deferred-candidate path (Fix E) that makes relabel-as-needs-review unsafe (e.g. a downstream consumer that assumes everything in `discovered` is resolved)?
