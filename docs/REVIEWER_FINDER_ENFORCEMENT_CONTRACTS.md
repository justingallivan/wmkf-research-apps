# Reviewer Finder — Live Enforcement Contracts

**Status:** MAINTAINED current-state reference (owns the live behavioral guarantees below).
**Owner:** reviewer-finder.
**Created:** 2026-06-13 (S253).
**Last verified:** 2026-06-13 (S253) — all 8 contracts traced to live source; see `[VERIFIED]` tags per section.

> **What this doc is.** The single maintained home for the Reviewer Finder feature's
> *live* fail-closed enforcement contracts — the hard blocks, force-nulls, and
> asymmetric gates that protect against the wrong-person-invite failure
> (`project-reviewer-verify-fail-dangerous`). Each contract names its enforcement
> point in source (file:line) and the audit/test that proves it.
>
> **What this doc is NOT.** Not a feature overview (see `docs/REVIEWER_FINDER.md`),
> not a design snapshot. The `*_PLAN`/`*_DESIGN`/`*_SPEC` docs hold *rationale and
> history*; this doc holds *what the code enforces today*. When code and this doc
> disagree, **source wins** and this doc must be corrected in the same change.
>
> **How to keep it current.** When you change any enforcement point below, update the
> contract here in the same commit and bump **Last verified**. The agent-wiki topic
> pages (`docs/agent-wiki/topics/reviewer-identity.md` and siblings) route here as
> their canonical owner — keep their `canonical_docs:` pointer intact.

Authoritative source files: `pages/api/reviewer-finder/save-candidates.js`,
`pages/api/review-manager/send-emails.js`, `lib/utils/reviewer-invite.js`,
`lib/utils/reviewer-provenance.js`, `lib/services/proposal-pi-identity.js`,
`lib/services/reviewer-identity-evidence.js`, `lib/services/contact-enrichment-service.js`.

---

## 1. Slice-E identity-unresolved gate — client/server asymmetry `[VERIFIED 2026-06-13]`

**Contract.** An identity-unresolved candidate is gated at TWO boundaries, and the two
are **intentionally asymmetric**: the client FIND select list is *stricter* than the
server save gate.

- **Client (FIND select list).** Both the Workbench and the standalone
  `reviewer-finder.js` gate selectability on `provenanceGroupOf(c) !== 'needs_identity_review'`
  — the `needs_identity_review` group renders read-only and is excluded from
  select-all/save. `provenanceGroupOf` (`lib/utils/reviewer-provenance.js:~221`) routes a row
  to `needs_identity_review` when `needsIdentification===true || identityStatus==='unresolved'
  || verificationStatus==='unresolved'`, OR when the provenance kind is barred/unknown AND the
  row has NO positive identity. A positively-resolved row (confirmed/probable/verified) is
  ALWAYS selectable even with a barred kind.
- **Server (`save-candidates.js:56-67`, `isUnresolvedIdentity`).** HARD-REJECTS only the
  EXPLICIT-unresolved triple (`needsIdentification`/`identityStatus`/`verificationStatus`),
  per-row. It deliberately does NOT gate on the full `provenanceGroupOf` — a barred/unknown-kind
  row with no top-level identity is legitimately saved here from other paths (a contact-enriched
  person with a resolver verdict but no top-level `identityStatus`) under field-level gating.
  Gating the server on `provenanceGroupOf` would wrongly reject those.

**Enforcement points.** `lib/utils/reviewer-provenance.js` (`provenanceGroupOf`) ·
`pages/api/reviewer-finder/save-candidates.js:56-67` (`isUnresolvedIdentity`) ·
`save-candidates.js:130-138` (per-row skip) · `save-candidates.js:305-316` (batch 422).

**Why.** The clients hide ungrounded rows, but the standalone Reviewer Finder and any
bypassed/direct caller can still POST them, so the field-level gate alone is insufficient —
the server rejects the whole row (writes neither person nor suggestion). When the whole batch
is rejected the route returns **422** with `rejectedUnresolved`; a mixed batch returns 200 and
saves the resolved rows. The gate must survive a Find-roster reload — `pruneCandidateForRoster`
persists `identityStatus`/`needsIdentification`/`verificationStatus`, else a deferred candidate
re-surfaces as selectable.

**Audit.** `tests/unit/reviewer-route-identity-gate.test.js`.

---

## 2. PI-named / cited exemption + contact force-null `[VERIFIED 2026-06-13]`

**Contract.** A candidate whose provenance kind is `cited_reference` or `proposal_named` (the
proposal author named/cited THIS specific person) is NOT hard-blocked when unresolved — it is
selectable for identity review. BUT until its identity is confirmed/probable, the save boundary
**force-nulls ALL contact + identity-derived fields** (email, website, faculty-page, affiliation,
ORCID, Scholar, bibliometrics, department, expertise). A selectable-but-unverified row therefore
cannot carry a wrong-person email — it could be a namesake of the named person.

**Enforcement points.** `pages/api/reviewer-finder/save-candidates.js:79-82`
(`contactBlockedForUnresolvedExempt`) gates the force-null applied at `save-candidates.js:172-191`
and `:235` (ORCID/Scholar/metrics also nulled via `blockByIdentity`). The exemption itself is
`isIdentityReviewExemptProvenance(...)` checked BEFORE the unresolved gate in `isUnresolvedIdentity`
(`:63`). System-discovered (`literature_retrieved`, incl. Slice-E deferred Track-B) stays
hard-blocked. The card shows an amber "⚠ Verify identity — no contact saved until confirmed" pill.

**Why.** Anchor-or-abstain at the persistence boundary, turned from assumption into enforced
invariant (Codex HIGH, S235).

---

## 3. Slice-G invite-confidence recipient allowlist `[VERIFIED 2026-06-13]`

**Contract.** On a first-contact **invitation**, `send-emails.js` independently computes
`emailConfidence(person)` per recipient and REFUSES a LOW-confidence recipient UNLESS that
recipient's `suggestionId` is in the request's `confirmedLowConfidenceIds` allowlist. The
acknowledgement is **recipient-specific, not a batch boolean** — a row that became LOW after
preview cannot ride on another row's confirmation.

- **HIGH** = email source `orcid`/`pubmed`/`institution_page`, or `serp_search`/`claude_search`
  on a `confirmed`/`probable` identity.
- **LOW** = `manual`, `affiliation`, unknown/null source, or a search email on an unconfirmed
  identity.
- **Scope.** Gated to `templateType==='invitation'` only. Post-acceptance materials / followup /
  thankyou are NOT gated.

**Enforcement points.** `lib/utils/reviewer-invite.js:70-88` (`emailConfidence`) ·
`pages/api/review-manager/send-emails.js:120-124` (allowlist captured as a Set) ·
`send-emails.js:292-294` (per-recipient check, skip reason `email_unconfirmed`). `render-emails.js`
stamps `emailConfidence` per draft (the modal DTO is too thin to compute it); `InviteEmailModal`
shows the warning + one-click "confirm & send". Manual email edits (`my-candidates.js`) stamp
`emailSource='manual'` so staff-typed addresses read LOW.

**Why.** The API is the enforced boundary — the modal acknowledgement alone is not trusted.

---

## 4. Structured-PI identity — fail-open + augment-only `[VERIFIED 2026-06-13]`

**Contract.** `discover.js` and `enrich-recommended.js` resolve the proposal PI from STRUCTURED
Dataverse data (`resolveProposalPI`: request `_wmkf_projectleader_value` → contact `wmkf_orcid`
→ exact OpenAlex author via `OpenAlexService.getAuthorByOrcid`) instead of trusting the
LLM-extracted PI name. It is **server-resolved from the request GUID** (clients send `requestId`,
never a client-claimed identity), runs in a Dynamics bypass under the time budget, and is
**FAIL-OPEN + AUGMENT-ONLY**:

- Never throws for "couldn't resolve" — returns `{ resolved: false, reason }` so the caller falls
  open to the existing proposal-text identity. Only abort/time-budget signals propagate.
- Appends the canonical PI name to the author-exclusion/coauthor set (never replaces the LLM PI +
  co-Is) and identity-excludes candidates sharing the PI's exact ORCID/OpenAlex id — **gated on
  `confirmed`/`probable`** (unresolved rows keep their id fields; acting on them would risk a
  namesake).
- A mis-entered ORCID is caught by a forename/surname name guard (`forenamesContradict`) → abstain.

**Enforcement points.** `lib/services/proposal-pi-identity.js:125+` (`resolveProposalPI`) ·
`lib/services/reviewer-identity-evidence.js:316-321` (`forenamesContradict` — full-forename
contradiction only; returns false if either name is initial-only).

---

## 5. S240 current-institution COI — hard drop + durable gate `[VERIFIED 2026-06-13]`

**Contract.** Current same-institution affiliation (reviewer at a proposal-PI institution) is a
foundation POLICY conflict, **hard-dropped on BOTH discovery tracks** and **hard-rejected again at
the durable save boundary**. Matched against the UNION of `piInstitutions(pi, authorInstitution)`
(ORCID-current + OpenAlex last-known + LLM).

- **Discovery.** Track A via `filterConflicts` in `discover.js`; Track B via `filterConflicts`
  inside `DiscoveryService.discover()`.
- **Save (authoritative).** `save-candidates.js:150-160` HARD-REJECTS a row with
  `hasInstitutionCOI` OR a post-enrichment `contactEnrichment.coiRecomputed && hasInstitutionCOI`,
  incrementing `rejectedInstitutionCOI` (`:116`). Enrichment runs AFTER the discovery drop and can
  promote a current affiliation matching a PI institution, so the durable boundary re-checks —
  independent of whether the client promoted the flag. 422 if the whole batch is COI/unresolved
  (`:305-316`).
- **Retired.** Historical / former-shared institution COI is RETIRED — `markInstitutionCOI` is
  current-affiliation only; `institutionCOIDetails.historical` is gone. `affiliationHistory` is
  still produced but COI-inert (deferred dead-code). The SOFT flag survives only on the
  applicant-recommended (`enrich-recommended.js`, flag-not-drop) and post-enrichment
  (`enrich-contacts.js`) paths.

**Enforcement points.** `save-candidates.js:116, 150-160, 305-316` · `discover.js`
(`filterConflicts`) · `DiscoveryService.discover()` (`filterConflicts`).

> **This contract previously had no documentary home outside the agent wiki** — the
> `rejectedInstitutionCOI` durable gate appeared in zero non-wiki docs before this reference
> (S253). The AI `POTENTIAL_CONCERNS` advisory retirement is **Chunk 2b (NOT yet built)** —
> see `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`. Policy memory:
> `project-reviewer-coi-rely-on-self-disclosure`.

---

## 6. OpenAlex bibliometrics + verified-domain source `[VERIFIED 2026-06-13]`

**Contract.** Bibliometrics (h-index/i10/citations), the current-affiliation candidate, and the
verified-email domain all source from **OpenAlex, NOT SerpAPI Scholar** (Slice 1b, S251 free-stack
migration). `ContactEnrichmentService._attachOpenAlexMetrics` (was `_attachScholarMetrics`) uses
the ORCID path (`getAuthorByOrcid`) or the discovery-resolved author id carried on the candidate
(`getAuthorById` on `candidate.openAlexId`/`openAlexAuthorId` + identity status) — **never a bare
name search**; no anchor → ABSTAIN (no metrics). FREE, so it runs regardless of the paid SerpAPI
toggle. It writes the `tierResults.openalex_author` DTO that the resolver re-proves (allowlist gate
`isOpenAlexAuthorAccepted`).

- **Field renames (same slice):** `scholarVerifiedEmail`→`verifiedInstitutionDomain`,
  `scholarAffiliations`→`openAlexAffiliation`, `affiliationSource:'scholar_current'`→
  `'openalex_current'`, `tierResults.scholar_profile`→`tierResults.openalex_author`.
- **Google Scholar:** exact deep-links (`user=ID`) are DROPPED — `googleScholarId=null`; only a
  free Scholar **search** link (`buildGoogleScholarUrl(name, affiliation)`) remains. Any doc that
  says "Google Scholar profile links" is drifted.

**Enforcement points.** `lib/services/contact-enrichment-service.js:676-790`
(`_attachOpenAlexMetrics`). Deeper rationale + call-site inventory:
`docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` (design owner, status COMPLETE).

---

## 7. Faculty-page email recovery — zero-SSRF boundary `[VERIFIED 2026-06-13]`

**Contract.** Faculty-page email recovery (Slice F, S235) is the **ZERO-SSRF path — there is NO
server-side fetch of an external faculty page.** `my-candidates` GET returns `facultyPageUrl`
(selects `wmkf_facultypageurl`); `CandidatesPanel` shows a "find on faculty page →" link on
no-email candidates; staff read the address there and enter it via `CandidateEditModal` → manual
stamp (`emailSource='manual'`, reads LOW per Contract 3) → Slice-G confirm.

The automated server-side fetch was Codex-reviewed (READY WITH NAMED CHANGES — undici IP-pinning
dispatcher, `verifiedInstitutionDomain`-only allowlist, IPv6 private-IP blocklist) but
**deliberately NOT built**. Do NOT add a server-side external-page fetch without that mechanism.

**Related verified-domain guard.** Where a verified domain IS known (from OpenAlex institution
lookup), `_validateEmailAgainstVerifiedDomain` (`contact-enrichment-service.js:214-244`, sourced at
`:761`) drops a SEARCH-sourced email to null when its domain contradicts `verifiedInstitutionDomain`
— preventing namesake-collapse. ORCID/PubMed/affiliation emails outrank the heuristic.

**Enforcement points.** `lib/services/contact-enrichment-service.js:214-244, 761` · design owner
for the un-built auto-fetch SSRF mechanism: `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D.

---

## 8. Work-grounding rescue — namesake safety contract `[VERIFIED 2026-06-13]`

**Contract.** `rescueByWorkGrounding` resolves a name the normal path already abstained on, and is
**purely additive** — it can only promote an abstained name, never alter an existing verdict. It
fires ONLY on `no_openalex_affiliation_or_topic_match`. For the top-3 **forename-fully-agreeing**
candidate authors it fetches recent work titles (`OpenAlexService.getWorksByAuthor`) and re-tests
field overlap against the actual titles, with the author's own **ORCID works list**
(`ORCIDService.getWorks`, merge-immune) as a second corroborator: an informative (≥5-title)
off-topic ORCID corpus VETOES the match (likely cluster contamination); a sparse list is
uninformative.

**Safety invariants.**
- Strict forename gate → cannot bind a wrong-forename namesake.
- Promotes via an `authorship_grounded` (strong) anchor with a **`probable` ceiling**
  (selectable-with-verify, not auto-trusted).
- Requires EXACTLY ONE work-grounded candidate (else abstain).
- On abort during probing, never promotes on partial evidence (returns null — keep safe abstain).

**Enforcement points.** `lib/services/reviewer-identity-evidence.js:212-271` (`rescueByWorkGrounding`,
exported `:568`). **Audit:** `tests/unit/reviewer-identity-evidence.test.js`
(`describe('work-grounding rescue')`). Safety posture memory:
`project-reviewer-verify-fail-dangerous`, `project-openalex-merge-use-orcid-works`.

---

## Contract → enforcement-point index

| # | Contract | Primary enforcement point |
|---|----------|---------------------------|
| 1 | Slice-E client/server asymmetry | `save-candidates.js:56-67,305-316` + `reviewer-provenance.js` (`provenanceGroupOf`) |
| 2 | PI-named/cited exemption + force-null | `save-candidates.js:79-82,172-191` |
| 3 | Invite-confidence allowlist | `reviewer-invite.js:70-88` + `send-emails.js:292-294` |
| 4 | Structured-PI fail-open/augment-only | `proposal-pi-identity.js:125+` + `reviewer-identity-evidence.js:316-321` |
| 5 | S240 institution COI hard drop | `save-candidates.js:116,150-160` + `discover.js`/`DiscoveryService` `filterConflicts` |
| 6 | OpenAlex bibliometrics/verified-domain | `contact-enrichment-service.js:676-790` |
| 7 | Faculty-page zero-SSRF boundary | `contact-enrichment-service.js:214-244,761` |
| 8 | Work-grounding rescue | `reviewer-identity-evidence.js:212-271` |
