---
name: feedback-apply-reconcile-to-fix-work
description: The reconcile-dont-append + cite-ground-truth rules apply to MY fix work, not just original drafts. When folding review findings, each fix is original work — grep restatements, verify external claims, re-read surrounding paragraph for contradictions BEFORE writing.
metadata:
  type: feedback
---

When folding code-review / Codex findings into a plan or doc, every fix I write is itself original work and produces fresh unverified claims if I don't apply the same verification rules I would to a first-draft.

The recurring failure mode (observed across S196 collapse-plan rounds 1→2→3): each Codex round catches roughly the same number of issues as the prior round, but at a deeper layer. Round 1 fixed the original plan. Round 2 fixed the fixes. Round 3 fixed the fixes-to-the-fixes. The bug class is identical at every layer: plausible-sounding structured text whose individual claims I never verified.

Specific failure patterns in fix-work:

- **Internal contradictions.** I state a new principle ("Dataverse entities FIRST") then write a step list whose step 1 silently violates it. The principle was the thinking; the steps were the editing; I didn't cross-check them.
- **Partial doc fixes.** I sweep where I'm looking (the line I'm editing), not where the references live. The file has two sentences saying the same wrong thing; I fix one, leave the other. The `[[feedback-reconcile-dont-append-docs]]` rule covers this; I keep partially applying it.
- **Unverified claims smuggled by table structure.** I write "X is a CI gate" in a structured table and the table format lends false authority. I never grepped `package.json` to confirm.
- **Wrong premises about adjacent state.** I write "the Postgres tables were dropped" without verifying — memory says they're drain-only. Memory would have told me; I didn't check.

**Why:** S196 collapse-plan work produced 3 Codex rounds (~5-6 findings each), each round finding bugs in the prior round's fixes. The existing memory rules ([[feedback-reconcile-dont-append-docs]], [[feedback-cite-ground-truth]], [[feedback-verify-external-platform-claims]]) cover original drafts; they don't explicitly extend to fix-work, and I was treating fix-work as a lower-rigor activity. It is not. Fix-work has higher stakes — every error gets shipped on top of a partly-correct artifact, building a less-tractable cleanup target.

**How to apply:**

- When folding review findings, every claim I write goes through the same verify-before-writing gate as original work. Specifically:
  - Every claim about external state (entity deployed? CI gate? table dropped?) → probe or grep before writing
  - Every principle I introduce → re-read the steps under it against that principle before saving
  - Every doc edit → grep the file for restatements of the fact I'm changing, AND grep across related docs for cross-references
- Don't write structured tables (or matrices, or ordered lists) as the place to hide unverified claims. The structure adds false confidence.
- If I catch myself thinking "this is just a fix, not a full rewrite" — that's the signal to apply more rigor, not less.
- Before declaring fold-in done: run a grep sweep across the touched files for the key facts I changed. If any restatement contradicts the new version, fix it before claiming done.

Linked: [[feedback-reconcile-dont-append-docs]], [[feedback-cite-ground-truth]], [[feedback-verify-external-platform-claims]], [[feedback-thoroughness-default]].
