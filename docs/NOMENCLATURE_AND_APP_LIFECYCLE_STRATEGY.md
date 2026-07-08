---
title: "Nomenclature & App-Lifecycle Cleanup — Strategy"
domain: architecture
kind: source-of-truth
status: canonical
summary: "History left three *different* kinds of legacy naming, and they look alike until you trace callers:."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/config/appRegistry.js
  - lib/services/
  - "pages/workbench/[requestId].js"
  - shared/components/Layout.js
---

# Nomenclature & App-Lifecycle Cleanup — Strategy

Status: **STRATEGY / PLAN — all phases EXECUTED S291–S292 (see inline `DONE` markers).**
Commit 1 (lifecycle exports + glossary), the enforcement gates, and Phase 1 / Commit 2
(archive of the `phase-ii-writeup-legacy` surface) shipped S291; Phase 2 (rename) shipped
S291; Phase 3 (document borrowed namespaces) confirmed and Phase 4 (fact-level `/sweep`)
executed S292. Re-confirm live state before relying on any specific file:line citation.
Codex adversarial review (S290) folded: added the live-cross-cutting bucket, reclassified
`phase-ii-writeup-legacy` as a sunset-candidate (not orphan), added ALIAS auth-parity +
consolidated-grant/persisted-key preconditions, Phase 1 gate additions, Phase 2 blast radius,
and citation fixes. Verdict was "directionally sound, not safe to execute as written" — those
gaps are now addressed; re-confirm live state before executing any phase.
Drafted: 2026-06-25 (S290)
Owner: cross-app (originating concern: reviewer Workbench consolidation)
Scope: confusing/overloaded nomenclature and untracked app lifecycle across the
multi-app repo — specifically (1) original apps no longer in use but never formally
deprecated, and (2) shared infrastructure (routes, components, services) borrowed by
live apps that still carries legacy app names.

> **Provenance.** Inventory traced by Claude and independently verified/corrected by a
> Codex source trace (S290), then adversarially reviewed by Codex. file:line citations
> are from that trace; re-confirm live before acting (durable-docs rule). External-usage
> claims (who calls a route from *outside* the repo) are `[ASSUMED]` — the repo cannot
> prove their absence; they need Vercel access logs / Power Automate / Dynamics checks.
> Related: `.claude-memory/project-nomenclature-and-app-sunset-sweep.md` (the parked
> TODO this doc fulfills), `project-workbench-consolidation-rollout.md` (sequencing),
> `project-deferred-code-cleanup.md` (inert-code registry), `feedback-rename-code-not-just-docs`.

---

## 1. The Core Problem & the Central Trap

History left three *different* kinds of legacy naming, and they look alike until you
trace callers:

1. Apps that are **genuinely gone** (e.g. Concept Evaluator) but only informally so.
2. Apps that were **consolidated** into a successor (Reviewer Finder + Review Manager →
   Workbench), whose **infrastructure is still live** under the old names.
3. **Pure naming debt** — misleading symbols/labels/files where a rename changes no
   external contract.

**The trap:** treating a *consolidated-but-live* surface as deprecatable breaks the
successor app; treating a *dead* app as "just needs renaming" leaves cruft. Every
cleanup action must first classify the surface.

A **fourth class is not legacy at all** — live cross-cutting capabilities (standalone +
embedded modes, often persisting durable state) that the sweep must RECOGNIZE and SKIP, not
rename or deprecate. They look adjacent to the legacy surfaces but are neither dead nor
naming-debt. (Folded from the S290 Codex adversarial review.)

---

## 2. Classification Framework

| Bucket | Mechanical test | Action |
|---|---|---|
| **deprecated-app** | Not in `APP_REGISTRY`; no live import/route caller in active source; files archivable | Archive (Concept Evaluator pattern) + lifecycle entry |
| **borrowed-live-infra** | Legacy name, but a live app (via `APP_REGISTRY`) reaches it through page → component → fetch/import → API/service | KEEP; relabel/re-own; never retire |
| **pure-naming-debt** | Renaming touches only in-repo imports/UI text/files — no route path, env key, prompt name, or persisted preference | Rename code + UI, with tests |
| **live-cross-cutting** (NOT legacy; out of rename scope) | Live caller(s); standalone AND embedded modes; may persist durable state (grep for an `akoya_*`/`wmkf_*` write) | RECOGNIZE & SKIP — don't rename/deprecate; document only if the name misleads | `/api/field-primer/generate` persists `akoya_request.wmkf_ai_fieldprimer` (`field-primer/generate.js:11,118`), called by `ProposalTab.js:235`, read via `resolve-request.js:138` [VERIFIED] |

**How to tell them apart, concretely:**
- Start at `shared/config/appRegistry.js` `APP_REGISTRY` → page (`pages/<key>.js`) →
  component → `fetch(...)`/import → API route / `lib/services/*` / persistence. Anything
  with a live caller on that path is **borrowed-live-infra**, even if its namespace is
  legacy. [VERIFIED path example: `appRegistry.js:70-74` → `pages/workbench/[requestId].js`
  → `ReviewersTab.js:71,95` → `/api/review-manager/reviewers`, `/api/reviewer-finder/my-candidates`]
- For a suspected orphan: `rg` for inbound links/imports AND check whether the page calls
  any API; a page-only API with no other caller is a co-orphan. Confirm external direct-URL
  use via Vercel logs before archiving (`[ASSUMED]`-until-checked).
- For naming debt: grep the exact symbol; **split** hits into (UI text / files / in-repo
  imports) vs (route paths / env keys / prompt names / stored preference keys). Only the
  first group is safely renameable.
- **Durable-state check (catches the live-cross-cutting bucket):** before calling any
  surface dead or renameable, grep its handler for an `akoya_*`/`wmkf_*` write or a
  read-back consumer. A surface that persists or is read across apps (e.g. field-primer) is
  live-cross-cutting — recognize and skip it, don't fold it into deprecated/naming-debt.

---

## 3. Single Source of Truth — App Lifecycle State

**Where:** `shared/config/appRegistry.js`, as a **separate export** —
**do NOT re-add deprecated/consolidated apps to `APP_REGISTRY`.** Its consumers assume
`APP_REGISTRY` = active, navigable, grantable apps. [VERIFIED consumers:
`shared/components/Layout.js:47-50`; `pages/index.js:24-36`; `pages/api/app-access.js:60,83`;
`pages/admin.js:1574-1579`] Add:
- `APP_LIFECYCLE_REGISTRY` — keyed by historical/current app key.
- `ROUTE_NAMESPACE_LIFECYCLE` — for borrowed API namespaces + direct-URL pages.

**States:**
- `active` — every `APP_REGISTRY` key must map to this.
- `consolidated-into` — former identity now under a successor key (`reviewer-finder`,
  `review-manager` → `reviewers`). [VERIFIED: `appRegistry.js:70-74`]
- `deprecated` — retired; fields `deprecatedAt`, `archivedTo`, `successorKey`/reason,
  grants-retained flag. (Concept Evaluator.) [VERIFIED: `_archived/README.md:15-17`]
- `direct-url-test` / `sunset-candidate` — not navigable but still routable, pending a
  usage decision (`phase-i-dynamics`, `test-email`; and, from S344 2026-07-08, the four
  sunset PDF-upload document-processing apps `batch-phase-i-summaries`,
  `batch-proposal-summaries`, `phase-i-writeup`, `phase-ii-writeup` — code retained for a
  planned Dataverse-native migration, routes left routable). [VERIFIED: `appRegistry.js`
  `APP_LIFECYCLE_REGISTRY`]
- `borrowed-live-infra` — for route namespaces whose owner app is now `reviewers`.

**Consumer behavior:** navigation/home/grants/`ALL_APP_KEYS` keep reading `APP_REGISTRY`
only. [VERIFIED: `appRegistry.js:161-168`] Docs/CI read the lifecycle map to explain
historical keys and block stale claims. `scripts/lib/canonical-facts.js` derives
`APP_REGISTRY.length` (currently **12**, after the S344 sunset of the four PDF-upload
apps) from the array literal — do not hand-write the
count, and don't change that deriver unless intentionally changing the active-app fact.
[VERIFIED via `scripts/lib/canonical-facts.js:81-115` — it locates the exact `APP_REGISTRY`
export identifier before counting elements, so it's robust to a second export. NOTE: a bare
`rg "^\s*key:"` count is brittle once `APP_LIFECYCLE_REGISTRY` adds `key:` entries — use the
canonical-facts derivation, not grep (S290 review).]

**Precondition — consolidated-grant + persisted-key inventory (S290 review).** Before any
lifecycle rollout, inventory and set policy for two persistence surfaces the lifecycle map
alone doesn't cover:
- **`user_app_access` grant rows for consolidated keys.** New grants are validated against
  `ALL_APP_KEYS` (= `APP_REGISTRY` keys) at write (`app-access.js:83` [VERIFIED]), so a
  consolidated key can't be *newly* granted — but the reviewer routes STILL honor an existing
  legacy grant variadically (`my-candidates.js:69`, `review-manager/reviewers.js:94`
  [VERIFIED]), so any lingering `reviewer-finder`/`review-manager` rows remain live. Decide:
  drop the rows, or keep + document.
- **Persisted namespace keys reading `reviewer-finder`.** The model-override key
  `model_override:reviewer-finder:model` (`lib/services/model-override-loader.js`), prompt
  rows/overrides, and `reviewerFinderPreferences`. These are persistence contracts — migrate
  via an explicit stored-key migration, never a bare rename.

---

## 4. Per-Surface Rubric for Borrowed-Live-Infra

| Option | Use when | Done-when | Risk |
|---|---|---|---|
| **RENAME** | internal-only; all callers are in-repo imports/tests | symbol/file/imports/tests updated; no legacy string except documented history | missed import; stale doc; broken persisted string |
| **ALIAS** | semi-external contract, but a canonical new name is worth it | old delegates to canonical handler/service; both paths tested; deprecation signal emitted | drift if the two paths diverge |
| **LEAVE + DOCUMENT** | external dependency plausible, or rename cost > confusion saved | route matrix + glossary state owner app = Workbench/`reviewers`, legacy name intentional | ongoing stale-claim cost (mitigated by glossary + gates) |

**Route paths are contracts.** `/api/reviewer-finder/*` and `/api/review-manager/*` are
called in-repo from many reviewer components [VERIFIED: `ReviewersTab.js:71,95`;
`ReviewerSearchSection.js:591,619,673,1017`; `ReviewerManagePanel.js` multiple] AND may be
hit by external callers (Power Automate, Dynamics, bookmarks) — **`[ASSUMED]`, unprovable
from the repo.** **Default: LEAVE + DOCUMENT.** Only consider ALIAS later, for genuinely
high-confusion routes, by adding `/api/workbench/reviewer-*` wrappers that call the same
shared route services while keeping legacy paths for ≥1 full cycle.

**ALIAS auth parity (S290 review).** Any `/api/workbench/reviewer-*` alias MUST reuse the
identical variadic grant contract — the legacy routes accept BOTH the legacy grant AND
`reviewers` via `requireAppAccess(req, res, '<legacy>', 'reviewers')`
(`my-candidates.js:69`, `review-manager/reviewers.js:94` [VERIFIED]) — get its own
`docs/API_ROUTE_SECURITY_MATRIX.md` row, and ship tests for legacy-only AND reviewers-only
grants. `check:api-routes` only verifies matrix coverage + a recognized guard token, NOT
semantic auth parity (`scripts/check-api-route-security-matrix.js`), so parity must be
test-enforced, never gate-assumed.

**Internal components** under `shared/components/reviewers/*` are good RENAME candidates
(in-repo imports). **Services** under `lib/services/reviewer-*` are mostly already
canonical domain names, not legacy app names. **Config/prompt/preference keys** that read
`reviewer-finder` (e.g. `baseConfig.js`, `reviewerFinderPreferences.js`, the
`model_override:reviewer-finder:model` admin setting) are persistence namespaces — ALIAS
or migrate only with an explicit stored-key migration, never a bare rename.
[VERIFIED: `shared/config/baseConfig.js:31-38`; `shared/config/reviewerFinderPreferences.js:22-45`; `pages/admin.js:882-891`]

---

## 5. Phased Plan (each phase independently shippable + verifiable)

Honors the consolidation memory: **dead-end UI removal first, then rename the smaller
live surface.** Run each gate and its `:self-test` sequentially.

- **Phase 0 — Confirm orphan status.** `rg` inbound refs + Vercel access-log check for
  `/phase-ii-writeup-legacy`, `/api/process-legacy`, `/phase-i-dynamics`,
  `/api/phase-i-dynamics/*`, `/test-email`, `/api/test-email`. Repo evidence: Phase II
  legacy WAS a **sunset-candidate (direct-URL legacy)** — an authenticated direct-URL page
  (now `_archived/pages/phase-ii-writeup-legacy.js:423`) calling a still-guarded
  `/api/process-legacy` (now `_archived/pages/api/process-legacy.js:20`); the plan was to treat
  it like the other direct-URL surfaces until access logs prove no use. **[DONE S291 2026-06-26: Vercel
  runtime-log retention is ~1 day so logs cannot prove months of non-use; owner confirmed the
  page is invisible to all suite users and not in active use → archived in Phase 1 / Commit 2.]**
  **`phase-i-dynamics` and `test-email` are live direct-URL/test surfaces — NOT to be archived.** [VERIFIED: `pages/phase-i-dynamics.js:7-16`; `pages/api/test-email.js:1-7,18-23`;
  `docs/API_ROUTE_SECURITY_MATRIX.md:121-122,154`]
- **Phase 1 — Retire confirmed dead ends.** Concept-Evaluator archive pattern: move
  page/API/prompt to `_archived/`, update `_archived/README.md`, mark API-matrix/docs/tests
  archived. **[DONE S291 2026-06-26: `phase-ii-writeup-legacy` + `/api/process-legacy` +
  `proposal-summarizer-legacy` prompt archived; `ROUTE_NAMESPACE_LIFECYCLE` entry removed,
  `APP_LIFECYCLE_REGISTRY` flipped to `deprecated`, canonical counts regenerated (79→78,
  134→133).]** (Original gating: start with `phase-ii-writeup-legacy` + `/api/process-legacy`
  (+ the `proposal-summarizer-legacy` prompt) only if logs confirm.) Gates: `check:api-routes`(+self-test);
  `check:prompt-injection-tagging`(+self-test) — `process-legacy` WAS registered there
  (entry removed S291; see the archive comment in `scripts/check-prompt-injection-tagging.js`), and the process-route
  payload-boundary tests (`tests/integration/process-routes-payload-boundary.test.js`) +
  `docs/AI_DATA_FLOW_MATRIX.md` must move in the SAME commit; plus `check:doc-symbol-refs`,
  `check:build-claim-freshness`, `check:fact-consistency` if counts move.
- **Phase 2 — Rename live internals (RENAME bucket). [DONE S291 2026-06-26.]**
  `CandidatesPanel.js` → `ReviewerInvitePanel.js` (fits the `ReviewerFindPanel`/`ReviewerManagePanel`
  sibling convention). Moved in the same commit: the two unit tests (renamed to
  `tests/unit/reviewer-invite-panel-*.test.js`), the tab import + JSX in `ReviewersTab.js`, the
  onboarding deck (`docs/onboarding/build_workbench_decks.py`), the glossary, and the strategy
  + handoff docs. **Left untouched (contracts):** `/api/reviewer-finder/my-candidates`, the
  sub-tab key `candidates`, and the `?sub=candidates` deep-link. **Deferred to the Phase 4
  `/sweep`:** the bare-symbol `CandidatesPanel` mentions in `.claude-memory` + `docs/agent-wiki`
  (NOT path-scanned by `check:doc-symbol-refs`, so they don't break a gate) and the ~20
  historical `docs/` design docs that record the old name. (MEMORY.md router has no
  CandidatesPanel ref; the earlier `:66` citation was stale.) Gates: reviewer-tab unit/integration
  tests, `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:agent-wiki`.
- **Phase 3 — Document borrowed namespaces. [DONE S292 2026-06-26: verified every `/api/*`
  namespace maps to an active `APP_REGISTRY` key, documented infrastructure, or a lifecycle
  entry; the only legacy-named borrowed namespaces (`/api/reviewer-finder/*`,
  `/api/review-manager/*`) are captured in `ROUTE_NAMESPACE_LIFECYCLE` + `NOMENCLATURE_GLOSSARY.md`
  + the API matrix and gated by `check:route-lifecycle-auth`. Nothing else needed documenting;
  no `/api/workbench/*` ALIAS wrappers added — LEAVE+DOCUMENT stands.]** LEAVE+DOCUMENT the legacy route namespaces in
  `docs/API_ROUTE_SECURITY_MATRIX.md` + the glossary (or add `/api/workbench/*` ALIAS
  wrappers). Gates: `check:api-routes`(+self-test); `check:trust-boundary-guid` if a new
  route passes a request id into a Dataverse selector.
- **Phase 4 — One fact-level `/sweep`. [DONE S292 2026-06-26: swept `CandidatesPanel`
  repo-wide — reconciled the filename/symbol to `ReviewerInvitePanel` in current-state wiki,
  memory, enforcement-contracts/specs, and the build plan; left dated design docs / audits /
  "SHIPPED SNNN" narratives as point-in-time HISTORICAL records per `.claude/rules/durable-docs.md`.
  Drift gates re-run green.]** Reconcile docs/memory/wiki after the code/lifecycle
  facts settle (NOT before — a docs-only sweep re-anchors to surviving legacy code names).
  Gates: `check:fact-consistency`, `check:doc-symbol-refs`, `check:build-claim-freshness`,
  `check:agent-wiki` (with self-tests).

---

## 6. Guardrails & Canonical Glossary

**Glossary:** `docs/NOMENCLATURE_GLOSSARY.md`, human-readable and canonical, backed by the
`APP_LIFECYCLE_REGISTRY`/`ROUTE_NAMESPACE_LIFECYCLE` exports. Agent wiki routes to it,
doesn't duplicate it. Per-term schema: `term`, `canonicalName`, `legacyAliases`, `status`
(`canonical | legacy-live | deprecated | ambiguous | direct-url-test`), `ownerAppKey`,
`successorKey`, `surfaceType` (`app | route-namespace | component | service | data-model |
prompt-key | preference-key`), `currentPaths`, `allowedUse`, `forbiddenUse`,
`migrationDecision` (`RENAME | ALIAS | LEAVE+DOCUMENT`), `notes`, `lastVerified`.

**CI:** rely first on existing `check:doc-symbol-refs`, `check:build-claim-freshness`,
`check:fact-consistency`, `check:agent-wiki`. A bespoke `check:nomenclature-lifecycle` gate
(fail when a deprecated key appears in active source without an archive marker; assert every
`APP_REGISTRY` key is `active`; assert consolidated/deprecated keys aren't in `ALL_APP_KEYS`;
allow `/api/reviewer-finder|review-manager/*` only when the glossary marks them `legacy-live`)
is **deferred / optional** — build it only if drift recurs (simplest-first; a gate is surface
to maintain). If built, ship its fixture self-test first.

---

## 7. First 2–3 Commits

1. **`Add app lifecycle registry + nomenclature glossary`** — additive, zero-risk.
   `appRegistry.js` gains `APP_LIFECYCLE_REGISTRY` + `ROUTE_NAMESPACE_LIFECYCLE`;
   `docs/NOMENCLATURE_GLOSSARY.md` seeds Workbench / Reviewer Finder / Review Manager /
   candidates / reviewer-suggestion / Concept Evaluator; wiki index links it. Gates:
   `check:fact-consistency`, `check:doc-symbol-refs`, `check:build-claim-freshness`,
   `check:agent-wiki`(+self-test if wiki touched).
2. **`Archive Phase II legacy writeup surface`** — **[DONE S291 2026-06-26. Precondition was
   "Vercel logs confirm no direct hits"; runtime-log retention is ~1 day so logs could not
   prove months of non-use — cleared instead by owner confirmation that the page is invisible
   to all suite users and unused.]** Moved `pages/phase-ii-writeup-legacy.js`, `/api/process-legacy`, and the
   `proposal-summarizer-legacy` prompt to `_archived/`; update `_archived/README.md`,
   API matrix, data-flow matrix, prompt-injection tagging config/tests. Gates:
   `check:api-routes`(+self-test), process-route/prompt-boundary tests, `check:doc-symbol-refs`,
   `check:build-claim-freshness`.
3. **`Rename Workbench invite-reviewers internals`** — **[DONE S291 2026-06-26]** renamed
   `CandidatesPanel.js` → `ReviewerInvitePanel.js`; updated in-repo imports/tests/deck + the
   glossary/strategy/handoff docs; left reviewer route paths + the `candidates` tab key /
   `?sub=candidates` deep-link untouched. Descriptive memory/wiki + historical `docs/` mentions
   deferred to the Phase 4 `/sweep`. Gates green: reviewer-tab tests, `check:doc-symbol-refs`,
   `check:build-claim-freshness`, `check:agent-wiki`.

---

## 8. Verified Inventory Snapshot (S290)

- `APP_REGISTRY`: **16** active apps; no `reviewer-finder`/`review-manager` key (only
  `reviewers` → `/workbench`, "successor to Reviewer Finder + Review Manager").
  [VERIFIED: `appRegistry.js:8-159,70-74`]
- Borrowed-live-infra: `/api/reviewer-finder/*` and `/api/review-manager/*` are the
  LEGACY-named borrowed namespaces; `/api/workbench/*` is the canonical successor namespace —
  one app, three namespaces; plus `shared/components/reviewers/*` and many `lib/services/*`.
  (Per-namespace file counts via `find pages/api/<ns> -name '*.js' | wc -l`; not pinned here,
  to avoid drift against the canonical `api-route-file-count` fact.)
- Orphan candidates: `phase-ii-writeup-legacy` (**ARCHIVED S291 2026-06-26** — owner confirmed
  it is invisible to all suite users and not in active use; page + `/api/process-legacy` +
  `proposal-summarizer-legacy` prompt moved to `_archived/`); `phase-i-dynamics` + `test-email`
  (NOT orphans — live direct-URL/test surfaces); plus the live-cross-cutting `field-primer` (recognize & skip).
- Deprecation precedent: Concept Evaluator — removed from registry and archived to `_archived/`
  [VERIFIED: `_archived/README.md:15-17`]; the grants-retained decision is documented in the
  `appRegistry.js:9-14` comment [VERIFIED]. (The `project-app-roadmap-2026-04-25` memory is
  marked stale — not used as support.)

## 9. One-Line Summary

Separate "dead" from "borrowed," encode app lifecycle as data **next to** (not inside)
`APP_REGISTRY`, **document** legacy route names rather than renaming them, rename only
in-repo internals, and let a canonical glossary + existing doc gates hold the line —
sequenced behind dead-end-UI removal.
