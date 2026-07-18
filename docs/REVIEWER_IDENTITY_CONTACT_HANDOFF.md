---
title: Reviewer Identity & Contact — Codex Build Handoff
domain: reviewer-identity
kind: runbook
status: active
summary: "Paste-ready continuation handoff: W0 is implemented and inert; W1 affiliation/COI remains the first behavioral build, with W2-W4 gated."
canonical: false
cataloged: 2026-07-18
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
---

# Reviewer Identity & Contact — Codex Build Handoff

This is the fixed entry point for handing the
[Reviewer Identity & Contact plan](REVIEWER_IDENTITY_CONTACT_PLAN.md) to Codex.
W0, the institution-identity substrate, is implemented and deliberately inert:
no production path calls it. This handoff now scopes the first behavioral build
to **W1 affiliation/COI correctness**. W1 fixes a live false-drop bug and is
independent of the disambiguation rebuild. W2–W4 stay behind their open owner
gates and are out of scope here.

## How to use

- Paste the fenced prompt below into Codex. Invoke Codex with `--model gpt-5.5`.
- The plan and audit are committed history, so a Codex worktree will see them.
- Reuse and verify the implemented W0 substrate; keep build scope to W1 and do
  not start W2/W3/W4 (open owner decisions).
- For the later disambiguation workstream (W2), the frozen 40-case identity
  benchmark is NOT on this branch — retrieve it with
  `git show codex/m1-evaluation-foundation:docs/audits/reviewer-holistic-identity-benchmark-v2.json`.

## Paste-ready handoff prompt

```
TASK: Build W1 of the Reviewer Identity & Contact plan (affiliation/COI correctness),
reusing the implemented, inert W0 substrate.
Do NOT start W2, W3, or W4 — they have open owner decisions and are out of scope for this build.

READ FIRST (committed on branch claude/review-reviewer-email-evidence):
- docs/REVIEWER_IDENTITY_CONTACT_PLAN.md .......... the roadmap; W0 and W1 are your spec
- docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
      ................................................ evidence/rationale; read section 5b closely
- docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md ... the fail-closed COI contract you must not weaken
- CLAUDE.md ........................................ operating rules (probe-before-planning, red gates,
      campaign release); source wins over any doc claim — probe, don't trust prose.

BUILD SCOPE:
- W0  ALREADY IMPLEMENTED at lib/services/institution-identity-resolver.js, with OpenAlex
      institution country/associated-institution mapping in lib/services/openalex-service.js.
      Verify its tests and preserve its inert, null-on-ambiguity contract; do not rebuild it.
- W1.1 institutionsMatchForCOI: resolve both sides via W0 and compare OpenAlex/ROR ids FIRST;
      keep the existing name/abbreviation/campus fallback for unresolved cases.
- W1.2 COI exemption overlay (an id set): a SHARED umbrella/affiliated institute alone is not COI.
      Implement HHMI (I1344073410) firmly. Wire Broad (I107606265) through the same mechanism but
      SURFACE the policy question to the owner — always-exempt vs only-when-primary-campuses-differ —
      do NOT guess. Exemption is scoped to the institute id; a shared PARENT university still counts.
- W1.3 Remove 'janelia' from the 'hhmi' alias entry (lib/services/discovery/match-signals.js:158) so
      the employer and the physical Janelia campus stop being conflated (Janelia-vs-Janelia stays valid).
- W1.4 associated_institutions CONSISTENCY (mismatch alert + resolver corroboration only): two
      institutions are consistent if they share an id OR one is in the other's associated_institutions.
      Apply to lib/services/alert-reviewer-affiliation-mismatch.js (stop false Broad/MIT, Dana-Farber/
      Harvard alerts) and to the resolver's institution-corroboration.
- W1.5 Hospital firewall: explicit invariant + tests that W1.4 never widens COI.

HARD INVARIANTS (do not violate):
1. The COI hard-drop set may only STAY or NARROW. associated_institutions must NEVER widen it — Harvard
   has ~40 related institutions, so a transitive/parent match would false-drop the Boston biomedical
   world. This is the #1 thing to get right. Different hospitals (Dana-Farber != MGH) must NOT match;
   a shared parent ecosystem is at most a soft surfaced signal, never a hard drop.
2. Match in ID space; fail-open on unresolved institutions.
3. Preserve every existing enforcement contract (fail-closed save-time COI, abstain-is-safe). Do not
   re-gate COI more aggressively — this workstream only NARROWS false drops.

METHOD: This is safety-critical matching code. Do an author-adversarial pass on your own COI matcher
FIRST (can any associated_institutions path widen a drop? can two different Harvard hospitals match?
can an exemption leak to a shared parent university?), then treat it as reviewable.

DEFINITION OF DONE:
- COI test matrix green: HHMI/HHMI (exempt), HHMI/host-university (real, via parent), Broad/Broad
  (per owner policy), Dana-Farber/MGH (no drop), Dana-Farber/Harvard (soft only), IAS/Princeton
  (no match — note there are two IAS records, US and DE), same-hospital (drop). Plus an
  affiliation-mismatch matrix covering institute/hospital cases.
- Relevant red gates + self-tests, run sequentially and green: check:route-service-boundary, and
  check:dataverse-access-layer if the save-time COI path is touched.
- /contract-reconcile before proposing promotion (COI is a fail-closed gate).
- Work on a branch; COI is Tier 1+ runtime -> branch + deliberate promotion per the campaign-release
  strategy, NOT a direct-to-main change.
- Surface the two W1 owner decisions (Broad exemption strength; umbrella-org set beyond HHMI/Broad)
  rather than assuming them.
```
