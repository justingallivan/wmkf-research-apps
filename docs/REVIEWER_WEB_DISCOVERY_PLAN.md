---
title: "Reviewer Web-Grounded Discovery (Perplexity Track C) — Build Plan"
domain: reviewer-identity
kind: plan
status: historical
summary: "Evaluated and abandoned Perplexity web discovery; retained as historical safety and evidence record."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-perplexity-reviewer-agent.mjs
  - scripts/probe-perplexity-search.mjs
  - docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md
  - lib/utils/safe-fetch.js
---

# Reviewer Web-Grounded Discovery (Perplexity Track C) — Build Plan

> **Retired outcome:** The Perplexity web-discovery path was evaluated and abandoned in
> S230. This document is retained only as the historical safety/evidence record.
>
> **Current routing:** Use [Reviewer Origination](agent-wiki/topics/reviewer-origination.md)
> for the current reviewer-discovery posture.

> ## 🛑 OUTCOME (S230, 2026-06-06): EVALUATED → ABANDONED
> The shipped read-only web-suggestions panel — and a follow-on probe of a single
> Perplexity `sonar` reviewer-**agent** call (the JSON-returning prompt Perplexity
> itself proposed) — were evaluated on real proposals and **abandoned**. The web
> search option is being removed from the reviewer-finder UI. Everything below is
> retained as the historical design record; **do NOT re-implement the naive
> (ungrounded) versions.**
>
> **What was tried**
> - *v1.1 (shipped):* Perplexity `/search` (retrieval) → Claude name-extraction → read-only leads. A live run was mostly noise — faculty-directory pages scraped into junk "leads", raw page-dump snippets, and a Co-PI surfaced as a reviewer. S230 fixed the COI filter + a per-URL cap + per-person rationale (commits `62445ec`, `35b8b03`), but quality stayed poor.
> - *Probe (not in the app):* `scripts/probe-perplexity-reviewer-agent.mjs` — one `sonar-pro` chat call that BOTH searches and reasons, returning finished reviewer JSON. Read-only.
>
> **Why abandoned — hallucination VERIFIED against PubMed/ORCID on real proposals:**
> | Request | Topic | Verified result |
> |---|---|---|
> | 1002794 | attosecond physics (mainstream) | ~7/7 real & on-topic; 5 plausible-but-unverified emails |
> | 1002238 | fungal electrophysiology (niche) | 3 real (Bowman, Beasley, Shabala); **2 confirmed fabricated** (a UT-Austin "Neurospora Michael Levine" + invented email; "Adam Pawluk"); 1 unconfirmed |
> | 1002204 | RNA intronic thermosensors | 2 strong (Mayr, Kinney) + 1 weak (Hawley); **2 confirmed conflations — REAL people given FALSE affiliations/fields** (DasGupta→"Berkeley", Frische→"Copenhagen"); 1 unsubstantiated |
>
> **Failure modes (all verified, not merely suspected):** invented people; invented institutional emails (inconsistent — present 1002238, absent 1002204, so "no email" is NOT a safety signal); and **real researchers given fabricated affiliations + expertise** (worst case — passes a naive "does this name exist?" check, would mis-route a real email). Self-reported `confidence` was unreliable (a perfect match rated "low"; a fabrication "medium"). Fabrication rate scales with topic obscurity.
>
> **The one viable path (identified, NOT built):** the agent is a decent idea generator but unsafe raw. A safe v2 would use it as a discovery source ONLY and **ground every name through PubMed/ORCID** — verifying a TOPICAL publication record (not mere existence), deriving affiliation + contact from the verified record (never the model), and dropping anything ungroundable. Deprioritized vs. the existing Claude + PubMed candidate pipeline. If ever revisited, that grounding is mandatory. See [[project-reviewer-web-discovery-abandoned]].

**Status:** v7 (S225) — **SCOPE NARROWED to a READ-ONLY web-suggestions panel** after 6 prose-review rounds (each returned blockers). Implementation, not more prose, from here. **Increment 1 (backend `WebDiscoveryService` + A7 extraction prompt) shipped S225; increment 2 (route `/api/reviewer-finder/web-suggestions` + capability-gated `searchWeb` toggle + read-only panel in `ReviewerSearchSection`) shipped S227.** Live Perplexity Search contract **VERIFIED 2026-06-05 (S227)** via `scripts/probe-perplexity-search.mjs`: HTTP 200 (account entitled to `/search`, not just sonar chat), `search_after_date_filter` M/D/YYYY accepted + honored, `results[].{title,url,snippet,date,last_updated}` shape confirmed (§5). `PERPLEXITY_API_KEY` is now live in **prod** too → the capability reports true and the feature activates on deploy. Snippet-budget tuned S227: the live probe showed ~8KB faculty-page snippets were truncating all but ~2-3 of up to 24 results at the old 20K extraction cap, so `WEB_RESULTS_MAX_CHARS` 20K→100K, `EXTRACTION_MAX_TOKENS` 1024→4096, plus a new `PER_SNIPPET_MAX_CHARS` 6K guard (the constants were untuned defaults, not an API/cost wall — Sonnet 200K window). The VRP-coupling consequence of the now-always-present key is parked in the Virtual Review Panel memory — settle it during VRP work, not each reviewer session.

> ## ⚠️ SCOPE BANNER — read this first (S225, takes precedence over older sections below)
> **v1 ships the READ-ONLY web-suggestions panel ONLY.** A NEW dedicated endpoint `/api/reviewer-finder/web-suggestions` runs Perplexity Search → A7-extraction → `WebLead[]`; the client renders them in a separate panel with provenance links. **It does NOT touch `/discover`, the candidate pipeline, ranking, COI, roster, or save**, and is called **separately** from `/discover` so it is entirely off that route's abort-to-error boundary (this dissolves the v6 deadline blocker — there is no shared deadline frame to corrupt).
> **DEFERRED to a follow-up (NOT in v1):** the **"Add as candidate" / manual-add** path (append to `analysisResult.reviewerSuggestions` + discover-only re-run + the `manualAdd` 3-pub-gate bypass). Codex's two v6 BLOCKERS both live in that path (false `verified:true/pubmed/claude_suggestion` provenance for sparse manual names; the discover deadline error-frame). Sections §2–§3 and §10 below that describe Add-as-candidate / gate-bypass / merge are **deferred**, retained only so the follow-up isn't re-derived. v1 builds none of them.
> Irreducible v1 surface (all dispute-free per Codex v6 steps 1–5): `WebDiscoveryService` + A7 extraction prompt + live contract test + the new endpoint + capability-gated `searchWeb` toggle + `search_cache` `perplexity` namespace + the read-only panel. Fail-soft: no key / error / outage → empty panel, never blocks the normal search.
**Topic:** EOD-S222 reviewer-finder Topic #3 (Perplexity's role). Memory: [[project-reviewer-finder-next-topics]] §3.
**Scope history:** v1–v4 designed the *full pipeline integration* (web leads merged into `discovered` → ranking → COI → save). Three Codex pre-impl rounds found 5→2→2 HIGHs — a **plateau, not convergence**. A `/contract-reconcile` whole-flow trace (S225) showed every HIGH lived on the *integration* surface (merge→rank→COI→roster→save), and that a **display-only v1 deletes that entire surface**. v5 re-cuts to display-only; the full integration is preserved as **deferred v2** (§10), to revisit *after* the monitoring phase justifies the automation.
**Relationship to prior work:** distinct from the *identity-disambiguation* Perplexity use spec'd in `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` §7 (a deferred backstop). Earlier strategy: `outputs/perplexity_reviewer_identification_strategy.md` ("Perplexity … strong orchestration layer for discovery and evidence gathering … should not become the final identity authority").

---

## 1. Motivation (Justin, S225)

Claude's candidate discovery (`ClaudeReviewerService` Stage 1) reads a proposal and recognizes peer groups from its training knowledge, but it is biased two ways:

1. **Training cutoff** — it cannot name a researcher who rose to prominence after its knowledge cutoff.
2. **Fame** — it over-surfaces canonical names (field founders, Nobel laureates). Scientifically on-point but **unlikely to have bandwidth to review** for the foundation.

We don't want the *father of the field*; we want **currently-active, mid-career contributors**. That is a **recall + freshness** problem on the **discovery** path. A web-grounded source (current knowledge, not fame-biased) addresses it. Enrichment / current-affiliation is already well-covered (ORCID > Scholar > PubMed-recency, S224) — out of scope here.

## 2. Decision (locked with Justin, S225)

- **Role:** discovery **lead source** — surfaces net-new candidate *names* with provenance. Leads-only; never an identity verdict, score, or gate.
- **v1 = DISPLAY-ONLY web panel + a new "Add as candidate" entry path.** Web-discovered names render in their **own panel**, separate from the Claude/Database results — they do **NOT** auto-enter verification, ranking, COI, roster, or save. Staff click **"Add as candidate"** on a web suggestion (or type a name directly — same entry point), which **appends the name to `analysisResult.reviewerSuggestions` and re-runs discover-only**, so it flows through the *already-correct* Track A path. **Why display-only:** the `/contract-reconcile` trace (§9) proved the full-integration HIGHs are all generated by the merge/rank/COI/save surface; keeping web results in their own panel and only entering the pipeline via an explicit, human-vouched add removes that surface, is smaller/lower-risk, and matches the v1 goal — *"let me monitor what the results look like"* (Justin).
- **Manual adds bypass the 3-pub gate (decided S225).** `verifyClaudeSuggestions` drops `<3`-PubMed-pub names into read-only `unverified` (`discovery-service.js:385`) — which would bury the sparse, currently-active researcher that is the whole point. A manually-added name carries a flag that keeps it **selectable regardless of pub count**, badged "manually added · N pubs". This is the one behavioral change to `verifyClaudeSuggestions`, scoped to the manual-add path only.
- **Invocation:** **on by default, with a visible staff toggle to disable** ("also search the web for current researchers"). Toggle is the cost/latency escape hatch.
- **API:** Perplexity **Search API** (`POST https://api.perplexity.ai/search`) — *not* the `sonar` chat-completions surface VRP uses. Verified contract in §4.

## 3. Architecture — v1 (display-only)

```
searchWeb on + PERPLEXITY_API_KEY set
  → WebDiscoveryService.search(queries)               // ≤3 capped queries + recency steering (§4)
      → Perplexity /search → results[] {title,url,snippet,date}
  → A7-wrap snippets → SEPARATE Claude name-extraction call → WebLead[] {name, provenanceUrl, snippet, date}
  → SSE: a NEW `webSuggestions` event/field (does NOT touch verified/unverified/discovered/ranked)
  → client: a dedicated "Web suggestions" panel (name + provenance link + snippet + date) + an "Add a name" text input
  → staff "Add as candidate" → append {name, source:'manual', manualAdd:true} to held analysisResult.reviewerSuggestions
       → re-run /discover ONLY (no re-analyze) → verifyClaudeSuggestions (Track A) → normal pipeline, selectable
```

- **`WebDiscoveryService`** is self-contained: Perplexity transport (via existing `safeFetch` — host already allowlisted, §5), `search_cache` reuse (with a dedicated `perplexity` source namespace, §7), result-shape validation, the A7 extraction call. It returns `WebLead[]` and **nothing else touches the discovery pipeline.**
- **Leads-only contract.** `WebLead = { name, provenanceUrl, snippet, date }`; `provenanceUrl ∈ results[].url` ONLY (Perplexity docs warn *model-authored* URLs hallucinate — we take `results[].url`, never a URL the extraction model emits). No verdicts, no scores.
- **No corroboration of web leads in the panel.** The web panel does **not** run PubMed author lookup (that's where the deadline-in-corroboration HIGH + the Track A refactor came from — both gone). The snippet + provenance link is the evidence staff judge in the panel; PubMed corroboration happens only on the explicit "Add as candidate" (the name goes through Track A like any suggestion).
- **The "Add as candidate" mechanism is VERIFIED, not assumed (`[VERIFIED]` S225):** the client holds `analysisResult` after analyze (`ReviewerSearchSection.js:468`); `/discover` reads `analysisResult.reviewerSuggestions` → `verifyClaudeSuggestions` (`discovery-service.js:67,82`). A suggestion needs only `name` (`reviewer-finder.js:300`). So appending a manual name + a discover-only re-run routes it through Track A. **Two builds this requires:** (1) a discover-only re-run path — `run()` currently always re-analyzes first (`ReviewerSearchSection.js:447`), so the discover half is extracted into a callable taking the held `analysisResult`; (2) the §2 3-pub-gate bypass for `manualAdd` suggestions at `discovery-service.js:385`. No new persistence — saving still goes through the normal selectable→save path.

## 4. Steering toward current contributors (not founders)

Levers on the Search API:
- **Recency:** explicit `search_after_date_filter` window (3–5 yr), not the enum-only `search_recency_filter` — deterministic/reproducible, matches the existing 5-yr recency model. Date behavior VERIFIED LIVE 2026-06-05 (S227): M/D/YYYY accepted; no result predated the window.
- **Domain focus (optional, tunable):** `search_domain_filter` (≤20) toward faculty/lab/scholar/preprint domains.
- **Extraction prompt:** instructed to surface *active, currently-publishing mid-career researchers* and **de-prioritize field founders / laureates / emeritus**. **v1: a STATIC bundled prompt** in `shared/config/prompts/reviewer-finder`, NOT admin-editable — the reviewer prompt registry (`reviewer-prompt-resolver.js:33-44`) supports only `analyze` + `score-candidates`, and editability would need a third prompt name + fallback + Dynamics seed + resolver coverage. Tuned in code during monitoring; admin-editability deferred. It is still A7-registered (§6).

## 5. Perplexity Search API contract (VERIFIED 2026-06-05 via docs.perplexity.ai/api-reference/search-post)

- `POST https://api.perplexity.ai/search`, `Authorization: Bearer $PERPLEXITY_API_KEY`.
- Request: `query` (string | string[], required); `max_results` (1–20, default 10); `search_recency_filter`; `search_after_date_filter` / `search_before_date_filter`; `last_updated_after_filter` / `last_updated_before_filter`; `search_domain_filter` (≤20); `country`; `search_context_size` (low|medium|high).
- Response: `{ results: [{ title, url, snippet, date|null, last_updated|null }], id, server_time }`.
- **Pricing/rate-limits not in docs** — confirm before enabling in prod (§7 cost).
- **Live contract test DONE (2026-06-05, S227)** — `scripts/probe-perplexity-search.mjs` pinned this shape against a real response (HTTP 200; `{id, results}`; `results[].{title,url,snippet,date,last_updated}` 10/10; M/D/YYYY filter accepted + honored). The docs-pass was not a substitute; the live call confirmed Search-API entitlement on the existing key.
- Transport: `api.perplexity.ai` is **already** in `lib/utils/safe-fetch.js` `ALLOWED_HOSTS` (line 43, from the VRP sonar call) and the Search API is the same host — VERIFIED 2026-06-05, no allowlist change needed.

## 6. Security & safety

- **A7 prompt-injection:** every Perplexity `title`/`snippet` is untrusted web content → `wrapUntrustedContent` (DATA_CLASSES) before it enters the extraction prompt. **The new extraction builder/call site MUST be registered in `scripts/check-prompt-injection-tagging.js`** (today it registers only `createAnalysisPrompt` + `createDiscoveredReasoningPrompt` for reviewer-finder) — else the gate won't enforce the wrap. The extraction output (`WebLead[]`) carries no instructions downstream; the snippet shown in the panel is display-only text.
- **No URL re-fetch in v1** — `results[]` fields only.
- **Leads-only + display-only** keeps the probabilistic source out of every persistence/identity/ranking surface by construction.

## 7. Env / config / cost

- **`PERPLEXITY_API_KEY` already exists** — `docs/CREDENTIALS_RUNBOOK.md:62` ("Perplexity panel reviewer (claim verification)") for VRP, but **NOT** in `lib/utils/tracked-secrets.js` (VERIFIED 2026-06-05). Not a new secret. Implementation: (a) update the runbook wording to shared "VRP claim verification + reviewer web discovery"; (b) add it to `tracked-secrets.js` for rotation visibility.
- **VRP coupling:** `MultiLLMService.getAvailableProviders()` reports any keyed provider, so the key already makes `perplexity` *configured* for VRP wherever set. **Prod** with `VRP_ALLOWED_PROVIDERS` unset → VRP **fails closed** (empty allowlist). **But `resolveAllowedProviders` returns ALL keyed providers in non-production when the allowlist is unset** (`vrp-providers.js:23`) — so dev/test exposes Perplexity to VRP unless those envs set an allowlist. Document next to the key.
- **Fail-soft + key-gating (Codex v5 MEDIUM):** key unset → `searchWeb` toggle hidden/disabled; discovery proceeds Claude+DB only. The toggle's visibility needs a capability signal: `/api/api-capabilities` does **not** expose Perplexity today and the Workbench panel gets no capability prop — so v1 adds a `perplexity` (or `reviewerWebSearch`) boolean to `api-capabilities.js` and wires it to BOTH the standalone toggle and `ReviewerFindPanel`. No hard failure — additive.
- **Budget / deadline (Codex v5 HIGH — must isolate from the abort boundary):** the web search must NOT ride the shared deadline-abort path. `discover.js:358` re-throws on `deadlineController.signal.aborted` and emits an **error** event — so if the web call were inside that boundary, a fired deadline would surface an error instead of "empty webSuggestions," breaking fail-soft. v1 runs `WebDiscoveryService.search` in its **own try/catch with its own short timeout**, emits the `webSuggestions` SSE frame **before** the final boundary check, and on any web error/timeout emits an empty `webSuggestions` + continues. Web search never contributes to the error frame. (The deadline `signal` is still passed in for cooperative early-abort, but a web failure is swallowed, not thrown.)
- **Cost:** v1 caps **≤3 queries × `max_results: 10`** (enforced server-side in `WebDiscoveryService`, so a malformed client query array can't bypass it), only when the key is configured and `searchWeb` not disabled. **Cache reuses `search_cache` with a dedicated `perplexity` source namespace** — the existing cache identity is `(source, query_hash)` (`database-service.js:69,84`), so the new source value avoids collision with Claude-discovery entries (Codex v5 MEDIUM). Documented TTL/version + tests for hit/miss/**fail-open** (a miss or Perplexity outage degrades to "no web suggestions," never blocks the search).

## 8. UI

- Client option `searchWeb` (default `true`) on **both** surfaces — standalone `ReviewerSearchSection.js` (today sends only the literature booleans + `generateReasoning` ~line 470) and the Workbench `ReviewerFindPanel.js`/Find tab. Labeled checkbox; hidden/disabled when the capability signal (§7) says no key.
- A **dedicated "Web suggestions" panel**, visually separate from the existing two sections (`ReviewerSearchSection.js:761-762` splits results into `claudeItems` / `dbItems` only — the web panel is a NEW third region, NOT a filter over `displayCandidates`). Each entry: name, provenance-URL link, snippet, date, and an **"Add as candidate"** button. Plus a standalone **"Add a name"** text input (the same entry path, for names staff already know).
- **Action label — avoid the collision (Codex v5 MEDIUM):** the Workbench already uses **"Promote"** / "Promote back" for the roster excluded→active restore (`ReviewerSearchSection.js:670`). This feature's action is therefore **"Add as candidate,"** NOT "Promote," so one surface doesn't have two different "Promote" verbs.
- **"Add as candidate"** appends `{name, source:'manual', manualAdd:true}` to the held `analysisResult.reviewerSuggestions` and triggers the discover-only re-run (§3). It does NOT write the web panel into the roster, selection set, or save. The added name becomes a normal selectable candidate via Track A; web-panel entries themselves are not directly selectable/saveable.
- **State reset (Codex v5 MEDIUM):** add `webSuggestions` (and any "add a name" input state) to every reset path that currently clears `candidates`/`unverified`/`analysis`/`selected` (`ReviewerSearchSection.js:385-388, 444-445`) so stale web suggestions don't survive a request/proposal change or a new search.

## 9. Why display-only — the `/contract-reconcile` evidence (S225)

A whole-flow trace (caller→persistence→consumer) showed every Codex HIGH across the three v1–v4 rounds lived on the integration surface, and display-only deletes all of it:

| Finding (rounds 1–3) | Generated by | In display-only v1? |
|---|---|---|
| source overwritten to `claude_suggestion` | routing through `verifyClaudeSuggestions:363` | **gone** (no routing) |
| `isRelevant!==false` drops sparse leads | merge into `discovered` → `discover.js:294` | **gone** (no merge) |
| ranking-floor sinks leads invisibly | `rankAllCandidates`/`scoreRelevance` | **gone** (not ranked) |
| coauthor COI skips them | `discover.js:245` | **gone** (not in COI flow) |
| merge ordering vs the 3-pub loop | `discovery-service.js:175-202` | **gone** (no merge) |
| deadline not in corroboration loop | per-lead PubMed corroboration | **gone** (no corroboration) |
| Track A refactor non-regression | extracting the shared PubMed helper | **gone** (no refactor) |
| roster DTO drops web fields / 3rd section save wiring | merge into the candidate pipeline | **gone** (own panel, no save) |

Irreducible in either scope (and all in v1): Perplexity Search call, A7-wrapped extraction (`check:prompt-injection-tagging`), key-gating, the `searchWeb` toggle, cost cap, `search_cache` reuse, fail-soft. `[VERIFIED]` anchors: `discovery-service.js:1462-1463` (forced `isClaudeSuggestion:false`), `relevance-score.js:30` (bonus condition), `ReviewerSearchSection.js:761-762` (binary section split), `reviewer-search-logic.js:120-175` (roster DTO allowlist), `discover.js:294/245/362` (filter/COI/SSE).

## 10. Deferred to v2 — full pipeline integration (the v1–v4 design, parked)

Revisit **after** the monitoring phase shows web suggestions are worth automating. v2 would merge web leads into the discovery pipeline so corroboration/ranking/COI/save happen automatically. It carries these named contracts (each a Codex finding from the prose rounds — kept here so the work isn't re-derived):

1. **Merge ordering:** append to `results.discovered` AFTER Track B's qualification loop (`discovery-service.js:175-202`) via field-preserving Track-C dedup; suppress-not-drop vs `verified` names.
2. **Corroboration:** reuse `verifyClaudeSuggestions`' PubMed author lookup (`buildAuthorQuery`→`PubMedService.search`) **minus** the 3-pub gate; `pubCount:0` valid + surfaced. Extract the helper with a **Track A non-regression test** (verified/unverified split byte-for-byte unchanged).
3. **Deadline:** the per-lead PubMed loop checks `deadlineAt` between leads/variants (`PubMedService.search` is not abort-aware, `pubmed-service.js:45`) + a per-lead cap.
4. **Never silently dropped:** exempt web leads from the `isRelevant!==false` drop (`discover.js:294` — flag `lowRelevance`, don't remove); extend coauthor COI to them (`discover.js:245`); dedicated visible section so visibility ≠ rank position.
5. **Provenance + reason threading:** `source:'web'` never overwritten to `claude_suggestion`; thread `provenanceUrl`/`snippet`/`date`/`pubCount`/`isClaudeSuggestion:false` through SSE → display → roster DTO (`reviewer-search-logic.js`) → `save-candidates` (`sources` web branch, `:79-84`); persisted `matchReason` is pipeline reasoning ONLY, never the raw snippet (`save-candidates.js:98`); `expertiseAreas` seeded from proposal topics.
6. **Normalization shape:** the full `WebLead`→candidate field contract.

## 11. Testing (v1)

- **Live contract test** against the real Search API — `scripts/probe-perplexity-search.mjs` (on-demand script, not a jest test, so a paid call never fires in `npm test`/CI; exits cleanly when no key). Pins §5 shape. DONE 2026-06-05 (S227).
- Unit: name-extraction mapping (`results` → `WebLead[]`, `provenanceUrl` from `url` only, A7-wrap applied); leads-only invariant (no scores/verdicts); fail-soft when key unset; `searchWeb` off → `WebDiscoveryService` not called; cache hit/miss/**fail-open** with the `perplexity` source namespace (no collision with Claude entries); web error/timeout → empty `webSuggestions`, never an error frame.
- Integration — web panel isolation: a `webSuggestions` SSE field is emitted separately and does NOT alter `verified`/`unverified`/`discovered`/`ranked`; a fired discovery deadline still yields empty `webSuggestions` (not an error).
- Integration — Add as candidate: appending `{name, manualAdd:true}` and re-running discover-only routes the name through `verifyClaudeSuggestions`; a manual name with `<3` PubMed pubs lands **selectable** (not in read-only `unverified`) — the gate-bypass at `discovery-service.js:385` — while a NON-manual `<3`-pub Claude suggestion still goes to `unverified` (bypass is scoped to `manualAdd`).
- Unit — UI: `webSuggestions` + add-a-name input are cleared by every reset path (`ReviewerSearchSection.js:385,444`); the toggle is hidden when the capability signal is false.
- CI gates: `check:prompt-injection-tagging` (extraction wrap), `check:api-routes` (no new route — `discover.js` gains an option + SSE field), `check:atlas` (no new table).

## 12. Out of scope for v1

- The entire §10 v2 integration (merge/corroborate/rank/COI/save).
- §7-of-the-identity-doc anchor persistence (`identity_leads` table) — separate disambiguation PR.
- Re-fetching result-page URLs (needs domain allowlist + content-type guard).
- `pubCount` display and admin-editable extraction prompt — both v2/later.
