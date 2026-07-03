---
title: "Reviewer Finder — Live Enforcement Contracts"
domain: reviewer-identity
kind: source-of-truth
status: canonical
summary: "Status: MAINTAINED current-state reference (owns the live behavioral guarantees below)."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/review-manager/send-emails.js
---

# Reviewer Finder — Live Enforcement Contracts

**Status:** MAINTAINED current-state reference (owns the live behavioral guarantees below).
**Owner:** reviewer-finder.
**Created:** 2026-06-13 (S253).
**Last verified:** 2026-07-03 (S321 + Contract 5 follow-up) — contracts 3, 5, and 7 re-verified against the S321 gating-redesign implementation and institution-COI precision follow-up; others last traced 2026-06-13 (S253). See `[VERIFIED]` tags per section.

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

## 2. PI-named / cited / referred exemption + contact force-null `[VERIFIED 2026-06-13]`

**Contract.** A candidate whose provenance kind is `cited_reference`, `proposal_named`, or
`referred` (the proposal author named/cited THIS specific person, or a contacted reviewer referred
them — a human-grounded signal, S249) is NOT hard-blocked when unresolved — it is
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
- **LOW** = `manual`, `affiliation`, `search_contested` (a search email the domain guard
  contested — S321 gating redesign), unknown/null source, or a search email on an unconfirmed
  identity. `search_contested` stays LOW even on a `confirmed` identity.
- **Scope.** Gated to `templateType==='invitation'` only. Post-acceptance materials / followup /
  thankyou are NOT gated.

**Enforcement points.** `lib/utils/reviewer-invite.js:70-88` (`emailConfidence`) ·
`pages/api/review-manager/send-emails.js:120-124` (allowlist captured as a Set) ·
`send-emails.js:292-294` (per-recipient check, skip reason `email_unconfirmed`). `render-emails.js`
stamps `emailConfidence` per draft (the modal DTO is too thin to compute it); `InviteEmailModal`
requires a **per-recipient checkbox** for each LOW address (name + address + reason; send button
disabled until every one is ticked, and only the ticked suggestionIds are sent as
`confirmedLowConfidenceIds` — S321, replacing the earlier one-click batch confirm), plus a batch
irreversible-send `window.confirm`. Manual email edits (`my-candidates.js`) stamp
`emailSource='manual'` so staff-typed addresses read LOW. The researcher adapter treats `manual`
AND `search_contested` as authoritative overwrites of `wmkf_emailsource` (fill-only for other
sources) so a downgraded address can never read HIGH off a stale source
(`lib/dataverse/adapters/researcher.js:151-156`).

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

## 5. S240 current-institution COI — hard drop + durable gate `[VERIFIED 2026-07-03]`

**Contract.** Current same-institution affiliation (reviewer at a proposal-PI institution) is a
foundation POLICY conflict, **hard-dropped on BOTH discovery tracks** and **hard-rejected again at
the durable save boundary**. Matched against the UNION of `piInstitutions(pi, authorInstitution)`
(ORCID-current + OpenAlex last-known + LLM).

- **Discovery.** Track A via `partitionConflicts` / `filterConflicts` in `discover.js`; Track B via
  the same COI partition inside `DiscoveryService.discover()`. Dropped candidates are also written
  to Postgres `reviewer_find_roster` as `status='coi_dropped'` by `recordCoiDropped` when a valid
  request id is present. That ledger is observability-only: it stays out of active/excluded render
  buckets and cannot be selected, recovered, promoted, or saved from the Find UI.
- **Matcher precision.** The COI path uses `DeduplicationService.institutionsMatchForCOI`, not the
  looser generic `institutionsMatch`. COI matching now compares shared OpenAlex/ROR institution ids
  first when both sides carry ids, keeps exact-normalized / abbreviation-expanded / exact key-word
  equality, and uses only narrow same-system campus qualifier containment. It does not use bare
  substring containment or broad subset matching for COI.
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
(`partitionConflicts` + `recordCoiDropped`) · `DiscoveryService.discover()` (`partitionConflicts`) ·
`lib/services/deduplication-service.js` (`institutionsMatchForCOI`) ·
`lib/services/reviewer-roster-store.js` (`recordCoiDropped`).

> **This contract previously had no documentary home outside the agent wiki** — the
> `rejectedInstitutionCOI` durable gate appeared in zero non-wiki docs before this reference
> (S253). The AI `POTENTIAL_CONCERNS` advisory retirement **shipped as Chunk 2b (S254)** — removed
> from prompt/parser/validator/repair/render/persist; COI is now screened deterministically
> server-side. See `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` (historical). Policy memory:
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

## 7. Faculty-page email recovery — default zero-SSRF; opt-in guarded fetch (S265) `[VERIFIED 2026-06-17]`

**Contract.** By DEFAULT the faculty-page path is still the **ZERO-SSRF path — no server-side fetch.**
`my-candidates` GET returns `facultyPageUrl` (selects `wmkf_facultypageurl`); `ReviewerInvitePanel` shows
a "find on faculty page →" link on no-email candidates; staff read the address there and enter it via
`CandidateEditModal` → manual stamp (`emailSource='manual'`, reads LOW per Contract 3) → Slice-G confirm.

**S265 reversal (opt-in only).** The automated server-side fetch the S235 decision declined was BUILT,
behind the `REVIEWER_PAGE_EMAIL_TIER_ENABLED` flag (**default OFF — production behavior unchanged**).
When enabled, `_attachEmailFromResolvedPage` (`contact-enrichment-service.js:934`) runs inside
`_finalize` (after `_attachOpenAlexMetrics`, before the verified-domain guard) and recovers a
page-grounded email via `safeFetchInstitutionPage` (`lib/utils/safe-fetch.js`) with the named SSRF
mechanism Codex required: HTTPS-only, host = exact-or-subdomain of `verifiedInstitutionDomain` ONLY,
DNS private/reserved-IP block incl. IPv6, **undici IP-pinning dispatcher** (closes the DNS-rebind
TOCTOU), per-hop redirect re-validation, content-type + 512 KB + timeout caps. The email is stamped
`emailSource='institution_page'` ONLY when page-grounded (candidate-associated, unique, forename-gated;
`_selectGroundedEmail`) — `institution_page` is HIGH-trust per Contract 3. Rationale + full design:
`docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md` (supersedes `REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D).
Do NOT enable without that mechanism intact; multi-domain institutions (e.g. Kansas State `ksu.edu` vs
OpenAlex `k-state.edu`) are an intentional v1 gap (the fetch is refused, not relaxed).

**Related verified-domain guard (S321 gating redesign — contests, no longer drops).**
`_validateEmailAgainstVerifiedDomain` (`contact-enrichment-service.js:419`) now validates against
**two domain sets** built in `_finalize` by `_buildInstitutionDomainEvidence` (`:255`):
*anchored* (identity-proven, ID-resolved: `verifiedInstitutionDomain` + ORCID
disambiguated-organization RORs → `OpenAlexService.getInstitution`, only on a confirmed/probable
identity) and *plausible* (anchored + name-resolved via `OpenAlexService.searchInstitutions`,
lane-routing only). An anchored match confirms persistence; a SEARCH-sourced contradiction is
re-stamped `emailSource='search_contested'` (`_markEmailContested`, `:303`) — kept, persisted,
LOW at send per Contract 3, staff-confirmed per recipient — instead of nulled into a rejected
lead. A `name_mismatch`-rejected email whose domain is plausible is likewise promoted to
contested in `_finalize` (`_readjudicateNameMismatchRejectedEmail`, `:312`).
ORCID/PubMed/affiliation emails still outrank the heuristic. The opt-in fetch tier above is
SSRF-bound to the **anchored** set only (fallback: the single `verifiedInstitutionDomain` when
the anchored set is empty — today's bound). Design + review history:
`docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`.

**Enforcement points.** Default no-fetch/manual-link boundary: `pages/api/reviewer-finder/my-candidates.js:189`
(returns `facultyPageUrl`, no fetch) · `shared/components/reviewers/ReviewerInvitePanel.js:275-287` (staff-facing
"find on faculty page →" link). Opt-in guarded fetch (flag-gated): `lib/utils/safe-fetch.js`
(`safeFetchInstitutionPage`, `hostWithinDomain`, `isPrivateAddress`) ·
`lib/services/contact-enrichment-service.js:934` (`_attachEmailFromResolvedPage`) +
`_selectGroundedEmail`. The related verified-domain guard:
`lib/services/contact-enrichment-service.js:223, 770`. Audit:
`tests/unit/resolved-page-email-grounding.test.js`, `tests/unit/resolved-page-email-tier-service.test.js`.
Design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`.

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
| 2 | PI-named/cited/referred exemption + force-null | `save-candidates.js:79-82,172-191` (kinds: `reviewer-provenance.js` `isIdentityReviewExemptProvenance`) |
| 3 | Invite-confidence allowlist | `reviewer-invite.js:70-88` + `send-emails.js:292-294` |
| 4 | Structured-PI fail-open/augment-only | `proposal-pi-identity.js:125+` + `reviewer-identity-evidence.js:316-321` |
| 5 | S240 institution COI hard drop | `save-candidates.js:116,150-160` + `discover.js`/`DiscoveryService` `partitionConflicts` + `reviewer-roster-store.js` `recordCoiDropped` |
| 6 | OpenAlex bibliometrics/verified-domain | `contact-enrichment-service.js:676-790` |
| 7 | Faculty-page: default zero-SSRF; opt-in guarded fetch (flag) | `my-candidates.js:189` + `ReviewerInvitePanel.js:275-287` (default) · `safe-fetch.js` `safeFetchInstitutionPage` + `contact-enrichment-service.js:934` (opt-in) |
| 8 | Work-grounding rescue | `reviewer-identity-evidence.js:212-271` |
