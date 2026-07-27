---
name: project-openalex-merge-use-orcid-works
description: "OpenAlex MERGES same-name authors, so a common-name ORCID can resolve to a contaminated author cluster (wrong corpus). For a person's works, use the ORCID record's OWN self-asserted works list (pub.orcid.org/<id>/works) → resolve DOIs to OpenAlex, NOT the OpenAlex author.id cluster. Reference/hazard for any OpenAlex work."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-10 via live probe (Wen Li 0000-0002-3721-4008)
---

## Recall Rule
Read before relying on an OpenAlex AUTHOR record's works or metrics for a named person — especially common names, especially to build "this person's corpus."

## The hazard (verified)
[VERIFIED via the 2026-06-10 read-only ORCID/OpenAlex probe retained in S239.]
ORCID gives EXACT identity, but OpenAlex's author record for that ORCID can be a MERGE of multiple same-name people. S239: PI Wen Li's correct ORCID (`0000-0002-3721-4008`, Wayne State attosecond physicist) resolved in OpenAlex to author `A5060668110` = a Yantai University ORGANIC-CHEMISTRY cluster, 311 works, none his. This is OpenAlex name-clustering noise in the MERGE direction; the Frebel case was the SPLIT direction (a stub record `works_count` 6 vs the canonical 323). Both are name-search artifacts — NOT a reason to distrust OpenAlex wholesale (the redesign-plan §2.3 "OpenAlex disqualified" claim was CORRECTED S239; OpenAlex is fine as a recall/seed source).

## The fix
Take the person's corpus from the **ORCID record's own self-asserted works list** (`GET https://pub.orcid.org/v3.0/<id>/works`, `Accept: application/json`) — PI-curated, no merge. Then resolve each work's DOI to OpenAlex (`/works?filter=doi:<doi>`) for references / co-authors / aggregation. Verified: Wen Li's ORCID works = clean attosecond physics → downstream surfaced Keller / Corkum / Krausz.

## Tradeoffs (don't overclaim)
ORCID works lists are DOI-filtered (no-DOI works dropped), recency-filterable, and USER-CURATED (can be incomplete, stale, or padded). Fallback when ORCID is absent or yields zero recent DOI-bearing works: go INERT — do NOT fall back to the merge-prone OpenAlex author cluster. Cheap contamination flags: PI email-domain vs OpenAlex last-known-institution, and corpus-titles vs proposal-topic.

Consumed by [[project-reviewer-pi-identity-structured]] and [[project-reviewer-origination-multilane]].
