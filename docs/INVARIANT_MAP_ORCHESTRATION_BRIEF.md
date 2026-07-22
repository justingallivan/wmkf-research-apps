---
title: Closeable-Class Invariant Map — Fable Orchestration Brief
domain: architecture
kind: plan
status: historical
summary: Historical orchestration brief that produced the Closeable-Class Invariant Map.
---

# Closeable-Class Invariant Map — Fable Orchestration Brief

> **Current routing:** Historical orchestration brief. Its deliverable is `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md`; do not execute this brief's dated queue without a fresh current-state audit.

> Audience: a superior orchestrator model (Fable) for one high-value session. This brief scopes the work;
> the **owner's charter, given at session start, governs** — where they conflict, the charter wins, and this
> brief bends to it. Written 2026-07-06 by Claude (Opus 4.8) after landing the reviewer-finder COI arc, whose
> repeated whack-a-mole review cycles are the worked example below.

## 0. Operating model — you orchestrate, subagents execute

You are the **strategic direction**; the reading, tracing, and drafting fan out to **subagents**. Do not do all
the analysis in your own context — decompose, dispatch, verify, synthesize. Concretely:

- Run `/start` first (sync `main`, run the full gate suite, load `SESSION_PROMPT.md` + `CLAUDE.md` + the memory
  router). A red gate is a P0 and may itself be a class on the map.
- `main` **auto-deploys to prod.** Keep all work on branches; a merge is the owner's deliberate deploy — never
  merge or push to `main` without an explicit owner go-ahead.
- Your value is judgment a gate or an incremental review cannot produce: holding the whole system at once,
  finding the *classes*, and distinguishing "closeable by construction" from "must stay defended." Spend the
  session on that, not on rote work a subagent can do.

## 1. Primary objective — the Closeable-Class Invariant Map

Produce one durable, evidence-backed report (a tracked doc, e.g. `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md`) that a
**future session can implement without you**. For every security- and correctness-critical surface, classify
its current enforcement on this ladder and name the smallest structural change that would move it *up a rung*
— ideally to rung 1 — ranked by blast radius.

**The enforcement ladder (highest → lowest):**
1. **Impossible by construction** — the bug literally cannot be expressed (the declaration is a total function
   of the right input; the type/shape forbids the mistake).
2. **Fail-closed law/gate** — a violation blocks commit/CI (LAW-mode `check:*` gates, fail-closed runtime
   asserts).
3. **Advisory/detect gate** — flagged but non-blocking (drift gates in `:no-write` mode, warnings).
4. **Review / tests only** — caught only when a human or agent looks.

**The thesis to test (don't assume — prove or refute it):** most of this project's considerable hardening sits
at rungs 2–4, which is *why* the work proceeds bug-by-bug, review-cycle-by-review-cycle. The high-leverage
finding is the set of rung-1 upgrades. The project already reasons about this spectrum — see the
`feedback-enforcement-hierarchy` memory — but there is no whole-system map of where each class sits and which
can be lifted.

## 2. Worked example — what "closing a class" looks like (calibrate on this)

The save-time institution-COI gate (`lib/services/reviewer-finder/save-candidates-service.js` +
`lib/services/reviewer-identity-lookup.js`) went through repeated adversarial-review cycles this session. Every
cycle found a *real* bug; every fix was correct; the next cycle found another — same class ("the server can
discover a candidate is at the applicant/PI institution but writes it unscreened"), different branch.

Root cause (found only by stepping back to structure): the "referenced identities" declaration was computed
**inside the outcome constructors**, i.e. from the shape the *linking* decision returned — so any of the
lookup's early returns could silently drop a discovery. And the invariant test asserted declared-ids ==
ids-found-**inside-the-returned-outcome** (output vs output), so it was constitutionally **blind to a dropped
discovery**. Every cycle was the same theorem.

The fix (`4070728`): a *discovery recorder* made the declaration a **total function of every adapter row
fetched**, stamped at one exit; the invariant test was inverted to assert declarations against the mocked
adapter **inputs**. One structural move closed the class *and* the latent bugs a fresh reviewer found in the
same pass. **That is the template:** find the surface where the invariant is checked against the wrong thing,
and make the correct-by-construction version cheap. Use this as the quality bar for every "closeable" claim.

## 3. Surfaces to examine (candidate boards — not exhaustive; add what you find)

Treat the `check:*` gate list (`grep '"check:' package.json`) as a **census of current rung-2/3 enforcement** —
each gate marks a class someone already decided to defend. For each surface: name the class as a one-line
failure statement, cite where it lives and its guard, place it on the ladder with `file:line` evidence, and
answer "can this be lifted to rung 1, and how?" Every characterization below is a **starting hypothesis to
verify against source**, not an established fact.

- **Save-time institution COI** — *reportedly CLOSED to rung 1 this session*; the exemplar. Verify it genuinely
  holds end-to-end (it just shipped to prod), then use its shape as the pattern.
- **DAL entity-write enforcement** — `assertTrustedDalContext`; the DynamicsService Dataverse-fetch guard
  keystone; `client.js` tail-coverage; `DATAVERSE_DAL_ENFORCEMENT`; `check:dataverse-access-layer` (LAW). Class:
  an entity write reaches Dataverse outside a trusted post-auth context. (The Q9 prefs/app-access migration just
  landed — re-sync its real state before trusting any prior description.)
- **Restriction-context boundary** — `bypassDynamicsRestrictions` import boundary;
  `check:dynamics-context-boundary` (LAW). Class: Dataverse access without an established restriction context,
  or a bypass wrapper used outside sanctioned paths.
- **Prompt-injection / A7** — `wrapUntrustedContent`, `buildUntrustedContentPreamble`,
  `check:prompt-injection-tagging`. Class: untrusted LLM/proposal-derived content reaches a prompt outside the
  sentinels. (The reviewer-finder top-up bug this session was a live instance — a *new* call site the
  marker-gate did not yet know about. Ask: does the gate close the class, or only known surfaces?)
- **Trust-boundary GUID** — `check:trust-boundary-guid`. Class: a client-supplied id reaches a
  Dataverse/SharePoint selector unvalidated.
- **Identity provenance** — the "never accept profile identity from request input when authenticated context
  supplies it" invariant. Class: identity spoof via request body.
- **Model-override warming** — `check:model-override-warming`. Class: a route resolves an LLM model before
  `loadModelOverrides()`.
- **Partial-batch / durable-state consistency** — the `/contract-reconcile` surface (partial success, stale
  async state, idempotency, lost updates across concurrent writers).
- **Doc/memory truth vs. live code** — the drift gates (`check:doc-symbol-refs`, `build-claim-freshness`,
  `fact-consistency`, `atlas`, `canonical-pointers`, …). Class: a durable surface asserts something false about
  live code. (Likely inherently rung 2/3 — but say so with evidence, and note any part that *could* be rung 1.)

## 4. Report shape (one entry per class)

For each: **failure statement** (one line) · **location + guard** (`file:line`) · **current rung (1–4) with
evidence** · **closeable to rung 1? the smallest concrete structural change** (recorder-grade specificity) *or*
why it must stay defended · **blast radius** (sites/surfaces affected, prod exposure) · **effort / risk /
dependencies** · **priority**. Then: the **ranked queue** of upgrade moves, and a **recommended first target
with an implementation sketch** a future session can execute directly. The report is the deliverable; make it
stand alone.

## 5. How to produce it (orchestration)

1. **Fan out** — one subagent per surface in §3, each returning an evidence-grounded per-surface analysis
   (`file:line` for every claim), in parallel.
2. **Adversarial pass** — for every "closeable" claim, a skeptic subagent tries to find an input the proposed
   structural change does *not* close. (The COI class taught us the first structural fix can still leak; a
   claim survives only if a skeptic cannot refute it.)
3. **Synthesize** — you dedupe, rank by blast radius, write the strategic narrative + the first-target sketch.
4. **Completeness critic** — a final subagent asks "which surface/class did we miss?" What it finds is the next
   fan-out, not a footnote.

## 6. Evidence discipline (non-negotiable in this repo)

- Every material claim about how code behaves is `[VERIFIED via <file:line>]`, read or grepped — never asserted
  from memory or inference. This repo **hard-fails on fabricated identifiers/values** (there are gates for it).
- Falsify, don't confirm: for each "closed by construction" claim, run the **disconfirming** query (find the
  complement / a counter-instance), not just a confirming one.
- Ground against the truth apparatus: `docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/` for data
  ownership/read/write paths; the memory router `.claude-memory/MEMORY.md`; source headers +
  `docs/SERVICE_AND_UTILITY_CATALOG.md`. Where memory/docs conflict with code or a live probe, the live source
  wins and the stale surface is marked.

## 7. Execution queue after the map (owner's priority order — let the map's ranking override)

Once the map is delivered and (in a future session) implemented, execute these in order — but if the map's
blast-radius ranking disagrees, follow the map:

1. **Project-wide prompt-caching audit + root remediation — COMPLETED (S340/S341).** The July audit and
   keyed stable-nonce remediation are recorded in `docs/PROMPT_CACHING_AUDIT.md`; the earlier claim that only
   two call sites had markers was a pre-audit snapshot. Remaining work is narrower: optional R4
   cross-document Executor composition and conditional R5 measurement, tracked in
   `.claude-memory/project-cache-hit-rate-review.md`.
2. **Holistic prod-safety review of everything that shipped to `main` today.** Three security/correctness-
   critical things landed in hours and only had incremental/diff review: the reviewer-finder COI enforcement
   (ours), the **Q9 prefs/app-access DAL migration** (PR #49 — auth hot path, `grantDefaultApps` on sign-in),
   and **DynamicsService Checkpoint A**. Adversarially validate them end-to-end while a superior model is
   available.
3. **DynamicsService decomposition — Checkpoint B (read path).** Unblocked by Checkpoint A. B carries the
   token/schema cache seam — the trickiest checkpoint. Design that extraction; hand the rote behavior-freeze to
   subagents. Plan: `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md`.

Deferred / not orchestrator-shaped: DAL Stage 9 enforcement (re-sync status post-Q9 before scoping); the
product/UX asks (review-output formatting, campaign-settings UX).

## 8. Guardrails

- `main` auto-deploys — keep work on branches; the merge is the owner's deliberate deploy.
- Use the machinery: `/start`, the full `check:*` suite, `/contract-reconcile` for cross-layer / durable-state /
  partial-success work, `/sweep` for fact reconciliation, `/stop` to write the handoff.
- **Don't self-certify convergence** — the COI whack-a-mole is the cautionary tale. "Done" is proven by a clean
  adversarial pass, not asserted; re-review every fix, including your own subagents'.
- Timebox meta-work. The objective is the map and then the queue — not process about the process.
