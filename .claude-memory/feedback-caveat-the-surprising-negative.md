---
name: feedback-caveat-the-surprising-negative
description: "When a non-expert reporter returns a surprising negative ('there is no X'), record it with an explicit confirm-before-relying caveat instead of as fact — the caveat is what stops a false durability claim, and twice now the negative has been wrong"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5d701c2f-2afe-4dd1-b466-cd58a7d12d81
  status: active
  scope: global
  last_verified: 2026-08-13 via the S425 SharePoint second-stage recycle-bin reversal
---

## Recall Rule

Read this when: recording a **negative** answer ("there is no second-stage bin", "that field doesn't exist", "no policy applies", "the endpoint isn't there") that came from a human reporter rather than a probe — especially when the negative would *simplify* the design or *justify* extra defensive work.

Do:
- Ask whether the platform's **default** is the opposite. If it is, the reply is more likely about the reporter's access than about the system.
- Write the caveat into the durable doc as an instruction, not a hedge: "Do not record X as fact until <specific role> confirms it."
- Name **who** could answer and **what** would count, so the follow-up is one question rather than another round-trip.
- Distinguish "I could not see it" from "it is not there" in the recorded wording, every time.

Do not:
- Let a negative from a willing but non-expert reporter close a question, however cooperative they were.
- Build a durability or safety argument on an unconfirmed absence — an absence is the one claim a non-expert most easily reports wrongly.

Ground truth: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` (the controlled target-library audit section preserves both rounds and the reversal). Related: [[feedback-verify-external-platform-claims]], [[feedback-cite-ground-truth]], [[feedback-vacuous-clean-results-print-the-denominator]].

A surprising negative from a non-expert reporter is a **hypothesis about the system that is also a fact about the reporter's access**. Record it with an explicit confirm-before-relying caveat and route it to someone whose rights could actually see the thing.

**Why:** S413 (2026-08-10) asked the SharePoint site owner four durability questions. Two answers were recorded with caveats rather than as fact, and both turned out to be wrong when S425 (2026-08-13) escalated to an administrator with the rights to look:

- *"No second-stage recycle bin."* One exists. SharePoint Online provisions a site-collection recycle bin **by default**, so a tenant with none would have been unusual — that default was the tell. The reporter was not a site collection administrator, and the bin is invisible by design to anyone who isn't. The recorded caveat ("Do not record 'no second-stage recovery exists' as platform fact until someone with site-collection administrator rights confirms it") is the only reason a false durability claim never entered the record.
- *"Site members have 'limited control'."* That was a caption in the modern permissions pane, not a permission level. The group actually held `Edit`. Recorded as "not a standard level — either a paraphrase or a custom level" rather than resolved, which kept the real question open until it could be answered properly.

Had either been written as fact, the milestone snapshot design would have rested on a load-bearing falsehood — and in the second-stage case, on a false *pessimism* that would have been just as wrong as false comfort.

**How to apply:**
- **The platform-default test.** Before recording any negative, ask: is the thing being denied present by default? If yes, weight the reply toward an access limitation and say so in the text. This is the cheapest available discriminator and it caught the S413 case.
- **Write the caveat as an instruction to the next reader**, with the role that could settle it: "Do not record X until <site collection admin / compliance admin / DBA> confirms." A hedge like "possibly" degrades into fact on the next re-read; a named blocking condition does not.
- **Preserve the reporter's exact words** and label them as a first round. When the reversal arrives, the verbatim quote plus a "supersedes on every point it touches" header is more useful than a silent rewrite — it shows future readers that the caveat mechanism works, which is what makes them keep using it.
- **Negatives that reduce your workload deserve the most scrutiny**, not the least. "No policy applies" and "that doesn't exist" both end investigations; a wrong one ends it early and invisibly.
- Related asymmetry: a *positive* misreport usually surfaces when someone tries to use the thing. A *negative* misreport never surfaces at all, because nobody looks again.
