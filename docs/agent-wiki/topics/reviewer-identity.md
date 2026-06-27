---
agent_wiki: topic
status: active
last_verified: 2026-06-26
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
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
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

## Live Enforcement Contracts → `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`

The fail-closed gates that protect against the wrong-person-invite failure are owned by the
**maintained** reference `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (each traced to live
source file:line). Read it before changing any of these; do not restate its detail here (one home,
no drift). The 8 contracts:

1. **Slice-E identity-unresolved gate** — client FIND select list (`provenanceGroupOf`) is *stricter* than the server save gate (`isUnresolvedIdentity`, 422 on full-batch reject); the asymmetry is intentional.
2. **PI-named / cited / referred exemption + contact force-null** — `cited_reference`/`proposal_named`/`referred` rows (the exempt kinds in `isIdentityReviewExemptProvenance`, S249) are selectable when unresolved but ALL contact + identity-derived fields are force-nulled (`contactBlockedForUnresolvedExempt`) until confirmed/probable.
3. **Slice-G invite-confidence allowlist** — `send-emails.js` recomputes `emailConfidence` per recipient and refuses LOW unless its `suggestionId` is in `confirmedLowConfidenceIds`; scoped to `templateType==='invitation'`.
4. **Structured-PI identity** — `resolveProposalPI` is server-resolved from the request GUID, FAIL-OPEN + AUGMENT-ONLY, gated on confirmed/probable, name-guarded by `forenamesContradict`.
5. **S240 institution COI** — current same-institution is a HARD DROP on both discovery tracks AND re-rejected at the durable save boundary (`rejectedInstitutionCOI`); historical/former-shared COI is retired. The `POTENTIAL_CONCERNS` amber advisory was retired (Chunk 2b, S254) — the model no longer emits it and COI is screened deterministically server-side (`docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`, now historical).
6. **OpenAlex bibliometrics + verified-domain** — `_attachOpenAlexMetrics` sources metrics/affiliation/verified-domain from OpenAlex (ORCID or carried author id; never a bare name search). Scholar deep-links dropped; field renames in `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.
7. **Faculty-page recovery — default zero-SSRF; opt-in guarded fetch (S265)** — DEFAULT is still no server-side fetch (staff use the "find on faculty page →" link + manual entry). An automated tier (`safeFetchInstitutionPage` + `_attachEmailFromResolvedPage`/`_selectGroundedEmail`) now exists behind `REVIEWER_PAGE_EMAIL_TIER_ENABLED` (**default OFF**); when on it page-grounds an `institution_page` email under the named SSRF mechanism (verifiedInstitutionDomain-only host, IPv6 private-IP block, undici IP-pinning). Design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md` (supersedes `REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D).
8. **Work-grounding rescue** — `rescueByWorkGrounding` is purely additive, strict-forename-gated, `probable`-ceiling; can only resolve an already-abstained name.

## Recurring Hazards

- Hidden write sinks matter. Do not stop at the route named in the task; trace adapters and service helpers that can persist identity fields or suggestion state.
- ORCID/contact propagation can cross from reviewer-finder into review-manager and honorarium flows. Search call sites before treating it as a local reviewer-finder change.
- **Reviewer ↔ CRM-contact boundary gap (S290 findings; one increment SHIPPED 2026-06-26).** Honorarium `ensureContact` no longer find-or-creates by email ONLY: on an email miss it falls back to the reviewer's ORCID (`contacts.findByOrcidCandidates`) — unique match LINKS the existing contact (fixes the duplicate-on-corrected-email bug), ambiguous match creates new + logs a `contactDuplicateRisk` staff-review warning AND (SHIPPED 2026-06-26) writes a durable `system_alerts` row (type `contact_duplicate_risk`, `warning`, category `reviewers`, deduped one-per-reviewer) that surfaces on the /admin alerts dashboard; link-only, fail-open (the alert write is best-effort and never blocks the honorarium), with a concurrency guard that binds to the reviewer's existing LIVE contact link if one appeared since the row was read (`lib/bill/honorarium-onboard-orchestrator.js`). **SHIPPED 2026-06-27 (Increment 1, commit 35693cf2):** origination-time contact match now runs in `save-candidates.js` (before upsert: `lookupReviewerIdentity` over both stores → `setContactLink` on a confident unique ORCID/email match; candidates/conflict → save unlinked + durable `reviewer_contact_match_needs_review` system_alerts warning; pdConfirmed rows lookup email-only; fail-open per candidate), AND `ensureContact` now cross-checks ORCID on an email HIT (email→A vs unique ORCID→B raises `contact_orcid_email_split` and proceeds with the email-matched contact, never blocks, never overwrites `emailaddress1`). **SHIPPED 2026-06-27 (Increment 2a, commit 027fe256; + follow-ups a073dd35):** on the external-reviewer ACCEPT path, the reviewer's self-reported firstName/lastName/title/**nickname** now **overwrite** `contacts.firstname/lastname/jobtitle/nickname` (reviewer-self-report-wins, silent, no conflict alert; fail-open). New `lib/services/sync-reviewer-name-title-to-contact.js` + `contact.updateIdentityFields`, wired into `respond.js` alongside the ORCID capture. **Identity-status gate REMOVED (a073dd35):** the magic-link token already proves identity, so the sync no longer reads `wmkf_identitystatus`; it is fail-closed and requires the accept-path caller to pass `trusted: true`. **Email SHIPPED 2026-06-27 (3ce2607c):** a reviewer accept email differing from the linked contact's `emailaddress1` raises a `reviewer_contact_email_mismatch` staff alert (warning, category `reviewers`, deduped per reviewer; NO contact write — a differing email is often a legitimate alternate/payment email) — `lib/services/alert-reviewer-email-mismatch.js`, wired into `respond.js` after the name/title sync. Non-overlapping with the honorarium `contact_orcid_email_split`/`contact_duplicate_risk` (those compare across DIFFERENT contacts; this is the same linked contact). **Affiliation SHIPPED 2026-06-27 (fa15ee4b) as ALERT-ONLY:** the owner initially chose account-resolution → `parentcustomerid`, but the verification reversed it (no account search-by-name precedent; institution AKAs/acronyms make matching unreliable; `parentcustomerid` is a cross-domain applicant/COI lookup with no write precedent — wrong-account is high-harm for low yield). Instead, a portal-accept affiliation differing from / absent on the contact's institution (parentcustomerid FormattedValue → `_parentcustomerid_value_formatted`, fallback `adx_organizationname`) raises a `reviewer_contact_affiliation_mismatch` staff alert (no write; `lib/services/alert-reviewer-affiliation-mismatch.js`). **Only remaining deferred:** any sync of PD-override corrections (which land on potentialreviewer/researcher, a separate non-accept-path trigger). This epic is otherwise complete: every reviewer correction either syncs (name/title/nickname) or alerts (email, affiliation). (The `contactDuplicateRisk` flag now has a durable /admin-visible surface; only an in-*workbench* per-card surface remains optional.) Distinct from the shipped potentialreviewer↔potentialreviewer merge (which blocks `loser_has_contact`). Full trace + design stub + shipped-increment status: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`.
- Tests that mock an injected resolver or enrichment seam can miss the default production path. Verify at least one unmocked path when the bug involves default credentials, provider routing, or persistence.
- Ranking and verification fields may be consumed downstream even when a task names only enrichment. Trace save, display, and lifecycle consumers before changing field semantics.
- The identity-unresolved, invite-confidence, and institution-COI gates are enforced at the API/persistence boundary, NOT just the client. The clients hide ungrounded rows, but the standalone Reviewer Finder and any direct caller can still POST them — read the enforcement-contracts reference before assuming a client-side check is sufficient.

- **Worked example — namesake-collision recall loss (origination probe, 2026-06-12).** A Claude-named Track-A candidate failed to resolve (`oaId` null) not because the person was fabricated but because **citation-ranked author search resolves the wrong cluster.** Reproducible against live OpenAlex: a real low-footprint researcher (~24 works / ~115 cites) with a *directly on-topic* recent paper shares a name with a **famous unrelated namesake** (a psychologist, ~101 works / ~3,261 cites) that ranks #1 in `GET /authors?search=`; the real person is #2, and her own works are **fragmented across ≥3 author clusters**. Default top-1 name resolution therefore either lands on the wrong person or abstains — and abstaining (`oaId` null) is the SAFE branch (`project-reviewer-verify-fail-dangerous`). Root fixes shipped: field-aware *ranking* (S236: `scoreRecord`/`selectRecord` rank by affiliation+topic overlap, not citations) and the **work-grounding rescue** for the abstain case (Contract 8 above — see the enforcement reference for the safety invariants). The deeper ORCID-works-anchored *origination* corpus remains a separate, larger increment. Names stay in the local gitignored probe artifacts per the names-stay-local norm. Related: `reviewer-identity-fragmentation`.

- **Quarantined contact leads — never a sendable contact (S267, Slice 2a).** `contactEnrichment.contactLeads[]` surfaces contacts the tiers fetched but discarded (verified-domain contradiction — the largest missing-email bucket — plus identity-anchor contradiction and name-mismatch) and faculty/profile pages found without an email, so staff can see them. Produced by `_addContactLead` (single push point; force-sets `persistable:false`) + `_collectContactLeads` + the in-`_validateEmailAgainstVerifiedDomain` withheld capture; name-mismatch values are preserved on `rejectedEmail` by a pre-null hook in both tiers. SAFETY: leads NEVER feed `email`/`website`/`facultyPageUrl` or any `*_PersistAllowed` flag, never make an unresolved identity saveable, never reach an invite. Measurement layer is the Slice 1 audit (`reviewer-contact-audit.js`); display (Slice 3), staff promotion (Slice 4), and roster persistence (Slice 5) are implemented — see the reviewer-workbench-lifecycle topic. Spec/status: `docs/REVIEWER_CONTACT_LEADS_SPEC.md`.

- **ORCID author-split → metrics land on a sparse stub (S266).** Even WITH a confirmed ORCID, OpenAlex can split one person across multiple author entities sharing that ORCID (e.g. a 139-work record AND a 1-work stub), and the canonical `getAuthorByOrcid` (path form `/authors/https://orcid.org/<id>`) can return the STUB → bibliometrics read "1 publication, h-index 0" (observed live: ORCID `0000-0002-8194-8439`). `_attachOpenAlexMetrics` now resolves the ORCID path via `OpenAlexService.getRichestAuthorByOrcid` — the `?filter=orcid:<id>` LIST form picks the richest entity by works_count (tiebreak h-index, then citations). Same ORCID = same person, so this is safe; the picked record still carries the ORCID so the `acceptPath:'orcid'` gate holds; falls back to the canonical single if the list form is empty. NOTE this is distinct from the namesake-collision case above (that's NO/ambiguous ORCID anchor); the split-stub case is a confirmed ORCID resolving to the wrong ENTITY. `getAuthorByOrcid` is unchanged for the PI-identity path (`proposal-pi-identity.js`).

## PD Identity Override — Contact Correction (S285, SHIPPED)

A PD who recognizes a `needs_identity_review` candidate (real person, but the auto-resolver couldn't confirm and the suggested email/website are wrong) can rescue them WITHOUT a full re-resolve. On the Find tab, such a card shows **"✓ This is the right person → edit & add"** → opens `CandidateEditModal` in `confirmMode` (email/website/affiliation editable + a required "I've verified this is the correct person" checkbox). On confirm, `confirmIdentityContact` (ReviewerSearchSection) stamps the contact `manual` + sets `pdIdentityConfirmed:true`, which makes the row selectable (`isSelectable`) and is sent to `save-candidates`. The server honors `pdIdentityConfirmed` as an explicit, isolated override (`rawCandidate.pdIdentityConfirmed === true`): it **skips the `isUnresolvedIdentity` hard-reject** and persists the PD-typed email/website/affiliation (sourced ONLY from `candidate.*`, never the enrichment fallback — a blanked field stays null), while **force-nulling all resolver-sourced ORCID/Scholar/metrics** (`blockByIdentity`/`blockScholar` forced true) and **skipping `writeIdentityDecision`** (no resolver verdict is fabricated). **Institution-COI is NOT waived** by the override (identity confirmation ≠ COI waiver). Email stays `manual` → confirm-before-invite still fires at send. Audit: `matchReason` gets `[Identity confirmed by PD; contact entered manually]`. Every server branch is `pdConfirmed ? override : existing`, so the auto-discovery firewall is unchanged for normal rows. Tests: `tests/unit/reviewer-route-identity-gate.test.js` (PD-override block). This covers the *contact-wrong, person-right* case; the *person-wrong* (namesake) case below is still deferred.

## Future Work — Edit-and-Re-Resolve (Deferred)

**Parked 2026-06-16.** A PD sometimes sees a candidate where the *Why* is directionally correct but the resolved person is wrong — typically a namesake collision (e.g., a physics Jian Wu resolving to a China Pharmaceutical University biomedical Jian Wu). The PD has an out-of-band corrective signal (correct institution from a colleague, a relevant paper title, an ORCID) and wants to re-drive identity resolution without discarding the rationale. **NB:** this is distinct from the shipped contact-correction override above — re-resolve replaces the *person* (publications/COI/contact re-run against new anchors); the override keeps the person and only fixes contact.

What this would require:
- **Edit surface on the candidate card** — editable identity anchors: institution, ORCID, a known paper title or DOI
- **Re-resolve endpoint** — runs identity resolution fresh against the corrected anchors, replacing resolved person data (publications, COI, contact) while preserving the original Why
- **Merge logic** — existing suggestion row updated in place; prior enrichment data cleared and re-run against new identity

Build considerations: the identity resolution pipeline crosses OpenAlex, ORCID, and PubMed lookups; edge cases around partial prior enrichment need careful handling. The `reviewer-identity-fragmentation` memory and the namesake-collision worked example above are directly relevant. Do not conflate this with the applicant-suggested "re-verify" case (which offers little value within a cycle and was intentionally dropped).

## Durable Memory

- Identity resolution spine: `project-reviewer-identity-resolution`, `project-reviewer-identity-resolution-phase1`, `reviewer-identity-fragmentation`.
- ORCID and OpenAlex: `project-reviewer-self-report-orcid-sticky-confirmed`, `project-openalex-merge-use-orcid-works`.
- Safety posture: `project-reviewer-verify-fail-dangerous`, `project-reviewer-field-aware-verification`.
- Contact enrichment: `project-reviewer-contact-enrichment-anchoring`, `project-serpapi-budget-latency`, `project-serpapi-capability-erosion`.
- Structured PI and COI: `project-reviewer-pi-identity-structured`, `project-reviewer-coi-rely-on-self-disclosure`, `project-reviewer-coi-concern-surfacing`.
- Matching and institution contacts: `project-reviewer-institution-match`, `project-contact-promotion-permission`, `project-institution-foundation-liaison`.

## Standard Probe

Start with:

```bash
rg -n "writeIdentityDecision|clearIdentityFields|setOrcidIfAbsent|verificationConfidence|publicationCount5yr|currentAffiliation|unconfirmedMatch" lib pages tests docs
```

Then read the relevant source file and adapter in full enough to trace caller to persistence to consumer.
