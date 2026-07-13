---
title: Reviewer Identity Binding Production Preflight — 2026-07-13
domain: reviewer-identity
kind: audit
status: historical
summary: "Dated read-only Wave 13 production metadata and population snapshot: ten exact fields, no divergence, and zero populated rows."
canonical: false
cataloged: 2026-07-13
owner: product-engineering
related:
  - scripts/preflight-reviewer-identity-binding-fields.mjs
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
---

# Reviewer Identity Binding Production Preflight — 2026-07-13

This is a dated snapshot, not a permanent assertion about current Dataverse
state. Refresh it before schema-adjacent work with:

```bash
node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-population --include-timestamp-samples
```

Observed 2026-07-13:

```text
Reviewer identity-binding Wave 13 preflight (target=prod):
  EXACT     wmkf_potentialreviewers.wmkf_identitybindingversion
  EXACT     wmkf_potentialreviewers.wmkf_identitybindingsource
  EXACT     wmkf_potentialreviewers.wmkf_identitybindinganchor
  EXACT     wmkf_potentialreviewers.wmkf_identityboundat
  EXACT     wmkf_potentialreviewers.wmkf_identityderivedbindingversion
  EXACT     wmkf_potentialreviewers.wmkf_identityfieldlineagejson
  EXACT     wmkf_appreviewersuggestion.wmkf_identitycoistatus
  EXACT     wmkf_appreviewersuggestion.wmkf_identitycoibindingversion
  EXACT     wmkf_appreviewersuggestion.wmkf_identitycoicontexthash
  EXACT     wmkf_appreviewersuggestion.wmkf_identitycoicheckedat
Summary: 0 absent, 10 exact, 0 divergent.
Wave 13 population snapshot (target=prod):
  wmkf_potentialreviewers: 0 row(s) with any Wave 13 field non-null.
  wmkf_appreviewersuggestion: 0 row(s) with any Wave 13 field non-null.
Persisted wmkf_identityresolvedat samples (raw Dataverse JSON):
  2026-06-19T01:00:28Z
  2026-06-03T22:37:14Z
  2026-06-03T22:37:15Z
  2026-06-03T22:37:18Z
  2026-06-03T22:37:19Z
```

The command is read-only. It derives expected metadata and population fields
from the two tracked Wave 13 schema specifications. A later result supersedes
this snapshot; it must not be treated as proof that production remains
unchanged.

The timestamp sample confirms that production Dataverse returns the existing
resolver timestamp without a fractional component. The binding writer now
normalizes that strict second-precision representation to millisecond form
before replay/order comparisons.
