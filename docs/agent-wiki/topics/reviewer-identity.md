---
agent_wiki: topic
status: active
last_verified: 2026-06-13
stale_after_days: 45
owner: reviewer-finder
source_files:
  - lib/services/reviewer-identity-evidence.js
  - lib/services/reviewer-identity-resolver.js
  - lib/services/contact-enrichment-service.js
  - lib/services/proposal-pi-identity.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/review-manager/send-emails.js
  - pages/api/review-manager/render-emails.js
  - lib/utils/reviewer-invite.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
watch_paths:
  - lib/services/contact-enrichment-service.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/**
  - pages/api/review-manager/send-emails.js
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
update_triggers:
  - identity persistence or clearing behavior changes
  - ORCID/contact propagation changes
  - reviewer ranking or verification confidence changes
  - reviewer suggestion lifecycle write changes
  - identity-unresolved selectability/save-gate behavior changes
---

# Reviewer Identity

Use this page before work on reviewer identity, enrichment, ORCID propagation, current affiliation, reviewer suggestions, or candidate ranking.

## Ground Rules

- `wmkf_potentialreviewers` is the person-level reviewer record and carries identity, contact, and bibliometric fields after the sidecar collapse. Verify current schema and source-of-truth details in `docs/APPLICATION_STATE_ATLAS.md` and `docs/atlas/dataverse-wmkf-potentialreviewers.md`.
- `wmkf_appreviewersuggestion` is the per-request lifecycle ledger. Verify suggestion lifecycle and request-specific persistence in `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`.
- Postgres reviewer tables are historical or dropped for this domain. Before acting on a Postgres reviewer-table claim, check the Atlas page and live callers.
- Generic user/profile input must not be trusted for authenticated identity. Preserve route auth and Dynamics restriction context.

## Recurring Hazards

- Hidden write sinks matter. Do not stop at the route named in the task; trace adapters and service helpers that can persist identity fields or suggestion state.
- ORCID/contact propagation can cross from reviewer-finder into review-manager and honorarium flows. Search call sites before treating it as a local reviewer-finder change.
- Tests that mock an injected resolver or enrichment seam can miss the default production path. Verify at least one unmocked path when the bug involves default credentials, provider routing, or persistence.
- Ranking and verification fields may be consumed downstream even when a task names only enrichment. Trace save, display, and lifecycle consumers before changing field semantics.
- Identity-unresolved candidates are gated at TWO boundaries (Slice E, S235), and the two boundaries are INTENTIONALLY asymmetric — the client select list is stricter than the server save gate:
  - **Client (FIND select list):** BOTH the Workbench and the standalone `reviewer-finder.js` gate selectability on `provenanceGroupOf(c) !== 'needs_identity_review'` — they render the `needs_identity_review` group read-only and exclude it from select-all/save. `provenanceGroupOf` routes a row to `needs_identity_review` when `needsIdentification===true || identityStatus==='unresolved' || verificationStatus==='unresolved'`, OR when the provenance kind is barred/unknown AND the row has NO positive identity. A positively-resolved row (confirmed/probable/verified) is ALWAYS selectable even with a barred kind (e.g. a BARRED Track-A row upgraded by a shared-ORCID Track-B match) — the fallback explicitly excludes it.
  - **Server (`save-candidates.js`):** HARD-REJECTS only the EXPLICIT-unresolved triple (`needsIdentification===true || identityStatus==='unresolved' || verificationStatus==='unresolved'`), per-row (422 if the whole batch is rejected; mixed batches return 200 with `rejectedUnresolved`). It deliberately does NOT gate on the full `provenanceGroupOf` — a BARRED/unknown-kind row with no top-level identity is legitimately saved here from other paths (a contact-enriched person with a resolver verdict but no top-level `identityStatus`; see `tests/unit/reviewer-route-identity-gate.test.js`) with field-level gating. Gating the server on `provenanceGroupOf` would wrongly reject those.
  - The gate must survive a Find-roster reload — `pruneCandidateForRoster` persists `identityStatus`/`needsIdentification`/`verificationStatus`, else a deferred candidate re-surfaces as selectable.
  - **PI-named / cited exemption (S235):** a candidate whose provenance kind is `cited_reference` or `proposal_named` (the proposal author named/cited THIS specific person) is NOT hard-blocked when unresolved — `provenanceGroupOf` routes it to the selectable `cited_or_proposal_named` group even when unresolved (`isIdentityReviewExemptProvenance` checked BEFORE the unresolved gate), and `save-candidates` does NOT 422 it. BUT the save boundary force-nulls ALL contact + identity-derived fields (email/website/faculty-page/affiliation/ORCID/Scholar/bibliometrics) until identity is confirmed/probable (`contactBlockedForUnresolvedExempt`, Codex HIGH) — so a selectable-but-unverified row can't carry a wrong-person email. The card shows an amber "⚠ Verify identity — no contact saved until confirmed" pill. System-discovered (`literature_retrieved`, incl. Slice-E deferred Track-B) stays hard-blocked.
- Invite-confidence gate (Slice G, S235): `send-emails.js` independently computes `emailConfidence(person)` (`lib/utils/reviewer-invite.js`) from `wmkf_emailsource`+`wmkf_identitystatus` and REFUSES a LOW-confidence recipient unless that recipient's `suggestionId` is in the request's `confirmedLowConfidenceIds` allowlist (skip reason `email_unconfirmed`). The acknowledgement is recipient-specific, NOT a batch boolean (Codex post-impl #6: a batch boolean would let a row that became LOW after preview ride on another row's confirmation). HIGH = `orcid`/`pubmed`/`institution_page`, or `serp_search`/`claude_search` on a `confirmed`/`probable` identity; LOW = `manual`, `affiliation`, unknown/null source, or a search email on an unconfirmed identity. **Scoped to `templateType==='invitation'`** (first contact); post-acceptance materials/followup/thankyou are NOT gated. `render-emails.js` stamps `emailConfidence` per draft (the modal DTO is too thin to compute it); `InviteEmailModal` shows the warning + one-click "confirm & send" and sets the flag. Manual email edits (`my-candidates.js`) stamp `emailSource='manual'` via the researcher adapter so staff-typed addresses read LOW. The API is the enforced boundary — the modal acknowledgement alone is not trusted.
- Structured-PI identity (S240): `discover.js` and `enrich-recommended.js` resolve the proposal PI from STRUCTURED Dataverse data (`resolveProposalPI` in `lib/services/proposal-pi-identity.js`: request `_wmkf_projectleader_value`→contact `wmkf_orcid`→exact OpenAlex author via `OpenAlexService.getAuthorByOrcid`) instead of trusting the LLM-extracted PI name. It is server-resolved from the request GUID (clients send `requestId`; never a client-claimed identity), runs in a Dynamics bypass under the time budget, and is FAIL-OPEN + AUGMENT-ONLY: it appends the canonical PI name to the author-exclusion/coauthor set (never replaces the LLM PI + co-Is) and identity-excludes candidates sharing the PI's exact ORCID/OpenAlex id — GATED on `confirmed`/`probable` (unresolved rows keep their id fields, so acting on them would risk a namesake). A mis-entered ORCID is caught by a forename/surname name guard (`forenamesContradict`, exported from `reviewer-identity-evidence.js`) → abstain. Structured PI institution(s) now ALSO drive institution COI — see the next bullet (Chunk 2a, shipped).
- Institution COI = HARD DROP on the PI-institution UNION (S240 Chunk 2a). Current same-institution is a foundation POLICY conflict, hard-dropped on BOTH tracks (Track A via `filterConflicts` in `discover.js`; Track B via `filterConflicts` inside `DiscoveryService.discover()`), matched against the UNION of `piInstitutions(pi, authorInstitution)` (`proposal-pi-identity.js`: ORCID-current + OpenAlex last-known + LLM). `filterConflicts`/`markInstitutionCOI` now accept a string OR an institution array. The `markInstitutionCOI` SOFT flag survives ONLY on the applicant-recommended (`enrich-recommended.js`, D3 = flag-not-drop) and post-enrichment (`enrich-contacts.js`) paths. **HISTORICAL / former-shared institution COI is RETIRED** — `markInstitutionCOI` is current-affiliation only; `institutionCOIDetails.historical` is gone (the "Former shared institution" badge is removed). `affiliationHistory` is still produced/aggregated but is COI-inert (deferred dead-code). Enrichment runs AFTER the discovery drop and can promote a current affiliation that matches a PI institution, so the hard drop is enforced at the durable boundary too: `save-candidates.js` HARD-REJECTS a row with `hasInstitutionCOI` OR a post-enrichment `contactEnrichment.coiRecomputed && hasInstitutionCOI` (`rejectedInstitutionCOI`, 422 if the whole batch) — the authoritative gate, independent of whether the client promoted the flag; both client `isSelectable` helpers also strip those rows. `pruneCandidateForRoster`/`mergeEnrichment` sanitize `institutionCOIDetails` to `{ piInstitution, reviewerInstitution }` (legacy `.historical` stripped on reload). The AI `POTENTIAL_CONCERNS` advisory retirement is **Chunk 2b (NOT yet built)** — see `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`. Policy memory: `project-reviewer-coi-rely-on-self-disclosure`.
- Bibliometrics + verified-domain source = OpenAlex, NOT SerpAPI Scholar (Slice 1b, S251 — SerpAPI→free-stack migration). `ContactEnrichmentService._attachOpenAlexMetrics` (was `_attachScholarMetrics`) sources h-index/i10/citations + the current-affiliation candidate + the verified-email domain from OpenAlex: ORCID path (`getAuthorByOrcid`) or the discovery-spine-resolved author id carried on the candidate (`getAuthorById` on `candidate.openAlexId`+`identityStatus`) — never a bare name search; no anchor → ABSTAIN (no metrics). It writes the `tierResults.openalex_author` DTO that the resolver re-proves (allowlist gate `isOpenAlexAuthorAccepted`; the 1a contract). FREE, so it runs regardless of the paid SerpAPI toggle. Field renames in the same slice: `scholarVerifiedEmail`→`verifiedInstitutionDomain`, `scholarAffiliations`→`openAlexAffiliation`, `affiliationSource:'scholar_current'`→`'openalex_current'`, `tierResults.scholar_profile`→`tierResults.openalex_author`. Google Scholar exact deep-links (#2) are dropped (free search link only; `googleScholarId=null`). The serp Scholar methods are retired from enrichment but kept for dormant S215/S219 scripts. Detail: `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.
- Faculty-page email recovery (Slice F, S235) is the ZERO-SSRF path, NOT a server fetch: `my-candidates` GET returns `facultyPageUrl` (selects `wmkf_facultypageurl`); `CandidatesPanel` shows a "find on faculty page →" link on no-email candidates; staff read the address there and enter it via `CandidateEditModal` → manual stamp → Slice-G confirm. The automated server-side fetch was Codex-reviewed (READY WITH NAMED CHANGES — undici IP-pinning dispatcher, `verifiedInstitutionDomain`-only allowlist, IPv6 private-IP blocklist) but deliberately NOT built (`docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D). If revisiting auto-fetch, that doc has the verified SSRF mechanism — do NOT add a server-side external-page fetch without it.

- **Worked example — namesake-collision recall loss (origination probe, 2026-06-12).** A Claude-named Track-A candidate failed to resolve (`oaId` null) not because the person was fabricated but because **citation-ranked author search resolves the wrong cluster.** Reproducible against live OpenAlex: a real low-footprint researcher (~24 works / ~115 cites) with a *directly on-topic* recent paper shares a name with a **famous unrelated namesake** (a psychologist, ~101 works / ~3,261 cites) that ranks #1 in `GET /authors?search=`; the real person is #2, and her own works are **fragmented across ≥3 author clusters** (`First Last`, `First Last X`, `Last X. First`). Default top-1 name resolution therefore either lands on the wrong person or abstains — and abstaining (`oaId` null) is the SAFE branch: binding the namesake's institution/email to her name would be the wrong-person-invite failure (`project-reviewer-verify-fail-dangerous`). Root fixes: field-aware resolution (rank by proposal-field match, not citations — `project-reviewer-field-aware-verification`) and/or ORCID-works anchoring (pull works from the ORCID record, skipping the name search — `project-openalex-merge-use-orcid-works`). This is a RECALL loss on the *identity* side, not origination: origination found a real, relevant person; resolution dropped her. The specific name + proposal are kept in the local gitignored probe artifacts per the names-stay-local norm. Related: `reviewer-identity-fragmentation`.

  **Partly addressed — work-grounding rescue (SHIPPED S249).** Field-aware *ranking* was already shipped (S236: `scoreRecord`/`selectRecord` score by affiliation+topic overlap, NOT citations — so the famous namesake does not win by citation count). The remaining loss was the **abstain** case: a correct low-footprint person scores 0 because her coarse OpenAlex `x_concepts` don't token-overlap the proposal field text AND Claude gave no usable institution. `reviewer-identity-evidence.js` now adds a **work-grounding rescue** (`rescueByWorkGrounding`) that fires ONLY on `no_openalex_affiliation_or_topic_match`: for the top-3 **forename-fully-agreeing** candidate authors it fetches recent **work titles** (`OpenAlexService.getWorksByAuthor`) and re-tests field overlap against the actual titles, with the author's **own ORCID works list** (`ORCIDService.getWorks`, merge-immune per `project-openalex-merge-use-orcid-works`) as a second corroborator — an informative (≥5-title) off-topic ORCID corpus VETOES the match (likely cluster contamination); a sparse list is uninformative. It promotes via an `authorship_grounded` (strong) anchor with a **`probable` ceiling** (selectable-with-verify, not auto-trusted), requires EXACTLY ONE work-grounded candidate (else abstain), and is **purely additive** — it can only resolve a name the normal path already abstained on, never alter an existing verdict. Safety invariant preserved (`project-reviewer-verify-fail-dangerous`): the strict forename gate means it cannot bind a wrong-forename namesake. Tests: `tests/unit/reviewer-identity-evidence.test.js` (`describe('work-grounding rescue')`). The deeper ORCID-works-anchored *origination* corpus (resolve ORCID-work DOIs → OpenAlex for co-authors/aggregation) remains a separate, larger increment.

## Standard Probe

Start with:

```bash
rg -n "writeIdentityDecision|clearIdentityFields|setOrcidIfAbsent|verificationConfidence|publicationCount5yr|currentAffiliation|unconfirmedMatch" lib pages tests docs
```

Then read the relevant source file and adapter in full enough to trace caller to persistence to consumer.
