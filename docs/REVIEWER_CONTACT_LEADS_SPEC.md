# Reviewer Contact Leads / Scout Layer Spec

Status: **PROPOSED DRAFT for Justin + Claude review**  
Drafted: 2026-06-18  
Scope: Reviewer Finder contact recall and staff workflow. This is a product/architecture spec, not an implementation record.

## 1. Problem

The Reviewer Finder has become safer by withholding wrong-person contact data, but that same safety behavior now suppresses useful reviewer leads.

Current live behavior separates invite-safe contact data poorly from staff-useful breadcrumbs:

- `[VERIFIED via lib/services/discovery-service.js:43-52]` Track-B retrieval-originated candidate discovery is archived off with `TRACK_B_ENABLED = false`, so current runs depend heavily on Claude-named Track-A suggestions.
- `[VERIFIED via shared/config/prompts/reviewer-finder.js:8-14]` Stage-1 database search-query generation was removed after Track B was archived, leaving `searchQueries` as stable empty shape for existing consumers.
- `[VERIFIED via lib/services/contact-enrichment-service.js:483-495]` contact enrichment computes an identity/institution anchor and marks unanchored candidates as `contactStatus: 'unresolved'`.
- `[VERIFIED via lib/services/contact-enrichment-service.js:484-487]` the current contact-search gate is **institution OR ORCID**, not full identity confirmation: `hasIdentityAnchor = !!effectiveInstitution || this._hasOrcidAnchor(...)`.
- `[VERIFIED via lib/services/contact-enrichment-service.js:91-101]` `effectiveInstitution` comes from ORCID affiliation, `candidate.affiliation`, `candidate.institution`, or `candidate.primaryAffiliation`; it does not directly read `suggestedInstitution`.
- `[VERIFIED via lib/services/contact-enrichment-service.js:501-572]` Claude web search runs only when `hasIdentityAnchor` is true; otherwise it is skipped.
- `[VERIFIED via lib/services/contact-enrichment-service.js:579-650]` SerpAPI Google search likewise only searches for missing email when `hasIdentityAnchor` is true.
- `[VERIFIED via lib/services/contact-enrichment-service.js:123-141]` the unanchored abstain path clears email, website, faculty page, metrics, affiliation candidates, and all related persist flags.
- `[VERIFIED via lib/services/contact-enrichment-service.js:513-517 and lib/services/contact-enrichment-service.js:593-597]` anchor-contradicting Claude/Serp results are already preserved in `tierResults` with `rejectedReason: 'identity_anchor_contradiction'`.
- `[VERIFIED via lib/services/contact-enrichment-service.js:606-613]` a name-inconsistent SerpAPI email is nulled in place after `tierResults.serp_search = serpResult`, so recovering that discarded email requires a capture hook before mutation.
- `[VERIFIED via lib/services/contact-enrichment-service.js:545-551]` Claude can report `emailRejectedReason: 'name_mismatch'`, but the code does not mutate `claudeResult.email` in the analogous way.
- `[VERIFIED via pages/api/reviewer-finder/save-candidates.js:56-67]` unresolved system-discovered identities are hard-rejected at save.
- `[VERIFIED via pages/api/reviewer-finder/save-candidates.js:79-82 and pages/api/reviewer-finder/save-candidates.js:169-187]` unresolved exempt rows can save as name rows, but contact and identity-derived fields are force-nulled or field-gated before persistence.
- `[VERIFIED via shared/components/reviewers/CandidatesPanel.js:191-205]` the saved-candidates UI already has a manual recovery pattern: when no email exists but a page exists, it shows "find on faculty page ->".

That behavior is right for automated persistence and invitations. It is too strict for a staff workbench whose practical goal is: "give me enough context to find and evaluate possible reviewers."

## 2. Product Goal

Add a **contact scout layer** that searches aggressively for contact/context leads, while keeping automatic persistence and invitation gates strict.

The tool should behave like this:

1. Search like a research assistant.
2. Persist like a compliance system.
3. Invite like a safety-critical workflow.

The user-visible outcome should be:

- Verified email/website when available.
- Otherwise, ranked possible contact leads with source, evidence, and warnings.
- Clear explanation of why a lead is not automatically usable.
- Staff-controlled promotion from lead to saved/manual contact.

## 3. Core Distinction

Do not overload the existing `email`, `website`, and `facultyPageUrl` fields with unsafe data.

Introduce a separate `contactLeads[]` collection:

```js
{
  type: 'email' | 'website' | 'faculty_page' | 'profile',
  value: 'person@example.edu',
  sourceUrl: 'https://department.example.edu/faculty/person',
  sourceTitle: 'Faculty Profile - Person Name',
  sourceSnippet: '...',
  source: 'claude_search' | 'serp_search' | 'institution_page' | 'orcid' | 'pubmed' | 'manual_probe',
  searchQuery: '"Person Name" "University" email',
  confidence: 'high' | 'medium' | 'low' | 'rejected',
  persistable: false,
  evidence: {
    nameMatched: true,
    institutionMatched: true,
    fieldKeywordMatched: true,
    domainMatched: true,
    officialPage: true
  },
  warnings: [],
  rejectedReason: null
}
```

`contactLeads[]` are **not** sendable contact fields. They are staff-facing breadcrumbs.

## 4. Confidence Semantics

### Auto-Persistable

This is existing behavior and should remain rare:

- ORCID-maintained email/profile.
- Recent PubMed author-affiliation email.
- Institution-page email found by the guarded faculty-page tier.
- Search-sourced email only when the existing identity/institution/domain gates approve it.

These continue to populate `email`, `website`, `facultyPageUrl`, and `*_PersistAllowed` fields.

### High-Confidence Lead

Display prominently as a likely useful lead, but do not auto-invite:

- Found on expected institution domain.
- Page contains candidate name.
- Page contains expected institution or department context.
- Email appears on the same page or near candidate name.
- Field keyword or lab/research context matches when available.

Example label: "Likely official contact lead - review before use."

High-confidence is deliberately conservative:

- Do not mark snippet-only evidence high-confidence for a common name.
- Do not mark a lead high-confidence when institution evidence is missing or only weakly inferred.
- Do not mark a lead high-confidence solely because a search query included the institution; the returned result must itself show institution/domain evidence.

### Medium-Confidence Lead

Display below high-confidence leads:

- Name matches.
- Some institution, field, or topic context matches.
- Source is not a verified institutional domain, or evidence is snippet-only.

Example label: "Possible contact lead - verify page before use."

### Low-Confidence Lead

Collapsed by default or shown with warning:

- Name matches, but institution is missing.
- Personal/lab page plausible but not clearly tied to expected identity.
- Email domain not tied to known institution.

Example label: "Weak lead - possible namesake."

### Rejected Lead

Keep for audit/debugging, not normal display:

- Full-name mismatch.
- Obvious different profession/person.
- Institution/domain contradiction.
- Generic directory spam.
- Document/media URL not suitable as a profile page.

Rejected leads explain why the system did not use an apparently found result.

### Evidence Flag Derivation

Evidence flags must be mechanically derived and explainable:

- `nameMatched`: exact normalized full-name match on page title/snippet/body, or full surname + compatible given name/initial. A surname-only match is false.
- `institutionMatched`: expected institution, accepted acronym/domain, or known institutional domain appears in the returned page evidence. Query terms alone do not count.
- `fieldKeywordMatched`: one or more proposal/candidate field keywords appear in page evidence. Topic match supports ranking only; it is never identity proof.
- `domainMatched`: source URL host is exact-or-subdomain of `verifiedInstitutionDomain`, or of an accepted institution domain derived from an accepted OpenAlex/ORCID institution.
- `officialPage`: source URL is an institutional profile/lab/department page, ORCID profile, PubMed/NCBI profile, Google Scholar page, or other known academic profile surface. Generic people-search pages are false.

When the evidence comes only from a search snippet and not a fetched/official page, cap confidence at `medium`.

## 5. Search Strategy

Lead discovery may use broader queries than persistence because its output is quarantined.

For each candidate, build a small bounded query plan from available context:

- Name only: `"Full Name" email`
- Name + institution: `"Full Name" "Institution" email`
- Name + institution domain when known: `site:institution.edu "Full Name"`
- Name + field keyword: `"Full Name" "attosecond" email`
- Name + institution + field: `"Full Name" "Max Born Institute" "attosecond"`
- Name + page intent: `"Full Name" faculty`, `"Full Name" lab`, `"Full Name" group`

Inputs should come from:

- candidate name
- candidate affiliation / suggested institution
- ORCID current affiliation when available
- OpenAlex last-known institution when accepted
- proposal keywords / expertise areas
- known verified institution domain when available

Bound the search budget:

- First implementation: maximum 3-5 queries per candidate.
- Only run for candidates visible to staff and missing verified email or missing useful website.
- Prefer official-domain queries when `verifiedInstitutionDomain` is known.
- Do not add new queries for candidates that already have a high-confidence persisted email unless staff explicitly asks to scout.

## 6. Pipeline Changes

### Slice 1: Measurement / Audit

**Status: IMPLEMENTED (S267).** Pure classifier `lib/services/reviewer-contact-audit.js`
(`classifyContactOutcome` + `summarizeContactOutcomes`); aggregated into
`results.stats.contactAudit` by `ContactEnrichmentService.enrichCandidates`; logged
server-side by `enrich-contacts.js` and `workbench/enrich-recommended.js` (and carried
on the SSE complete-event stats). No behavior/persistence change; UI summary still TODO.
The classifier reads the post-enrichment `contactStatusReason` / `identity.status` /
`tierResults`, so the dominant-bucket split is measured, not assumed.

Add a diagnostic report for the last enrichment run or a supplied candidate batch:

Classify missing contact by reason:

- `verified_contact_present`
- `withheld_by_gate`
- `search_skipped_no_anchor`
- `searched_no_result`
- `has_page_no_email`
- `lead_found_not_persisted`
- `namesake_ambiguous`
- `identity_unresolved`
- `provider_error`

This should be surfaced in logs/progress first; a UI summary can follow.

Important measurement nuance: because the paid-search anchor is institution-or-ORCID, not confirmed identity, some unresolved candidates can still search when an institution has been mapped into `affiliation`, `institution`, or `primaryAffiliation`. Do not assume every Claude-only `suggestedInstitution` row searches; measure the actual buckets.

Acceptance:

- A reviewer run reports how many candidates lack email because search was skipped vs searched and failed.
- For search-sourced results rejected by gates, the rejected candidate/source/reason is visible in structured output.

### Slice 2a: Surface Existing Discards As Leads

**Status: IMPLEMENTED (S267).** `ContactEnrichmentService` now collects
`contactEnrichment.contactLeads[]` from contacts the tiers already fetched but discarded —
with no new network calls. Capture points: `_validateEmailAgainstVerifiedDomain` (the
verified-domain-contradiction class, the largest missing-email bucket per Slice 1) captures
before nulling; `_collectContactLeads` (in `_finalize`) reads the anchor-contradiction +
name-mismatch markers on `tierResults` and promotes a faculty/profile page found without an
email. Name-mismatch email values are preserved on `rejectedEmail` by a pre-null hook in
both the Claude tier (`claudeWebSearch`) and the Serp tier. `_addContactLead` is the single
push point and force-sets `persistable:false` (the quarantine guarantee). Default-on for
both enrichment routes (no toggle). Display (Slice 3), staff promotion (Slice 4), and roster
persistence (Slice 5) are implemented — see their sections below.

Extend `ContactEnrichmentService.enrichCandidate` to collect `contactEnrichment.contactLeads = []`.

Collection rules:

- When Claude/Serp finds an email or URL that fails persistence gates, add it as a lead instead of only discarding it.
- When a result contradicts the identity anchor, add it as `confidence: 'rejected'` with `rejectedReason: 'identity_anchor_contradiction'`.
- Add a pre-null capture hook for the SerpAPI name-inconsistent email case before `serpResult.email = null`.
- Promote faculty/profile pages found by existing tiers as contact leads even when no email is present.
- No new network calls in this slice.

This cheap path should be default-on for Workbench results because it only surfaces data already fetched or intentionally discarded.

Acceptance:

- Existing save/invite tests still pass unchanged.
- A candidate with no persistable email can still return one or more `contactLeads`.
- `contactLeads` never cause `emailPersistAllowed` or `websitePersistAllowed` to become true by themselves.
- SerpAPI name-inconsistent emails are represented as rejected/low-confidence leads without being applied to `email`.
- Existing faculty/profile page URLs are rendered as leads even when no email was found.

### Slice 2b: Broad Lead-Only Scout

Add new broad searches only after Slice 1 shows this is worth the paid latency/cost.

Rules:

- Default per-candidate query budget starts at 3.
- Enforce a per-run cap.
- If Slice 1 justifies building this, default it on for staff within the hard cap instead of hiding it behind an opt-in toggle.
- Run only for candidates visible to staff and missing verified email or missing useful page.
- Broad scout output must not set `email`, `website`, `facultyPageUrl`, or any `*_PersistAllowed` flag.
- Broad scout results may populate only `contactLeads[]`.

Acceptance:

- Broad scout can be enabled without changing save/invite safety behavior.
- A hard budget prevents runaway paid searches.
- Progress/audit output reports how many broad-scout searches ran and which candidates they covered.

### Slice 3: Candidate Card Display

**Status: IMPLEMENTED (S267).** `shared/components/reviewers/ContactLeads.js` (read-only)
renders `contactEnrichment.contactLeads` in the workbench/find card
(`ReviewerSearchSection` `CandidateCard`), gated on `!identityUnverified && !email` and
deduped against the website chip already shown. High/medium leads show prominently;
low/rejected collapse behind a "Show N weak / rejected leads" toggle, each with the reason
it was not auto-used. No promotion action yet — "Use this email" is Slice 4. With only
Slice 2a confidences assigned today (low for pages, rejected for discards), the prominent
slot is usually empty and leads live behind the toggle. Leads ride the live-enriched
`contactEnrichment`; roster-reloaded rows drop them until Slice 5 persists a compact form.

Render contact leads separately from verified contact fields.

UI shape:

- If `email` exists: show the email normally.
- If no `email` but high/medium leads exist: show "Possible contact leads" with top 1-3 leads.
- Each lead gets:
  - value
  - source label
  - source link
  - confidence/warning
  - action: "Open source"
  - action: "Use this email" or "Use this website" only for users who can manage reviewers
- Low-confidence/rejected leads are collapsed behind "show rejected/weak leads".

The existing "find on faculty page ->" pattern should remain and can be generalized into lead display.

Acceptance:

- Staff can see likely email/page leads without those leads being saved as verified contact fields.
- The visual distinction between verified contact and possible lead is unambiguous.

### Slice 4: Staff Promotion

**Status: IMPLEMENTED (S267).** A manage-only "Use this email" / "Use this page" action on
each lead (`ContactLeads` `onUse`, threaded `CandidateCard` → `ReviewerSearchSection.useLead`,
gated on `canManage`). It promotes in place rather than via a separate edit modal (the find
card has none): it stamps `emailSource:'manual'` (`websiteSource:'manual'` for a page), clears
the contact-layer abstain that withheld the value (e.g. `verified_domain_contradiction`) so
save can persist it, and auto-selects the row. Provenance persists via `save-candidates`, and
the live invite gate `emailConfidence` (`lib/utils/reviewer-invite.js`) classifies `manual` as
**low** — so a promoted lead still hits the confirm-before-send flow (`send-emails` refuses a
low address without `confirmedLowConfidenceIds`). No auto-send. Only offered for identity-OK
rows (leads are gated on `!identityUnverified`). Locked by tests.

**On-card manual edit (S267 follow-up).** Beyond promoting a surfaced lead, a manage-only
"✏️ Edit contact" on the Find/Workbench card opens `CandidateEditModal` in a new local mode
(`onApply` prop — applies to client state instead of PATCHing the saved-row `my-candidates`).
Staff can correct email/website (and affiliation/h-index) by hand — e.g. an address found on
the reviewer's own page that differs from the Google-suggested one — overriding a wrong
existing value. Email/website go through the SAME `setManualContact` mutation as promotion
(`emailSource:'manual'` → low-confidence invite). The Name field is locked in this mode (the
Find card is keyed by normalized name; renaming there would desync selection/dedup). The
saved-candidates editor (CandidatesPanel) keeps full PATCH-mode editing including name.

Add a manual promotion path:

- Staff clicks "Use this email" on a lead.
- UI opens the existing edit modal prefilled with the lead value and source URL.
- Saving stamps the email source as manual/staff-confirmed, not as automated search.
- Invitation confidence remains governed by the existing low-confidence confirmation flow.

Do not auto-send after promotion.

Acceptance:

- Promoted lead persists as a staff-entered contact.
- Invitation preview still computes email confidence from saved provenance.
- A low-confidence manually promoted email still requires explicit send confirmation.

### Slice 5: Durable Lead Storage

**Status: IMPLEMENTED (S267).** `pruneContactLeads` (in `reviewer-search-logic.js`) produces a
compact, bounded (max 8), payload-free leads array (drops `warnings`/`evidence`, caps string
lengths, re-asserts `persistable:false`); `pruneCandidateForRoster` includes it in the
`contactEnrichment` subset, so both server write paths (`workbench/reviewer-roster`,
`workbench/enrich-recommended`) persist it and a roster reload re-renders the section. Live
rows already keep leads via `mergeEnrichment` (full spread). No Dataverse change.

For v1, persist bounded `contactLeads[]` in the durable Find roster cache, not Dataverse.

Use Option A:

- Add compact, bounded `contactLeads` to the `pruneCandidateForRoster` DTO.
- Carry `contactLeads` through `mergeEnrichment` so live enrichment results and roster-reloaded rows have the same render shape.
- Render from the compact lead shape in the candidate card; do not require raw `tierResults`.
- Keep raw `tierResults`, identity internals, long snippets, and unbounded result arrays out of roster storage.
- Keep Dataverse schema unchanged.

This supports the review -> open source -> promote workflow across reloads without turning leads into durable reviewer facts.

## 7. Safety Invariants

These must remain true:

- `contactLeads[]` never populate `wmkf_emailaddress`, `wmkf_website`, or `wmkf_facultypageurl` automatically.
- `contactLeads[]` never make an unresolved identity saveable as a vetted reviewer.
- `contactLeads[]` never bypass the invite-confidence gate.
- Rejected/low-confidence leads are never displayed as primary contact info.
- A lead-only scout result must not affect ranking, identity status, verified metrics, or COI status.
- Any server-side page fetch must continue to use the existing SSRF-safe institution-page mechanism; broad web search remains provider/API based, not arbitrary server fetch.
- A lead promoted via staff action must be stamped as manual/staff-entered contact provenance and must still run through low-confidence invite confirmation unless a separate high-trust source later verifies it.
- Roster-persisted leads must be size-bounded and must not include raw provider payloads.

## 8. Non-Goals

- Do not loosen identity confirmation.
- Do not make broad web search an automatic persistence source.
- Do not re-enable old Track B unchanged.
- Do not treat topic overlap as identity proof.
- Do not add a Dataverse schema change in the first slice unless review decides durable leads are required immediately.

## 9. Open Questions for Review

1. Should lead-only search run for unresolved identities, or only for identities that are at least `probable` / human-grounded?
2. Should likely namesake leads be hidden entirely by default, or shown under an audit expander?
3. What is the compact roster DTO for `contactLeads[]`, and what payload size cap should it enforce?
4. What is the maximum acceptable per-candidate lead-search budget?
5. Should "Use this email" require opening the source URL first, or is the existing edit/save confirmation enough?
6. Should broad lead-only scout run for unresolved identities, or only for name-grounded unresolved identities with OpenAlex/PubMed/ORCID evidence?

## 10. Suggested First Implementation

Start with the smallest product-correct order:

1. Add Slice 1 measurement/audit, including `namesake_ambiguous`.
2. Add `contactLeads[]` to `contactEnrichment`.
3. Implement Slice 2a: capture already-discarded Claude/Serp results, add the Serp pre-null hook, and surface existing faculty/profile pages as leads.
4. Persist compact leads in the Find roster cache.
5. Render high/medium leads in the candidate card, with weak/rejected leads collapsed.
6. Wire "Use this email" into the existing manual edit flow.
7. Add tests that manual promotion remains low-confidence for first-contact invitation unless separately verified.
8. Use Slice 1 results to decide whether to build Slice 2b broad paid scout.

This restores staff utility while preserving the safety gates that prevent wrong-person invitations.
