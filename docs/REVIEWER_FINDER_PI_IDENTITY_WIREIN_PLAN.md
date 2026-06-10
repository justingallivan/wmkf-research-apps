# Reviewer Finder — Structured-ORCID PI Identity Wire-In (Design / Pre-Impl)

> Status: **DESIGN — pre-impl, for Codex review. NOT BUILT.**
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
- **Three consumers of that identity in `discover.js`:**
  1. `deriveProposalAuthorNames(proposalInfo)` → `DeduplicationService.filterProposalAuthors()` —
     hard name-fuzzy exclude of the PI/co-Is from candidates (`discover.js:196,201,326`;
     `deduplication-service.js:319-345`).
  2. `DeduplicationService.markInstitutionCOI(candidates, authorInstitution)` — **soft flag** (not
     exclude) of same-institution candidates (`discover.js:230,348`; `deduplication-service.js:265-309`).
  3. `DiscoveryService.checkCoauthorshipsForCandidates(candidates, proposalAuthors)` — PubMed
     coauthor COI (`discover.js:252`; `discovery-service.js:2207-2257`).
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
- **Augment the three consumers** (only when `piIdentity.resolved`):
  1. **Author exclusion + coauthor set:** add `piIdentity.canonicalName` to the `proposalAuthors` array
     before `filterProposalAuthors` and `checkCoauthorshipsForCandidates`. (Union with the LLM-derived
     names — never drop them; the canonical name fixes the case where the LLM name was wrong/missing.)
  2. **Institution COI:** call `markInstitutionCOI` with the **union** of `{ authorInstitution (LLM),
     piIdentity.institution (OpenAlex last-known) }`. Because institution COI is a *soft flag*, adding a
     second institution only ever flags **more** candidates for human review — safe, and it recovers the
     case where the LLM institution was hallucinated/missing. (Needs `markInstitutionCOI` to accept
     multiple institutions, or to be called twice and OR the flags — see Q3.)
  3. **Identity-level PI exclusion:** drop any candidate whose **resolved** `orcid` or
     `openAlexAuthorId` equals the PI's — identity equality, never name equality (§12.4/§12.5 safety).
     This catches a PI who slipped the name-fuzzy filter (e.g. name variant) but is identity-resolved.
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

## 4. Open questions for Codex (pre-impl)

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
- `lib/services/openalex-service.js` (+`getAuthorByOrcid`)
- `lib/services/proposal-pi-identity.js` (new)
- `pages/api/reviewer-finder/discover.js` (accept `requestId`, resolve, augment 3 consumers)
- `lib/services/deduplication-service.js` (`markInstitutionCOI` multi-institution, pending Q3)
- `shared/components/reviewers/ReviewerSearchSection.js`, `pages/reviewer-finder.js` (send `requestId`)
- Tests under `tests/`.

## 7. Rollback / safety
Fail-open at every step: missing `requestId`, missing PL, missing/invalid ORCID, name mismatch, or any
thrown error → `piIdentity = null` → the pipeline runs exactly as it does today. The structured identity
can only add exclusions/flags, never remove an existing one, so the worst-case regression is
**over-flagging institution COI** (a soft, human-reviewed flag), not a missed COI or a wrong hard-exclude.

## 8. Out of scope (later §12 increments)
- ORCID works-list / PI-trail corpus lane and `referenced_works` expansion (would be unconsumed now).
- Peer-group parsing lane; topic→author-aggregation facet generation.
- The two net-new COI gates: advisor/advisee + all-time-collaborator (§12.7) — net-new design, not wiring.
- Recency-weighted ranking.
- Email-domain-based institution COI (a different mechanism than name-match `markInstitutionCOI`).
