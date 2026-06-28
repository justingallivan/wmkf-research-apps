# Reviewer-Finder Origination — Review Request (for a fresh model)

> **⚠ HISTORICAL one-shot (S239, 2026-06-10).** A single-use prompt that handed a fresh reviewing
> model the S239 origination probe findings. That review has since happened and its conclusions are
> folded into the origination docs (`REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md`,
> `REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`,
> `REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md`). Kept as a record of the review framing —
> NOT a live request.

**Use:** Run `/start` in the reviewing session first (it loads project context, operating rules, and the memory router), then hand it the prompt below. Today's S239 work is not yet in `SESSION_PROMPT.md`, so the reviewer is pointed explicitly at the findings doc.

---

You've just run `/start`, so you have the project context, operating rules, and memory router. Today's work isn't in `SESSION_PROMPT.md` yet, so start here:

- `docs/archive/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md`

It reports a live probe (run today, S239) testing whether reviewer-finder's candidate **origination** is the broken layer. It links the rescue dossier and the retrieval redesign plan.

**Important stance:** the memory router, `SESSION_PROMPT`, and this findings doc all assert OUR conclusions. Per the repo's own `falsify-not-confirm` rule, treat them as **hypotheses to test, not settled truth** — including the probe's verdict. I want a genuine adversarial read, not a rubber-stamp.

**Your job, in order:**

**A. Challenge the verdict first.** Is "origination is the diseased layer; fix it by asking a scholarly source a person-level question" actually right, or are we over-reading three runs? Try to falsify it; check the probe's methodology (`scripts/probe-grounded-origination.mjs`; re-runnable read-only on 1002794 / 1002959 / 1003020). Name anything overstated.

**B. Only if it holds, draft the smallest correct implementation plan** for the findings doc's "Open design questions" (facet generation, ranking/spread, DOI-less citation resolution, what stays vs. demoted). Honor the memory guidance to **reuse the existing identity resolver + ranker** and the `recall-over-precision` / `verify-fail-dangerous` hazards — don't rebuild or re-propose abandoned approaches (see the dossier's failed-strategy list).

**Constraints:** design review only — don't build or edit yet. Bring critique (and plan, if warranted) back before any code. Flag confidence and anything unverified.

---

## Reading order (all on `main`)

1. `docs/archive/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md` — **start here** (S239 probe verdict + evidence).
2. `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md` — problem statement + every abandoned strategy.
3. `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` — canonical design (§2.3 OpenAlex-metrics claim corrected S239; §4/§5 coverage-ground-truth claim still stands; **§8f** = the activity-signal flaw).
4. `scripts/probe-grounded-origination.mjs` — the probe (read-only; re-runnable).
