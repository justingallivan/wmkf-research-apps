---
name: project-reviewer-identity-resolution
description: Reviewer Finder false-match root cause + redesign plan (discovery ≠ identity); Codex plan at docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: S213 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: diagnosing or redesigning reviewer false-matches (discovery ≠ identity), or planning the shared identity resolver.

Do:
- Add a strict displayed-name guard before accepting Scholar metrics; score ORCID `findContact` candidates instead of taking first-with-email.
- Gate persistence on an identity-confidence status (`confirmed|probable|ambiguous|unresolved|rejected`) with anchors (ORCID iD / Scholar author ID / email domain / DOI-PMID cluster).
- Hold the principle: unresolved is acceptable; wrong-and-confident is not.

Do not:
- Assume institution match implies identity match — a lab postdoc shares the PI's affiliation (Tsai → Nakano).
- Trust already-persisted Scholar/ORCID metrics from before Phase 1 — audit them.

Ground truth: `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` (Codex-authored S213), `DiscoveryService.checkInstitutionMismatch`, `ContactEnrichmentService._attachScholarMetrics`.

Reviewer Finder persistently **false-matches** people: it conflates "candidate relevance" with "human identity." Live trigger (S213): searching "Li-Huei Tsai" attached Google Scholar metrics for **Masayuki Nakano**, a postdoc in her lab, because his Scholar affiliation reads "Li-Huei Tsai Lab, MIT" and `DiscoveryService.checkInstitutionMismatch` only checks *institution* (he's genuinely at MIT → passes), with no name-identity guard on the Scholar profile before `ContactEnrichmentService._attachScholarMetrics` persists h-index/citations.

**Plan: `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`** (Codex-authored S213, no code yet). Phasing:
- **Phase 1 (quick, no new APIs):** strict Scholar *displayed-name* guard before accepting metrics; ORCID `findContact` scores candidates instead of taking first-with-email; don't PERSIST Scholar/ORCID metrics in `save-candidates`/`enrich-recommended` without an identity-confidence status. Supersedes the insufficient S211 institution-aware attempt.
- **Phase 2:** shared **identity resolver** (`status: confirmed|probable|ambiguous|unresolved|rejected` + anchors: ORCID iD / Scholar author ID / email domain / DOI-PMID cluster) as the contract between discover and enrich; ranking (`relevance-score.js`) ignores bibliometrics unless identity trusted; abstain/human-review path.

**Guiding principle:** *unresolved is acceptable; wrong-and-confident is not.*

**Data-governance tie-in:** the [[project-appresearcher-collapse-post-pilot]] collapse just migrated bibliometrics onto the person — some are wrong matches (Tsai's were cleared manually S213). When Phase 1 lands, AUDIT the already-persisted Scholar/ORCID metrics rather than trusting them. Related: [[project-reviewer-workbench-invite-workflow]] (enrichment must disambiguate by affiliation).
