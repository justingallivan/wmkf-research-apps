---
title: "Reviewer Finder — Structured-ORCID PI Identity Wire-In (Design / Pre-Impl)"
domain: reviewer-identity
kind: plan
status: historical
summary: "Shipped structured-ORCID PI identity wire-in; retained as the historical build plan."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/proposal-pi-identity.js
  - pages/api/reviewer-finder/discover.js
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md
---

# Reviewer Finder — Structured-ORCID PI Identity Wire-In (Design / Pre-Impl)

> **Completed outcome:** The structured-ORCID PI identity wire-in shipped in S253.
> This document is retained as the pre-build and implementation record.
>
> **Current routing:** Use [Reviewer Finder Enforcement Contracts](REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md)
> and [Sparse Proposal Anchor Strategy](REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md) for current policy.

> Status (updated S253, 2026-06-13): **SHIPPED.** The structured-ORCID PI wire-in described here
> is live — `resolveProposalPI` (`lib/services/proposal-pi-identity.js`) is called from
> `pages/api/reviewer-finder/discover.js` and drives PI exclusion + institution-COI. The live
> contract (fail-open, augment-only, `forenamesContradict` guard) is owned by
> `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` §4. Read the §2 "Current state" below as the
> pre-build baseline (historical). The deliberately-out-of-scope items (§8: PI-trail corpus lane,
> peer-group parsing, the two net-new COI gates) remain unbuilt.
> Author: Claude (S240, 2026-06-10). Canonical strategy: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12 (esp. §12.2, §12.8).
> Memories: [[project-reviewer-pi-identity-structured]], [[project-openalex-merge-use-orcid-works]],
> [[project-reviewer-origination-multilane]], [[project-reviewer-verify-fail-dangerous]].

## 1. Goal (the "quick win")

Make the proposal PI's identity in the live discovery pipeline come from the **structured Dataverse
record** (request → Project Leader contact → `wmkf_orcid` → exact OpenAlex author) instead of from
the **LLM-extracted, sometimes-hallucinated** `analysisResult.proposalInfo` fields. This improves
**PI exclusion + COI flagging everywhere** in `discover.js`, not just one lane.

This is the first increment of the §12 multi-lane origination work. It deliberately does **not** build
the PI-trail corpus lane, peer-group parsing, facet generation, or the two net-new COI gates
(advisor/advisee, all-time-collaborator) — see §8 Out of Scope.

## 2. Current state `[VERIFIED via source 2026-06-10]`

- **PI identity in discovery is client-supplied + LLM-derived.** `discover.js` req.body is
  `{ analysisResult, options, excludedNames }` (`pages/api/reviewer-finder/discover.js:79-89`) — **no
  `requestId`**. PI name + institution come only from `analysisResult.proposalInfo.proposalAuthors`
  and `.authorInstitution` (`discover.js:196,226`), which `analyze.js` extracts from proposal text.
  This is the path that misresolved "Wen Li" → "Yanping Li" and guessed "Wayne State" (§12.2).
- **Consumers of that identity `[VERIFIED via source — incl. Codex #1 catch]`:**
  1. `deriveProposalAuthorNames(proposalInfo)` → `DeduplicationService.filterProposalAuthors()` —
     hard name-fuzzy exclude of the PI/co-Is from candidates (`discover.js:196,201,326`;
     `deduplication-service.js:319-345`).
  2. `DeduplicationService.markInstitutionCOI(candidates, authorInstitution)` — **soft flag** (not
     exclude) of same-institution candidates (`discover.js:230,348`; `deduplication-service.js:265-309`).
  3. `DiscoveryService.checkCoauthorshipsForCandidates(candidates, proposalAuthors)` — PubMed
     coauthor COI (`discover.js:252`; `discovery-service.js:2207-2257`).
  4. **HARD institution drop (originally missed by this doc):** `DeduplicationService.filterConflicts(
     deduplicated, authorInstitution)` runs *inside* `DiscoveryService.discover()`
     (`discovery-service.js:259`) and **removes** Track-B candidates whose affiliation matches the LLM
     `authorInstitution` (`deduplication-service.js:filterConflicts` returns `false` → dropped). So
     institution COI is not purely a soft flag; part of it is a silent recall-affecting hard drop. This is
     the crux of the Chunk-1/Chunk-2 split (§9).
- **`requestId` is available client-side but not forwarded.** Workbench: `ReviewerSearchSection`
  prop, POSTs at `ReviewerSearchSection.js:559-577`. Standalone: `uploadedFiles[0]?.sourceProposal?.requestId`,
  POSTs at `reviewer-finder.js:966-978`. `save-candidates` and `load-proposal` already take `requestId`.
- **`discover.js` has no Dynamics context today** — it `requireAppAccess(req,res,'reviewer-finder','reviewers')`
  (`discover.js:52`) but never reads Dynamics. The pattern to add one is `enrich-recommended.js:124`:
  `await bypassDynamicsRestrictions('<label>', async () => { ... })`.
- **Structured path fields** `[VERIFIED via S239 probe + source]`: `akoya_request._wmkf_projectleader_value`
  (fallback `_wmkf_researchleader_value`) → `contact` with `wmkf_orcid`, `fullname`/`firstname`/`lastname`,
  `emailaddress1`. ORCID → exact OpenAlex author: `GET https://api.openalex.org/authors/https://orcid.org/<id>`.
- **Service gaps:** `OpenAlexService` has `searchAuthors / getWorkByExternalId / getWorkByTitle /
  getWorksByAuthor` but **no `getAuthorByOrcid`** (`lib/services/openalex-service.js`). `ORCIDService`
  has `searchByName / getProfile / findContact` but no works-list (`lib/services/orcid-service.js`).
- **Name-match helpers exist:** `ContactParser.stripHonorifics / normalizeNameForMatch / namesMatch`.

## 3. Design

### 3.1 `OpenAlexService.getAuthorByOrcid(orcid, opts)` — additive
- `GET ${OPENALEX_AUTHOR_BASE_URL}/https://orcid.org/<normalizedOrcid>` (single-object endpoint, not a
  `results` list). Reuse the existing `fetchJsonWithRetry` + `composeSignals` + `mailto` plumbing.
- Normalize the ORCID with the existing private `normalizeOrcid` (strip `https://orcid.org/`).
- Map via the existing `mapAuthorRecord` → `{ openAlexId, displayName, orcid, lastKnownInstitution,
  topics, worksCount }`.
- 404 / empty → return `null` (no record). Errors propagate like the other methods (caller catches).

### 3.2 New service `lib/services/proposal-pi-identity.js` → `resolveProposalPI(requestId, opts)`
Pure orchestration over Dynamics + OpenAlex. **Read-only.** Returns a small, explicit DTO; never throws
for "couldn't resolve" — only for programmer error.

Steps:
1. Read the request: `DynamicsService.getRecord('akoya_requests', requestId, { select:
   'akoya_requestid,_wmkf_projectleader_value,_wmkf_researchleader_value' })`.
   `plId = _wmkf_projectleader_value || _wmkf_researchleader_value`. None → `{ resolved:false,
   reason:'no_project_leader' }`.
2. Read the contact: `getRecord('contacts', plId, { select:
   'fullname,firstname,lastname,wmkf_orcid,emailaddress1' })`. `orcid = normalizeOrcid(wmkf_orcid)`.
   No ORCID → `{ resolved:false, reason:'no_orcid', contactName, emailDomain }` (inert fallback — §12.3).
3. `author = OpenAlexService.getAuthorByOrcid(orcid)`. No author → `{ resolved:false,
   reason:'orcid_not_in_openalex', orcid, contactName, emailDomain }`.
4. **Name cross-check guard (§12.2 residual risk):** compare contact name (`fullname`, else
   `firstname lastname`) against `author.displayName` via
   `ContactParser.namesMatch(normalizeNameForMatch(stripHonorifics(a)), normalizeNameForMatch(b))`.
   Mismatch → `{ resolved:false, reason:'name_mismatch', orcid, contactName,
   openAlexName: author.displayName, emailDomain }` — abstain, because a **mis-entered ORCID** on the
   contact would otherwise silently pin the wrong person (the exact fail-dangerous class in
   [[project-reviewer-verify-fail-dangerous]]).
5. Success → `{ resolved:true, orcid, openAlexAuthorId: author.openAlexId, canonicalName:
   author.displayName, contactName, institution: author.lastKnownInstitution, emailDomain }`.

`opts` carries `{ signal }` (the discover deadline signal) so a slow Dynamics/OpenAlex call can't blow
the budget. Wrap nothing in a bypass *inside* this service — the **caller** owns the bypass context so
the service stays context-agnostic and unit-testable.

### 3.3 Wire into `discover.js` — fail-open, **augment not replace**
- Accept optional `requestId` from req.body (back-compat: absent → behaves exactly as today).
- After `requireAppAccess`, if `requestId` is present, resolve PI identity once, early, inside a bypass:
  ```
  let piIdentity = null;
  if (requestId) {
    try {
      piIdentity = await bypassDynamicsRestrictions('reviewer-discover-pi-identity',
        () => resolveProposalPI(requestId, { signal: deadlineController.signal }));
    } catch (e) { /* log; piIdentity stays null → today's behavior */ }
  }
  ```
  Emit one `progress` event describing the outcome (`resolved` with canonical name/institution, or the
  `reason` when inert) — visibility without changing control flow.
- **Augment the consumers** (only when `piIdentity.resolved`; Chunk 1 = items 1 + 3, item 2 deferred):
  1. **Author exclusion + coauthor set:** add `piIdentity.canonicalName` to the `proposalAuthors` array
     before `filterProposalAuthors` and `checkCoauthorshipsForCandidates`. (Union with the LLM-derived
     names — never drop them; the canonical name fixes the case where the LLM name was wrong/missing.)
  2. **Institution COI — DEFERRED to Chunk 2 (Codex #1/#4/#8, §9).** Originally proposed here as a safe
     soft-flag union; review showed it entangles a *hard* drop (`filterConflicts`), an *overwrite* bug in
     `markInstitutionCOI`, a post-hoc recompute in `enrich-contacts`, and a recall **policy fork**. Out of
     Chunk 1. Chunk 1 leaves institution COI on the LLM `authorInstitution` **everywhere** (no drift).
  3. **Identity-level PI exclusion:** drop any candidate whose **resolved** `orcid`/`orcidId` or
     `openAlexId`/`openAlexAuthorId` equals the PI's — identity equality, never name equality
     (§12.4/§12.5 safety) — **gated on `identityStatus` confirmed/probable** (Codex #5: unresolved rows
     still carry these fields, so the gate is mandatory). Catches a PI who slipped the name-fuzzy filter.
- **Nothing is removed.** Every existing filter still runs on the existing inputs; the structured
  identity only *adds* names/institutions/identity-exclusions.

### 3.4 Plumb `requestId` from clients
- `ReviewerSearchSection.js:559-577` — add `requestId` (already a prop) to the POST body.
- `reviewer-finder.js:966-978` — add `uploadedFiles[0]?.sourceProposal?.requestId` to the POST body
  (may be undefined in pure-upload flows → server simply skips structured resolution).

### 3.5 Security / provenance
- The server derives identity from a **requestId** (an opaque identifier) via authenticated Dynamics
  reads — it never trusts a client-claimed identity. Consistent with "never accept profile/identity from
  request input when authenticated context supplies it." `requireAppAccess` already gates the route; the
  PI read is scoped to the request being worked on. (Q1: do we need to assert the caller has access to
  *that specific request*, or is app-level access sufficient as it is for the rest of discover today?)
- **No new provenance kind, no schema/migration, no new route.** `discover.js` stays in the security
  matrix as-is (body-param addition only); run `check:api-routes` to confirm.

## 4. Open questions for Codex (pre-impl) — ANSWERED, see §9 for verdicts/folds

- **Q1 (authz scope):** Is app-level `requireAppAccess('reviewer-finder','reviewers')` sufficient before
  reading this request's PI contact, or should we assert per-request access? Note the rest of `discover.js`
  already trusts the client-supplied proposal text for this request without a per-request check.
- **Q2 (name-guard strength):** Is OpenAlex `author.displayName` a strong enough cross-check against the
  contact name, or must we also hit `https://pub.orcid.org/v3.0/<id>/person` (the ORCID registry name) per
  §12.2? OpenAlex display names derive from the ORCID-linked identity, but can be a merged/variant form.
  Trade-off: one extra API call + latency vs. tighter mis-entered-ORCID protection.
- **Q3 (institution COI shape):** Best way to feed two institutions into `markInstitutionCOI` —
  (a) extend its signature to accept an array, (b) call it twice and OR `hasInstitutionCOI`, or (c) pass a
  combined string? Which preserves `institutionCOIDetails` cleanly and keeps parity with
  `enrich-recommended.js` (which also calls `markInstitutionCOI`)?
- **Q4 (identity-exclusion field names):** `[VERIFIED via discovery-service.js 2026-06-10]` resolved
  candidates carry BOTH naming variants depending on the path: `orcid` **and** `orcidId` (normalized;
  e.g. `discovery-service.js:868-870,1009-1011`), and `openAlexId` **and** `openAlexAuthorId`
  (`:871,898,1007`). They are populated **only for `identityStatus` confirmed/probable**; UNRESOLVED rows
  carry null. So identity-exclusion must compare on the **union** —
  `normalizeOrcid(c.orcid || c.orcidId)` and `(c.openAlexId || c.openAlexAuthorId)` — and will, by design,
  fire only for already-resolved candidates (the name-fuzzy filter still covers the rest). Confirming this
  lower-yield-but-correct degradation is acceptable for this increment.
- **Q5 (latency/budget):** Resolution adds up to 2 Dynamics reads + 1 OpenAlex call before discovery.
  Should it run **concurrently** with the first discovery step rather than serially, given the
  `reviewer.time_budget_seconds` deadline? Or is a serial pre-step fine (it's bounded and cached-ish)?
- **Q6 (enrich-recommended parity):** `enrich-recommended.js` runs the same COI gates and already has a
  bypass + `requestId`. Should this increment also wire `resolveProposalPI` there for parity (S213-style),
  or land it in `discover.js` first and follow up? Leaning follow-up to keep the chunk ≤ ~1100 lines.

## 5. Test plan
- Unit: `OpenAlexService.getAuthorByOrcid` (success / 404 / mailto / signal) with mocked `safeFetch`.
- Unit: `resolveProposalPI` — each branch (no PL, no ORCID, ORCID-not-in-OpenAlex, name-mismatch abstain,
  success) with mocked `DynamicsService` + `OpenAlexService`.
- Unit/integration: `discover.js` augmentation — resolved identity adds the canonical name to the author
  filter, ORs the institution COI, and identity-excludes a same-ORCID candidate; unresolved/no-requestId
  path is byte-for-byte today's behavior (fail-open).
- Gates: `npm run check:api-routes`; reviewer jest battery
  (`npx jest reviewer discovery suggestion disposition save-candidates search-logic`); `npm run build && npm run lint`.

## 6. Files touched
**Chunk 1 (this increment — identity + name + gated identity-exclusion; drift-free):**
- `lib/services/openalex-service.js` (+`getAuthorByOrcid`; reuse checksum-validating ORCID normalizer — Codex #12)
- `lib/services/proposal-pi-identity.js` (new; forename-gated guard via existing resolver/`getProfile` — Codex #3)
- `pages/api/reviewer-finder/discover.js` (accept+GUID-validate `requestId`, resolve, augment name set +
  gated identity-exclusion, abort-rethrow fail-open, durable `piIdentityStatus` in stats — Codex #5/#9/#13/#18)
- `pages/api/workbench/enrich-recommended.js` (same name augmentation for COI parity — Codex #7)
- `shared/components/reviewers/ReviewerSearchSection.js`, `pages/reviewer-finder.js` (send `requestId`)
- Tests under `tests/`.

**Chunk 2 (follow-up — institution COI overhaul; gated on the §9 policy decision):**
- `lib/services/deduplication-service.js` (multi-institution one-pass helper for both `markInstitutionCOI`
  AND `filterConflicts` — Codex #4), `discovery-service.js` (pass structured institution into `discover()`),
  `enrich-contacts.js` + its client (plumb structured institution so recompute can't clobber — Codex #8).

## 7. Rollback / safety
Fail-open at every step: missing `requestId`, missing PL, missing/invalid ORCID, name mismatch, or any
**non-abort** thrown error → `piIdentity = null` → the pipeline runs exactly as it does today.
**CORRECTION (Codex #1, #13 — see §9):** the earlier "worst case = over-flagging a soft flag" claim was
**wrong**. Institution COI is *partly a HARD drop* (`filterConflicts`, `discovery-service.js:259`), and the
fail-open `catch` must **rethrow** `AbortError` / `reviewer_time_budget_exceeded` rather than swallow them.
The real safety contract is in §9: name/identity augmentation is purely additive and safe; institution-COI
changes touch a hard filter and a recall policy fork and are therefore **deferred to Chunk 2**.

## 8. Out of scope (later §12 increments)
- ORCID works-list / PI-trail corpus lane and `referenced_works` expansion (would be unconsumed now).
- Peer-group parsing lane; topic→author-aggregation facet generation.
- The two net-new COI gates: advisor/advisee + all-time-collaborator (§12.7) — net-new design, not wiring.
- Recency-weighted ranking.
- Email-domain-based institution COI (a different mechanism than name-match `markInstitutionCOI`).

## 9. Codex pre-impl review — verdicts, folded changes, rescope (S240, 2026-06-10)

Codex's full review is in the session transcript (shared verbatim). Each finding independently verified
against source before folding. Verdict legend: ✅ confirmed-and-folded · ⚠️ confirmed-deferred-to-Chunk-2 ·
↔ partial/scoped · ℹ️ accepted-as-polish.

| # | Sev | Verdict | Resolution |
|---|---|---|---|
| 1 | HIGH | ✅ `[VERIFIED discovery-service.js:259]` | `filterConflicts` hard-drops on institution; the doc's "soft-flag only / can't regress" safety claim was **wrong**. §2, §3.3, §7 corrected. Institution COI → **Chunk 2**. |
| 2 | MED | ↔ Q1 | App-level `requireAppAccess` is the **existing** posture for every requestId-scoped reviewer route (org-open); Chunk 1 matches that posture and **documents it explicitly** rather than adding a per-request gate (that would be a broader policy change, not this increment). |
| 3 | HIGH | ✅ Q2 | Do **not** trust OpenAlex `displayName` alone. Guard uses ORCID `getProfile` name + the existing **forename gate** (`reviewer-identity-evidence`) before accepting the PI author. Abstain on mismatch. |
| 4 | HIGH | ⚠️ Q3 | `markInstitutionCOI` overwrites; calling twice loses an institution. Needs a **one-pass multi-institution helper** shared by `markInstitutionCOI` + `filterConflicts`. → **Chunk 2**. |
| 5 | HIGH | ✅ Q4 | Identity-exclusion **must** gate on `identityStatus` confirmed/probable before comparing id union (unresolved rows carry the fields). Folded into §3.3 item 3. |
| 6 | MED | ✅ Q5 | Start the deadline timer **before** PI resolution; keep resolution bounded + abort-aware. Folded with #13. |
| 7 | HIGH | ✅ Q6 | Deferring `enrich-recommended` would create COI drift on the **name** axis too. Chunk 1 now wires the name augmentation into `enrich-recommended.js` for parity. |
| 8 | HIGH | ⚠️ | `enrich-contacts.js:143-148` recompute would clobber a structured-PI institution flag. Since institution COI is Chunk 2, the clobber is moot in Chunk 1 (institution stays LLM-based everywhere). Fixed **with** the Chunk-2 institution work, not before. |
| 9 | MED | ✅ | Validate `requestId` as a GUID; emit an explicit inert-reason SSE event instead of swallowing malformed input. |
| 10 | MED | ✅ | `getAuthorByOrcid` is genuinely new; tests must cover single-object, unexpected `results` wrapper, 404→null, URL construction (encoded vs raw embedded ORCID URL), redirect. |
| 11 | MED | ✅ | Pin the exact `/authors/https://orcid.org/<id>` URL form in a unit test before prod reliance. |
| 12 | MED | ✅ | Reuse the **checksum-validating** ORCID normalizer (`reviewer-work-author-resolver`), not the prefix-strip-only one, before building the lookup URL / comparing identities. |
| 13 | HIGH | ✅ | Fail-open `catch` must **rethrow** `AbortError` / `reviewer_time_budget_exceeded`; only swallow resolution misses + outages. §7 corrected. |
| 14 | MED | ⚠️ | Prefer structured-request / ORCID-current affiliation over OpenAlex stale `last_known_institutions[0]`. Relevant only once institution COI lands → **Chunk 2**. |
| 15 | MED | ✅ | Test that canonical PI name is **appended + de-duped** into `deriveProposalAuthorNames()` output, never replacing PI + co-Is. |
| 16 | MED | ↔ | `checkCoauthorshipsForCandidates` has no `signal` today (pre-existing). Threading it is real but a **separate** budget-hardening item; noted, not bundled into Chunk 1 to keep the chunk focused. |
| 17 | LOW | ✅ | Use existing `ORCIDService.getProfile` for the PI name/affiliation guard (with #3) instead of a brand-new ORCID method. |
| 18 | INFO | ✅ | Add a non-sensitive `piIdentityStatus` + reason to the final `stats` SSE event for post-stream observability. |

### Rescope (the material change)
The "quick win" splits into two chunks because institution COI is entangled with a **hard recall-affecting
drop** across three routes plus an overwrite bug:

- **Chunk 1 — PI identity + name exclusion (safe, drift-free, this increment):** `getAuthorByOrcid` +
  `resolveProposalPI` (forename-guarded) + `discover.js`/`enrich-recommended.js` name augmentation +
  gated identity-exclusion + `requestId` plumbing + abort-safe budget + observability + tests. **Purely
  additive** to exclusion; cannot reduce recall; institution COI untouched and identical everywhere.
- **Chunk 2 — institution COI overhaul (follow-up, needs the policy decision below):** one-pass
  multi-institution helper for `markInstitutionCOI` + `filterConflicts`, structured institution into
  `discover()` + `enrich-contacts` + `enrich-recommended`, ORCID-current affiliation preference.

### Codex POST-impl review of Chunk 1 (commit 70e78f0) — verdicts & follow-up fold
All verified against the committed code; folded in a follow-up commit (not an amend).
- **#1 HIGH — abort/budget not honored inside `resolveProposalPI`.** ✅ Real. The budget
  could fire during a Dynamics read and the inert `{resolved:false}` would mask it. Added a
  `throwIfAborted(signal)` guard after each Dynamics await.
- **#2 HIGH — fail-dangerous missing-name path.** ✅ Real and important. `nameGuardPasses`
  returned `true` when a name was missing → a mis-entered ORCID on a blank-name contact
  would resolve as a confirmed wrong PI. Replaced with `evaluateNameGuard`, which **abstains
  (`name_uncheckable`)** when the contact has no usable name OR no authoritative name source.
- **#3 MED — ORCID-registry name check (pre-impl #3/#17).** ✅ Folded. The guard now also
  checks the **ORCID-registry name** (`ORCIDService.getProfile`, best-effort: missing creds /
  404 / non-abort error → skip; abort rethrown) as a second authoritative source; a candidate
  must agree with EVERY available name. (Best-effort, so it adds defense without a new hard
  dependency.) Also extracted `appendPiName` so the append+dedup is unit-tested (#15) and shared
  by discover + enrich-recommended instead of duplicated.
- Tests added: `name_uncheckable`, in-resolver abort rethrow, registry-name contradiction,
  `appendPiName` (4), getAuthorByOrcid signal-threading. 39 new-unit + 550 reviewer-battery green.

### Chunk-2 policy — RESOLVED by Justin (S240) — see [[project-reviewer-coi-rely-on-self-disclosure]]
The "hard-drop vs flag" framing was mostly a non-issue: S238 already sanctions same-institution as a
correct hard drop ([[project-reviewer-recall-over-precision]]:36-38). Justin's S240 decisions:
- **CURRENT same-institution → keep the hard drop**, but fix the input: feed the accurate **structured**
  PI institution into `filterConflicts` instead of the hallucinated LLM one. Net recall *gain* (stops
  dropping at a wrongly-guessed institution; catches the real same-institution COIs it misses today).
- **HISTORICAL / former-shared institution → does NOT count.** Neither drop nor flag. This **removes**
  shipped S229 behavior: `markInstitutionCOI`'s `affiliationHistory` scan, `institutionCOIDetails.historical`,
  and the "Former shared institution" badge (verify live callers before deleting — touches the Workbench +
  standalone cards + save path + `enrich-contacts` recompute).
- **General rule:** don't emit PD-unverifiable soft flags — PDs don't re-verify them and the product's job
  is to *cut* manual searching. Relationship/inferred conflicts are handled by reviewer **self-disclosure**
  at accept/decline, not by system flags.

**Boundary RESOLVED (Justin S240); both chunks now SHIPPED (2a S240, 2b S254):** (1) **retire** the model `POTENTIAL_CONCERNS` amber advisory (S229) —
it's the canonical PD-unverifiable inferred flag (remove capture/render/persist + reseed the prompt to drop
the COI→POTENTIAL_CONCERNS instruction); (2) **keep** co-author COI grading — shared-paper counts are
factual/verifiable. So Chunk 2 = {structured institution into the current-institution hard drop; remove
historical-institution COI; retire POTENTIAL_CONCERNS; keep co-author COI}. Chunk 1 is unaffected.
