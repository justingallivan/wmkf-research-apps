---
paths:
  - "docs/**"
---

# Claim Evidence

For descriptive present-state claims in plans and design documents, match the
claim to the query that can test it. A citation or genuine output from an
adjacent query is not enough.

| Claim shape | Minimum verification obligation |
| --- | --- |
| Call path or timing: “runs on every…”, “at save time”, “called from”, “before/after” | Trace callers from an entry point and inspect relevant downstream consumers; reading the definition alone is insufficient. |
| Universal or negative: “all”, “only”, “never”, “no mechanism”, “impossible” | Define the domain and inspect its complement or enumerate the denominator; one matching mechanism is insufficient. |
| Count or coverage: “N sites”, “N of M”, “every route” | Show the enumeration and derive or independently check the denominator. |
| Built/current behavior inferred from a plan, memory, or prior session | Inspect the producing source, persisted-state owner, or live probe; intent documentation is not implementation evidence. |

These obligations do not automatically apply to requirements, hypotheses,
historical quotations, worked examples, or explicitly labeled assumptions.

Keep evidence bounded and redacted. Record the query shape and the minimum
structured result or excerpt needed for review; never retain environment
values, credentials, access tokens, unrelated live records, or unbounded raw
output. Query text and excerpts are reviewable provenance, not semantic or
cryptographic proof.

If the obligation cannot be met, narrow the claim, run the missing query, or
label it `[ASSUMED]`.

An advisory does not itself require an owner question. Resolve it autonomously
when the evidence or narrower wording is discoverable. During the campaign
observation window, report only a bounded advisory tally at session close as
defined in `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`.
