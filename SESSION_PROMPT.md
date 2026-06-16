# Session 261 Prompt: Workbench Group A shipped + triage-field plan ready to build

> **GIT.** All S260 work is on `main`. Working tree clean, build/lint/gates green. The triage-field
> **build plan is review-converged (3 Codex rounds) and implementation-ready** — that's the teed-up next
> task. No code written for it yet.

## Session 260 — what happened

Three threads: field-primer expert enrichment, the first two Workbench lifecycle tabs (Group A), and a
long design push that produced a Codex-converged plan for a triage field (which retires the manual D26
allowlist).

1. **Field-primer expert enrichment** (`6f02e90f` → Codex `8fbae0b6` → `e509e8b7`) — confirmed/corrected
   field-primer experts are now clickable to **ORCID + OpenAlex** with **h-index + citations**; profile
   links only, no contact enrichment. Codex review: **dropped Wikipedia** (verified via live API that
   OpenAlex authors don't expose `ids.wikipedia` — it was always null), anchored/checksum-validated the
   URLs, allowlisted expert fields so no stray contact key reaches the persisted envelope. Then
   **parallelized the OpenAlex grounding** (bounded concurrency) — LLM call dominates total latency, but the
   grounding phase is no longer serial.
2. **cycle-material stale-test fix** (`d8edc290`) — the S259 GUID guard made 11 tests 400-before-logic
   (non-GUID fixtures); fixed fixtures + added guard coverage. Was the only stale suite among the 12.
3. **Workbench Group A — Status + Overview v1** (`f47d1f09` → Codex `66f33b8c`) — the first two of the
   (then-8) placeholder lifecycle tabs are LIVE; default landing changed `reviewers → overview`. Status =
   read-only `akoya_requeststatus` + class badge (reuses canonical `classifyStatus`). Overview =
   per-request command center (ctx snapshot + AI-artifact chips + reviewer-stage strip). Codex review:
   chips made clickable, reviewer-shape hardened, gate vacuous-pass closed, and the reviewer-stage strip
   moved to a **new lighter endpoint** `/api/workbench/reviewer-rollup` (extracted `reviewer-rollup.js`
   shared with the dashboard — no person/researcher fan-out). **6 placeholder tabs now remain.**
4. **Remaining-tabs scope** (`c2b05281` → Codex `4ea646a3`) — `REQUEST_WORKBENCH_BUILD_PLAN.md` §"Remaining
   lifecycle tabs — scope (S260)": per-tab re-home/size/dependency, cross-cutting primitives, build order
   (Group A → writeup spine → Reviews → Site Visit/Awardee). Reconciled the "9→8→6 placeholder" count
   across docs/memory/page comments.
5. **Triage-field build plan** (`4dad7885` v2 → `673f8b08` v3 → `df08bb0b` v4) —
   `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md`. **3 Codex rounds, converged.** A new `wmkf_triagestatus`
   picklist on `akoya_request` (Advancing/Set aside/null) replaces the manual `d26Allowlist.js`:
   declutters the dashboard + surfaces going-forward without a status flip. Architecture stable since v2;
   rounds 2–3 were precision. v4's fixes were **Codex-authored, Claude-reviewed** (verified every cited
   helper/precedent is real).

## Potential Next Steps

### 1. **Build the triage field (TEED UP — plan is implementation-ready).** `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md`
Staged rollout (§5): metadata probe → field deploy (isolated schema wave) → backfill (dry-run first) →
dashboard switch → **retire the allowlist last** after a verified backfill. Start with the no-prod-write,
reviewable pieces: `shared/config/triageStatus.js`, the metadata-probe preflight, the schema wave JSON, the
`backfill-d26-triage.mjs` script in dry-run, the `POST /api/workbench/triage` route (HARD server gate),
dashboard query. **Prod schema apply + backfill `--execute` are Justin's triggers** (core-entity field —
heads-up to Connor; verify NO PowerAutomate trigger). Two `[DEFAULT — confirm at impl]` items: backfill
abort bounds + the cycle-default algorithm.

### 2. **Reviewer Finder / Review Manager retirement (IN PROGRESS — verify before acting).**
Justin has **hidden both apps in the admin panel** (S260). NOT yet done, and order matters: the
`/api/reviewer-finder/*` + `/api/review-manager/*` **API routes are load-bearing for the Workbench** (it
calls ~15 of them) — do NOT delete the routes. Remaining: (a) verify every legacy-grant holder has the
`reviewers` grant (live `wmkf_appuserappaccesses` check — can't see from code), (b) delete the standalone
*pages* (`pages/reviewer-finder.js`, `review-manager.js`), (c) retire the `reviewer-finder`/`review-manager`
grant keys from `appRegistry.js`. The manual-PDF-upload off-cycle path goes away (Justin: no more PD uploads).

### 3. **Group B — writeup spine.** Initial / Pre-Site-Visit / Final Writeup re-home the flat upload-based
`phase-i-writeup.js` / `phase-ii-writeup.js` — each needs a request-preload adapter; needs the
embed-vs-in-app + writeup-collaborator-access decisions (open). `Final` needs Site-Visit findings as input.

## Design context to carry (D26 document model — Justin, S260)

- **D26 active-document switch:** a request runs on the **Phase I proposal** early; after reviewers are
  confirmed, the **Phase II proposal arrives** (`akoya_requeststatus = 'Phase II Pending'` = "doc arrived")
  and becomes the active doc — what's sent to reviewers + the **Pre-Site-Visit Writeup** source. Lives in
  Dataverse, **consistent naming TBD**. This is a **D26 patch to UNPATCH for J27** (single submission → one
  Phase I doc throughout). The active-document-switch design is **not yet written**.
- **Four distinct lifecycle signals** (don't conflate): Triage (staff, visibility) · Invited
  (`wmkf_phaseistatus`, board → "expect Phase II proposal") · Phase II Pending (doc arrived) · J27 phase
  trigger (official advance, replaces the allowlist concept). The triage field is the seed of the J27
  triage lens; J27 expands states + adds the PD-recommendation/authoritative two-layer split.

## Continuity guardrails (still live)
- **Triage field touches the CORE `akoya_request` entity** — prod schema change (feasible via isolated wave,
  field-primer precedent), heads-up to Connor, **must carry no PA trigger**. Dashboard null-query trap:
  use `(wmkf_triagestatus eq null or ne 100000001)` (mirror `notExcludedFilter`); bare `ne` drops nulls.
- **`/api/workbench/reviewer-rollup`** is the lighter per-request reviewer-stage path (shared
  `lib/services/reviewer-rollup.js`); the dashboard rollup + `deriveWorkRemaining` now live there (the
  `status-enum-parity` gate reads `deriveWorkRemaining` from `reviewer-rollup.js`, not `dashboard.js`).
- **Field primer is staff orientation only**, never a reviewer-candidate/contact source. Wikipedia was
  dropped (OpenAlex authors don't expose it). Profile-link display helpers: `shared/utils/field-primer-display.js`.
- **`d26Allowlist.js` is the complete multi-PD going-forward set** (colleagues' proposals already promoted) —
  the triage backfill's `Advancing` source. The test request `1002788` is excluded (→ Set aside).

## Key Files Reference (S260)

| File | Role |
|------|------|
| `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md` | v4 triage-field plan (3 Codex rounds) — the next build |
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | §"Remaining lifecycle tabs — scope (S260)" — the 6 remaining tabs |
| `shared/components/workbench/StatusTab.js` / `OverviewTab.js` | Group A tabs (live) |
| `lib/services/reviewer-rollup.js` | shared reviewer rollup + `deriveWorkRemaining` + `WORK_REMAINING_LABEL` |
| `pages/api/workbench/reviewer-rollup.js` | lighter per-request rollup endpoint |
| `lib/services/field-primer-service.js` / `shared/utils/field-primer-display.js` | grounding (parallel) + profile links |

## Testing
```bash
npm run build && npm run lint
npm test
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:trust-boundary-guid && npm run check:api-routes && npm run check:fact-consistency
```
