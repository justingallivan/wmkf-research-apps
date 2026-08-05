---
agent_wiki: topic
status: active
last_verified: 2026-08-02
stale_after_days: 45
owner: reviewer-finder
source_files:
  - lib/services/reviewer-identity-evidence.js
  - lib/services/reviewer-identity-resolver.js
  - lib/services/contact-enrichment-service.js
  - lib/services/contact-enrichment/page-email.js
  - lib/utils/contact-parser.js
  - lib/services/reviewer-candidate-attestation.js
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/capture-self-reported-orcid.js
  - lib/services/reviewer-acceptance-drain.js
  - lib/services/reviewer-identity-binding-writer.js
  - lib/services/reviewer-roster-store.js
  - lib/services/proposal-pi-identity.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/workbench/reviewer-roster.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/review-manager/send-emails.js
  - pages/api/review-manager/render-emails.js
  - lib/utils/reviewer-invite.js
  - shared/components/reviewers/reviewer-search-logic.js
  - shared/components/reviewers/ReviewerSearchSection.js
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
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/capture-self-reported-orcid.js
  - lib/services/reviewer-acceptance-drain.js
  - lib/services/reviewer-identity-binding-writer.js
  - pages/api/workbench/reviewer-roster.js
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

The fail-closed gates that protect against wrong-person invite risk are owned by the
**maintained** reference `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (each traced to live
source file:line). Read it before changing any of these; do not restate its detail here (one home,
no drift). The 8 contracts:

1. **Slice-E identity-unresolved gate** — client FIND select list (`provenanceGroupOf`) is *stricter* than the server save gate (`isUnresolvedIdentity`, 422 on full-batch reject); the asymmetry is intentional.
2. **PI-named / cited / referred exemption + contact force-null** — `cited_reference`/`proposal_named`/`referred` rows (the exempt kinds in `isIdentityReviewExemptProvenance`, S249) are selectable when unresolved but ALL contact + identity-derived fields are force-nulled (`contactBlockedForUnresolvedExempt`) until confirmed/probable.
3. **Address-action gate** — `send-emails-service` recomputes `emailConfidence` per recipient: valid exact-bundle `staff_verified` is `ready`; legacy source-only `staff_verified` remains `quick_check`; `research_only` is refused for invitations; `missing` has no address; and `conflict_pending` blocks every outbound reviewer template. Evidence-backed verification uses `/api/workbench/reviewer-address-trust`; the former provenance-only `my-candidates verifyEmailAddress` action is retired. No client label authorizes a send.
4. **Structured-PI identity** — `resolveProposalPI` is server-resolved from the request GUID, FAIL-OPEN + AUGMENT-ONLY, gated on confirmed/probable, name-guarded by `forenamesContradict`.
5. **S240 institution COI** — current same-institution is a default HARD DROP on both discovery tracks AND re-rejected at the durable save boundary (`rejectedInstitutionCOI`). Approved Phase C allows a visible read-only flag only for a single low-trust affiliation match contradicted by current-affiliation evidence; save still rejects it. Historical/former-shared COI is retired. The `POTENTIAL_CONCERNS` amber advisory was retired (Chunk 2b, S254) — the model no longer emits it and COI is screened deterministically server-side (`docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`, now historical).
6. **OpenAlex bibliometrics + verified-domain** — `_attachOpenAlexMetrics` sources metrics/affiliation/verified-domain from OpenAlex (ORCID or carried author id; never a bare name search). Scholar deep-links dropped; field renames in `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.
7. **Faculty-page recovery — guarded fetch + ranked mailbox ownership (S265/S321; hardened 2026-07-19)** — The automated tier (`safeFetchInstitutionPage` + `_attachEmailFromResolvedPage`) is code-default off but explicitly enabled in production. It stamps invitation-ready `institution_page` only under the anchored-domain SSRF bound and a unique deterministic mailbox winner: full-name; or, on a title/sole-H1 identity page, initials+surname, surname+initials, or exact surname; then exact URL slug and narrow full-forename adjacency as fallbacks. Equal-best ties, body-only weak forms, domain-only matches, and unmatched role addresses abstain. The broad search-lead helper is not reused. Compact proof/source/alternatives survive `reviewer_find_roster` reload and the card links to the official page; Dataverse/send authorization remains the binary `institution_page` source. The paid-tier ordering experiment still did not authorize a reorder or plausible-domain fetch relaxation. A later zero-paid-call selector replay preserved all prior correct results and added four verified correct people. Design/outcome: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`, `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`, and `docs/REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md`.
8. **Work-grounding rescue** — `rescueByWorkGrounding` is purely additive, strict-forename-gated, `probable`-ceiling; can only resolve an already-abstained name.

## Operating Notes

- Trace hidden write sinks. Start with the route named in the task, then include adapters and service helpers that can persist identity fields or suggestion state.
- ORCID/contact propagation can cross from reviewer-finder into review-manager and honorarium flows. Search call sites before treating it as a local reviewer-finder change.
- **Wave 13 first binding-writer caller (production-live 2026-07-13, PR #57 / `00ffb09c`).** The owner-approved first caller is limited to acceptance-drain self-report with the durable job `accepted_at`. `capture-self-reported-orcid.js` sends clean/already-bound rows through `reviewer-identity-binding-writer.js`, truncates the self-report event identity (`boundAt`/`resolvedAt`) to Dataverse second precision so a job retry replays the stored binding as an exact no-op (Dataverse drops fractional seconds on DateTime round-trips — S362 fix), uses the transitional person writes only for typed `legacy_classification_required`, marks other deterministic typed binding failures non-retryable, and preserves retries for bounded optimistic-concurrency exhaustion or untyped transport failures. `reviewer-acceptance-drain.js` runs this before honorarium/back-propagation and marks the in-memory reviewer confirmed only after `{persisted:true}`. Its lease-guarded email-step claim, cancellation, completion, and failure-recording paths now fail closed on a stale token; drain telemetry carries per-outcome ids, and only a completion update that returned a row enters `completedJobIds`. Decline/no-stable-timestamp calls remain on the transitional path. Automated writers, backfill, merge/action policy, and the four suggestion COI fields are unchanged. Deployment `dpl_4YpnVVdRmDHyuzgPVSKXNcx22bKu` reached READY; three immediate scheduled drain runs had no error-level logs, and the immediate post-deploy Wave 13 population remained zero. The later S363 smoke found a fresh baseline of one person and zero suggestion rows; it did not adjudicate the origin of that pre-existing person row. The manual positive-control smoke is `scripts/smoke-reviewer-binding.js` (safety logic pinned by `tests/unit/smoke-reviewer-binding.test.js` via `scripts/lib/smoke-reviewer-binding-core.js`): it stages a synthetic repeat-accept/opted-out/no-contact job for the deployed cron to claim, asserts the exact first `self_reported` Wave 13 binding (a legacy-fallback-only result fails), persists an incremental recovery artifact before and after every setup write plus on errors/SIGINT/SIGTERM, stops the main flow behind one durable fatal-shutdown path, permits job-backed cleanup only after immutable `completed` status (failed/cancelled jobs can be requeued), and keeps the completed queue row unless `--delete-job`. Owner gating is mechanical (post-Codex hardening, same day): the resolved request GUID must equal `--approved-request-id` and be committed in `scripts/lib/smoke-reviewer-binding-fixtures.js`, `--expect-deployment` must attest the production deployment, deployed-cron attribution requires a `maintenance_runs` details payload whose `completedJobIds` contains the exact smoke job id and whose deployment fingerprint matches the expected SHA prefix or `dpl_` id, and there is no environment-variable confirm fallback. A claimed/retried/failed/lease-lost id cannot satisfy attribution. The owner-authorized S363 production run passed against PR #60 deployment `dpl_BqCBSFWoRto2noQdrovHG7fBsA6X`: maintenance run `15060` attributed completed job `25`, exact `self_reported` binding assertions passed, synthetic Dataverse rows were deleted and absence-verified, the baseline was restored, and job `25` remains retained as the audit row. Do not run `scripts/pr4-e2e.js` for this purpose (see the 2026-07-13 adversarial-review artifact).
- **Reviewer ↔ CRM-contact boundary gap (historical S290 baseline; superseded on the S389 integration branch).** The shipped S290 path tolerated ambiguous ORCID matches, email/ORCID splits, and a concurrently appearing reviewer link. The S389 branch changes the acceptance boundary to fail closed: every existing or candidate Contact must be active and pass name plus email/ORCID validation; ambiguity and split identities remain unlinked for staff review. A genuine new Contact uses a canonical-ORCID-derived deterministic ID across duplicate reviewer rows (reviewer-ID fallback without ORCID), and Contact creation plus reviewer linking commit atomically under the reviewer ETag. Invitation send never promotes or back-propagates. The later acceptance corrections remain: reviewer-self-reported name/title/nickname sync after a validated link; differing email and affiliation remain alert-only. Origination-time confident reuse in candidate save/manual add is a separate pre-existing-Contact policy. Canonical current contract: `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md`; source: `lib/bill/honorarium-onboard-orchestrator.js`.
- Tests that mock an injected resolver or enrichment seam should be paired with at least one unmocked path when the issue involves default credentials, provider routing, or persistence.
- Ranking and verification fields may be consumed downstream even when a task names only enrichment. Trace save, display, and lifecycle consumers before changing field semantics.
- The identity-unresolved, invite-confidence, and institution-COI gates are enforced at the API/persistence boundary, NOT just the client. The clients hide ungrounded rows, but the standalone Reviewer Finder and any direct caller can still POST them — read the enforcement-contracts reference before assuming a client-side check is sufficient.

- **Worked example — namesake-collision recall loss (origination probe, 2026-06-12).** A Claude-named Track-A candidate failed to resolve (`oaId` null) not because the person was fabricated but because **citation-ranked author search resolves the wrong cluster.** Reproducible against live OpenAlex: a real low-footprint researcher (~24 works / ~115 cites) with a *directly on-topic* recent paper shares a name with a **famous unrelated namesake** (a psychologist, ~101 works / ~3,261 cites) that ranks #1 in `GET /authors?search=`; the real person is #2, and her own works are **fragmented across ≥3 author clusters**. Default top-1 name resolution therefore either lands on the wrong person or abstains — and abstaining (`oaId` null) is the SAFE branch (`project-reviewer-verify-fail-dangerous`). Root fixes shipped: field-aware *ranking* (S236: `scoreRecord`/`selectRecord` rank by affiliation+topic overlap, not citations) and the **work-grounding rescue** for the abstain case (Contract 8 above — see the enforcement reference for the safety invariants). The deeper ORCID-works-anchored *origination* corpus remains a separate, larger increment. Names stay in the local gitignored probe artifacts per the names-stay-local norm. Related: `reviewer-identity-fragmentation`.

- **Quarantined contact leads — never a sendable contact (S267, Slice 2a; narrowed S321 and 2026-07-18).** `contactEnrichment.contactLeads[]` surfaces contacts the tiers fetched but discarded (identity-anchor contradiction; name-mismatch whose domain matched no plausible institution domain) and faculty/profile pages found without an email, so staff can see them. A verified-domain contradiction or plausible-domain name mismatch may remain visible as the primary contact with `emailSource='search_contested'`, but the current policy classifies that address as `research_only`: it cannot be sent as an invitation even if a client submits `confirmedLowConfidenceIds`. Leads are produced by `_addContactLead` (single push point; force-sets `persistable:false`) + `_collectContactLeads`; name-mismatch values are preserved on `rejectedEmail` by a pre-null hook in both tiers. SAFETY: leads NEVER feed `email`/`website`/`facultyPageUrl` or any `*_PersistAllowed` flag, never make an unresolved identity saveable, never reach an invite. Measurement layer is the Slice 1 audit (`reviewer-contact-audit.js`); display (Slice 3), staff promotion (Slice 4), and roster persistence (Slice 5) are implemented — see the reviewer-workbench-lifecycle topic. Spec/status: `docs/REVIEWER_CONTACT_LEADS_SPEC.md`; redesign history: `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`.

- **ORCID author-split → metrics land on a sparse stub (S266).** Even WITH a confirmed ORCID, OpenAlex can split one person across multiple author entities sharing that ORCID (e.g. a 139-work record AND a 1-work stub), and the canonical `getAuthorByOrcid` (path form `/authors/https://orcid.org/<id>`) can return the STUB → bibliometrics read "1 publication, h-index 0" (observed live: ORCID `0000-0002-8194-8439`). `_attachOpenAlexMetrics` now resolves the ORCID path via `OpenAlexService.getRichestAuthorByOrcid` — the `?filter=orcid:<id>` LIST form picks the richest entity by works_count (tiebreak h-index, then citations). Same ORCID = same person, so this is safe; the picked record still carries the ORCID so the `acceptPath:'orcid'` gate holds; falls back to the canonical single if the list form is empty. NOTE this is distinct from the namesake-collision case above (that's NO/ambiguous ORCID anchor); the split-stub case is a confirmed ORCID resolving to the wrong ENTITY. `getAuthorByOrcid` is unchanged for the PI-identity path (`proposal-pi-identity.js`).

- **Board-writeup identity person fields (S308).** Three reviewer/staff-CONFIRMED person columns on `wmkf_potentialreviewers` — `wmkf_academicrank` (200; academic rank, NOT an administrative title), `wmkf_primarydepartment` (255), `wmkf_maininstitution` (255) — kept DISTINCT from the enrichment-sourced `wmkf_primaryaffiliation`/`wmkf_department` (those prefill these but overwriting them would degrade reviewer-card display + identity scoring). Captured (required) at Stage 2a accept and staff-editable in the workbench; one canonical current value (board write-ups freeze it). Schema: `lib/dataverse/schema/wave10-reviewer-board-identity/`. Read/write paths: external-reviewer-portal + reviewer-workbench-lifecycle topics; Atlas `docs/atlas/dataverse-wmkf-potentialreviewers.md`. No resolver/provenance interaction (plain person-field writes; not in any identity-status path).

## PD Identity Override — Contact Correction (S285, C0.1 hardened)

A PD who recognizes a `needs_identity_review` candidate (real person, but the auto-resolver couldn't confirm and the suggested email/website are wrong) can rescue them WITHOUT a full re-resolve. On the Find tab, such a card shows **"✓ This is the right person → edit & add"** → opens `CandidateEditModal` in `confirmMode` (email/website/affiliation editable + a required "I've verified this is the correct person" checkbox). On confirm, `ReviewerSearchSection` first calls the authenticated roster `PATCH action:'confirm_identity'`. The server requires an existing active request row and atomically stores a random confirmation id, canonical manual contact, actor profile/system-user ids, timestamp, and `source:'staff_confirmed'`; only then does the client apply its `pdIdentityConfirmed` UI marker and opaque confirmation id. `save-candidates` treats the boolean as non-authoritative: it re-reads the confirmation by the same request + opaque id and requires exact canonical name/email/website/affiliation agreement. Missing, fake, cross-request, changed-contact, or failed reads stop before any adapter write.

A valid confirmation skips the unresolved hard-reject and persists only the
PD-typed email/website/affiliation (manual provenance), while declining to
promote resolver-sourced ORCID/Scholar/metrics; institution COI is still
enforced. Independently, automated `confirmed`/`probable` identity fields
loosen persistence only with the request- and identity-bundle-bound signed
receipt minted by `/api/reviewer-finder/enrich-contacts`. **Hardened on the
non-deployed feature branch:** new receipts mint v4; v3/v4 bind the exact
contact projection (normalized email/source plus persistence flags), and v4
also binds `eligibilityCheckStatus`. A valid v3 receipt remains authoritative
for its eligibility result/evidence but cannot overwrite the stored check
status. V1/v2 remain identity-only during their TTL. Unsigned or mismatched
client identity is deny-only for persistence and durable decision writes. The legacy person row
lacks per-field lineage, so the invalid/abstain path now preserves shared
resolver fields instead of blanket-clearing them; destructive automated clears
remain blocked until same-binding lineage can prove ownership. Email remains
manual/`quick_check`, so per-recipient acknowledgement still fires. Audit:
`matchReason` gets
`[Identity confirmed by PD; contact entered manually]`. Tests cover roster
authority, attestation, contradictory envelopes, stale values, and UI
reconciliation. This covers the *contact-wrong, person-right* case; the
*person-wrong* (namesake) case below is still deferred.

**Promotion parity — one canonical contact projection (2026-07-29 in source;
not deployed).** For every Find-origin candidate,
`projectReviewerContact` is the shared identity/contact authority: it prefers
the effective nested identity result over contradictory top-level UI hints,
requires an authoritative normalized email/source, enforces persistence flags,
applies the same affiliation rescue, and rejects research-only/scraped contact.
`isCandidateSelectable` requires `decision==='ready'`, while
`save-candidates-service` recomputes that decision before any adapter write.
Proposal/cited/referred provenance can keep a row visible but cannot turn an
unresolved or email-less row into a name-only Invite candidate. Applicant
promotion retains its `requiresStaffIdentityConfirmation` parity and now also
requires the canonical roster row plus a fresh canonical person email before
selection. The server alone finalizes exact roster keys as `saved`; an
applicant-excluded collision becomes read-only `blocked`. The placeholder-key
hazard remains documented in
`docs/atlas/postgres-reviewer-find-roster.md`.

**Shared-person monotonicity (2026-07-29 in source; not deployed).** Automated
`confirmed` is sticky, `probable` resists unresolved/ambiguous downgrades, and a
probable refresh requires overlapping trusted anchors. A different-binding
result abstains and alerts rather than overwriting a person shared by other
requests. Compatibility writes require the person ETag. Normal edits ignore an
empty email; an intentional clear is a distinct exact-value/source/reason/ETag
command.

## Future Work — Edit-and-Re-Resolve (Deferred)

**Parked 2026-06-16.** A PD sometimes sees a candidate where the *Why* is directionally correct but the resolved person is wrong — typically a namesake collision (e.g., a physics Jian Wu resolving to a China Pharmaceutical University biomedical Jian Wu). The PD has an out-of-band corrective signal (correct institution from a colleague, a relevant paper title, an ORCID) and wants to re-drive identity resolution without discarding the rationale. **NB:** this is distinct from the shipped contact-correction override above — re-resolve replaces the *person* (publications/COI/contact re-run against new anchors); the override keeps the person and only fixes contact.

What this would require:
- **Edit surface on the candidate card** — editable identity anchors: institution, ORCID, a known paper title or DOI
- **Re-resolve endpoint** — runs identity resolution fresh against the corrected anchors, replacing resolved person data (publications, COI, contact) while preserving the original Why
- **Merge logic** — existing suggestion row updated in place; prior enrichment data cleared and re-run against new identity

Build considerations: the identity resolution pipeline crosses OpenAlex, ORCID, and PubMed lookups; edge cases around partial prior enrichment need careful handling. The `reviewer-identity-fragmentation` memory and the namesake-collision worked example above are directly relevant. Keep this distinct from the applicant-suggested "re-verify" case (which offers little value within a cycle and was intentionally dropped).

## Durable Memory

- Holistic external research and proposed benchmark (research-only; no build
  authorization): `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`.
- Identity resolution spine: `project-reviewer-identity-resolution-phase1`, `reviewer-identity-fragmentation`. Historical S213 false-match rationale is in closed memory `project-reviewer-identity-resolution`.
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
