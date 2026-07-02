---
name: project-reviewer-identity-resolution
description: Historical S213 false-match root cause and redesign rationale. Live resolver/enforcement work shipped later; use phase1 memory and enforcement docs for current behavior.
metadata:
  type: project
  status: closed
  scope: reviewer
  last_verified: 2026-07-02 via code-grounded memory triage; demoted because the shared resolver and route gates now exist in source and narrower active memories
---

## Recall Rule

Read this only when: you need the original S213 false-match root cause and design rationale (discovery is not identity). For current resolver behavior, route gates, and persisted `wmkf_identity*` fields, read [[project-reviewer-identity-resolution-phase1]], `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`, and live source.

Do:
- Treat the displayed-name/identity-status persistence gate as SHIPPED. Verify current behavior in `lib/services/reviewer-identity-resolver.js`, `pages/api/reviewer-finder/save-candidates.js`, `pages/api/workbench/enrich-recommended.js`, `lib/dataverse/adapters/researcher.js`, and `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`.
- Use this memory for why the system chose "unresolved over wrong-and-confident."
- Hold the principle: unresolved is acceptable; wrong-and-confident is not.

Do not:
- Assume institution match implies identity match — a lab postdoc shares the PI's affiliation (Tsai → Nakano).
- Treat the old pre-implementation plan framing below as current.
- Trust already-persisted Scholar/ORCID metrics from before the shipped gates — audit them through the current scripts/docs first.

Ground truth: current source and `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`; historical rationale in `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`; active memory [[project-reviewer-identity-resolution-phase1]].

**Closed 2026-07-02:** The plan this memory described has been superseded by shipped source: `resolveIdentity`/`mayPersistIdentity`, route-level persistence gates, `writeIdentityDecision`, `clearIdentityFields`, ORCID back-propagation, and route/unit tests. Keep this file for the original false-match story and design rationale, not as active routing.

Reviewer Finder persistently **false-matches** people: it conflates "candidate relevance" with "human identity." Live trigger (S213): searching "Li-Huei Tsai" attached Google Scholar metrics for **Masayuki Nakano**, a postdoc in her lab, because his Scholar affiliation reads "Li-Huei Tsai Lab, MIT" and `DiscoveryService.checkInstitutionMismatch` only checks *institution* (he's genuinely at MIT → passes), with no name-identity guard on the Scholar profile before `ContactEnrichmentService._attachScholarMetrics` persists h-index/citations.

**Historical plan: `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`** (Codex-authored S213; the pre-implementation framing is superseded). Phasing:
- **Phase 1 (quick, no new APIs):** strict Scholar *displayed-name* guard before accepting metrics; ORCID `findContact` scores candidates instead of taking first-with-email; don't PERSIST Scholar/ORCID metrics in `save-candidates`/`enrich-recommended` without an identity-confidence status. Supersedes the insufficient S211 institution-aware attempt.
- **Phase 2:** shared **identity resolver** (`status: confirmed|probable|ambiguous|unresolved|rejected` + anchors: ORCID iD / Scholar author ID / email domain / DOI-PMID cluster) as the contract between discover and enrich; ranking (`relevance-score.js`) ignores bibliometrics unless identity trusted; abstain/human-review path.

**Guiding principle:** *unresolved is acceptable; wrong-and-confident is not.*

**Data-governance tie-in:** the [[project-appresearcher-collapse-post-pilot]] collapse just migrated bibliometrics onto the person — some are wrong matches (Tsai's were cleared manually S213). When Phase 1 lands, AUDIT the already-persisted Scholar/ORCID metrics rather than trusting them. Related: [[project-reviewer-workbench-invite-workflow]] (enrichment must disambiguate by affiliation).
