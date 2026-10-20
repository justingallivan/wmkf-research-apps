---
name: project-research-special-grants-in-cohorts
description: Research award searches must decide deliberately whether to keep non-Program grants (Special Grants/Projects, incl. the UCLA Keck Court Biomedical Initiative individual-investigator awards); a wmkf_type = Program filter silently drops them
metadata:
  node_type: memory
  type: project
  status: active
  scope: repo
  last_verified: 2026-10-20 via owner-authorized production reads (Session 622)
---

## Recall Rule

Read this when: querying, exporting, counting or analyzing Research (Medical
Research / Science & Engineering) awards, PIs, co-PIs or reviewers, or writing
any filter on `akoya_request._wmkf_type_value`.

Owner, 2026-10-20: "We should note for our future work how these special grants
fit in because many of our searches will likely exclude them."

Facts and counts live in `docs/atlas/dataverse-akoya-request.md` → "Open
questions / gotchas" (first bullet). In short: of 238 awarded Research-program
requests with meeting dates from 2017, 30 are not `wmkf_type = Program`; 24 of
those have a PI, and 19 are UCLA Keck Court Biomedical Initiative grants that
behave like individual-investigator research awards.

**Why:** a `wmkf_type = Program` filter is right for program-process totals
(the export's Option B), but it removes real PIs from investigator-level work.
A program + status filter keeps them, but it also pulls in institutional grants
with no PI.

**How to apply:** state which scope a search uses, and say so in its output.
For PI, co-PI, ORCID or institution work, keep the special grants (owner
decision 2026-10-20: PI and co-PI backfills include them). For program
statistics, filter to Program and report the special grants separately. Do
not drop them silently.
