---
title: "Strategy Wiki Research History Compression Audit"
domain: "docs-governance"
kind: "bounded-audit"
status: "documentation-reconciliation"
summary: "Records the byte-preserving move of reviewer-matching research history out of the active strategy wiki and its routing checks."
last_verified: 2026-10-22
owner: "product-strategy"
---

# Strategy Wiki Compression Audit — 2026-10-22

## Scope and status

This bounded pass moved only the body beneath
`### Dated reviewer-matching research and decision history` in
`docs/agent-wiki/topics/strategy-roadmap.md`, ending immediately before
`### Dated implementation and owner-decision history`. The original heading and
anchor remain in the wiki as a routing point. The later implementation and
owner-decision section remains in place. Its historical framing preamble was
adjusted to reflect the move.

**Parent review complete for this bounded extraction.** This is not a whole-wiki or repo-wide
truth refresh. The wiki frontmatter `source_files` list was not changed, and no
source contracts were refreshed in this pass.

## Byte-preservation proof

The extracted body was captured before editing, then written unchanged between
the archive's `BEGIN VERBATIM EXTRACTED BODY` and `END VERBATIM EXTRACTED BODY`
markers. A post-write byte comparison and SHA-256 check matched the captured
body and the archive metadata:

| Measure | Result |
|---|---:|
| Wiki before extraction | 45,464 bytes |
| Extracted body | 13,302 bytes |
| Extracted-body SHA-256, before and after | `07cf6ee93a16e09abe6eec0f1060cbfae0b5cee7f8992b0c9871747bcaa0de69` |
| Wiki after extraction and routing edit | 33,339 bytes |
| Historical archive, including routing banner and metadata | 14,536 bytes |

The unchanged body preserves the benchmark figures, corrected and withdrawn
conclusions, owner decisions, implementation state, and dated evidence as
written. The target heading and the immediately following implementation-history
heading both remain in the wiki. The extracted content is visibly marked
historical in [the archive](../archive/REVIEWER_INSTITUTION_RESEARCH_HISTORY_2026-10-22.md).

## Routing and remaining size

The retained current-direction section now has five bullets. The reviewer
identity/origination bullet routes lane posture to
`docs/agent-wiki/topics/reviewer-origination.md`, identity and save boundaries
to `docs/agent-wiki/topics/reviewer-identity.md` and
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`, and sequencing to the canonical
queue and ROR strategic-reset brief. A targeted reference search confirmed the
retained heading, archive pointer, and those current hubs. The identity hub and
strategic-reset brief retain the recorded Production authority as
`legacy-default`; no live configuration was probed in this pass. The current wiki
does not turn historical ROR or S2AFF results into promotion
authority or queue commitments.

This selected body was 13,302 bytes, so the wiki now measures 33,339 bytes,
above the approximate 25 KB target. The remaining dated implementation and
owner-decision chronology was left intact as instructed; further compression
would require a separately scoped preservation pass.

## Verification boundary

The archive payload was byte-compared with the captured pre-edit body and its
hash was independently checked after writing. Targeted routing/reference searches
were run. The editing agent ran no gates or live probes. The parent independently compared the archive body against the committed pre-edit wiki, confirmed the 13,302-byte SHA-256 match above, and verified the later implementation-history body is unchanged. Repository documentation checks are recorded in the companion audit index.
