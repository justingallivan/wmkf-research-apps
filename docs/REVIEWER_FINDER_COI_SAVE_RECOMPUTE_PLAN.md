---
title: Reviewer Finder — Save-Time Institution-COI Server Recompute (F2 + F4)
domain: reviewer-origination
kind: plan
status: active
summary: "Implemented F2/F4 save-time institution COI recompute and fail-closed applicant-alias context."
---

# Reviewer Finder — Save-Time Institution-COI Server Recompute (F2 + F4) — Implemented Plan

> Author: Claude (senior-architect pass, 2026-07-06). Status: IMPLEMENTED 2026-07-06.
> Addresses adversarial-review findings **F2** (client-flag-driven save COI gate is bypassable) and
> **F4** (swallowed applicant-alias fetch silently weakens every hard COI check).
> Implementation note: `save-candidates-service.js` now loads `loadCoiContext(...,
> includeCoPIs:false, requireCompleteInstitutions:true)`, calls `lookupReviewerIdentity` before the
> COI gate and before upsert, recomputes `DeduplicationService.institutionCOIDecision` using payload
> affiliation signals plus server-known CRM affiliation from the reviewer persistence will REUSE, and
> fails closed with 503 when complete applicant institution context is unavailable.
> [RECHECKED after lib/services/reviewer-finder/save-candidates-service.js change: the CRM-affiliation
> source was hardened post-build to match the EXACT reviewer identity persistence reuses — `getByEmail`
> for the email-reuse path (no seed anchor) and the confident anchor lookup for a seed anchor —
> INDEPENDENT of the identity-lookup shape (confident/candidates/linked/conflict/none/thrown). §11 is
> the authoritative description of the save-time recompute; treat any earlier "confident"-only or
> lookup-shape phrasing in §3.3 as superseded by §11.]
> All `file:line` citations were verified by reading the working tree on 2026-07-06. NOTE:
> `lib/services/reviewer-request-context.js` citations refer to the **uncommitted working-tree
> version** (the in-flight chunk-1 `applicantInstitutionNames` change) — see §8 Stage 0.
>
> **Historical pre-implementation note:** at plan-writing time local `main` was behind
> `origin/main` (five commits by `git rev-list --left-right --count main...origin/main` → `0 5`,
> probe run 2026-07-06). The implementation pass ran on the rebased feature branch named in the
> task handoff and re-verified the relied-on anchors against current source before editing.

---

## 1. Problem statement (F2): the "authoritative" save gate trusts client flags

`POST /api/reviewer-finder/save-candidates` is the persistence boundary for discovered reviewer
candidates. The route is a thin shell: `requireAppAccess`
[VERIFIED via pages/api/reviewer-finder/save-candidates.js:29], destructure of `req.body` including
the full `candidates` array [VERIFIED via save-candidates.js:34-41], presence-only validation of
`requestId` [VERIFIED via save-candidates.js:43-45 — **no `isGuid` check on this route today**],
then `withDalContext('save-candidates', ...)` around the single service call
[VERIFIED via save-candidates.js:52-62].

Inside the service, the institution-COI gate is
`lib/services/reviewer-finder/save-candidates-service.js:212-232` [VERIFIED via read]:

```js
// save-candidates-service.js:222-224
const enrichmentInstitutionCOI = candidate.contactEnrichment?.coiRecomputed
  && !!candidate.contactEnrichment?.hasInstitutionCOI;
if (candidate.hasInstitutionCOI || enrichmentInstitutionCOI) { /* reject */ }
```

Both inputs — `candidate.hasInstitutionCOI` and `candidate.contactEnrichment.{coiRecomputed,
hasInstitutionCOI}` — are properties of the candidate object, which arrives verbatim from
`req.body.candidates` [VERIFIED via save-candidates.js:39]. The comment at
`save-candidates-service.js:215-216` claims this is "the authoritative gate — so it can never be
saved even if a stale client selected it", but that is only true when the flag is *present*. The
gate never recomputes COI server-side; there is no other institution-COI check anywhere between
the gate and the Dataverse writes [VERIFIED via full read of save-candidates-service.js:184-505].

**Bypass paths (all reach the Dataverse writes at `save-candidates-service.js:386-393`
(`potentialReviewerAdapter.upsertByEmail`), `:440-461` (researcher overlay), `:477-488`
(suggestion upsert)):**

1. **Direct authenticated POST omitting the flags.** Any user who passes
   `requireAppAccess('reviewer-finder', 'reviewers')` can POST
   `{ requestId, candidates: [{ name, affiliation: "<PI's institution>", email }] }`. With no
   `hasInstitutionCOI` and no `contactEnrichment`, the gate at `:224` evaluates false and the
   candidate is upserted as a potential reviewer + suggestion for the request.
2. **Stale client roster.** A candidate selected before discovery's COI pass, or reloaded from the
   durable Find-tab roster after pruning (pruning of enrichment objects is acknowledged at
   save-candidates-service.js:357-361 — "identity/tierResults pruned away"), can arrive without
   the flags.
3. **Failed/partial enrichment.** `coiRecomputed` is only set when the enrich-contacts recompute
   actually ran [VERIFIED via pages/api/reviewer-finder/enrich-contacts.js:175]; the recompute is
   skipped entirely when no COI institutions are known [VERIFIED via enrich-contacts.js:160-161]
   and PI resolution there is fail-open [VERIFIED via enrich-contacts.js:141-149]. A candidate
   whose enrichment promoted a same-institution current affiliation but whose recompute never ran
   carries no flag.

The identity hard-reject directly above the COI gate recognizes exactly this threat model for
identity ("the standalone Reviewer Finder and any bypassed/direct caller can still POST them, so
the field-level gate alone is insufficient" [VERIFIED via save-candidates-service.js:73-75]) but
the institution-COI gate was never given the same server-side treatment.

**Policy context:** same-institution is a **HARD** policy conflict at save
[VERIFIED via save-candidates-service.js:212-213], and PD identity confirmation explicitly does
**not** waive it ("Institution-COI is still enforced (identity confirmation ≠ COI waiver)"
[VERIFIED via save-candidates-service.js:194]). So the recompute below must apply to `pdConfirmed`
rows too.

## 2. Problem statement (F4): swallowed applicant-alias fetch weakens the server institution set

The in-flight chunk-1 change to `lib/services/reviewer-request-context.js` builds the server-owned
applicant-institution alias set `applicantInstitutionNames` — dedup of the request's formatted
applicant lookup name + `wmkf_organizationname` + the applicant account's `name` / `akoya_aka` /
`wmkf_legalname` [VERIFIED via reviewer-request-context.js:90-96 (working tree); select list at
:32]. But the account fetch is non-fatal: any failure is swallowed and the projection silently
falls back to the formatted request names only [VERIFIED via reviewer-request-context.js:122-131]:

```js
// reviewer-request-context.js:126-130 (working tree)
try {
  applicantAccount = await accountAdapter.getById(applicantId, { select: APPLICANT_ACCOUNT_SELECT });
} catch {
  applicantAccount = null;
}
```

For *analysis prompt context* that fallback is acceptable (best-effort exclusion hint). But once
this alias set is the single server-owned source for the **hard** save-time COI gate, a transient
Dataverse failure would silently shrink the institution set — a reviewer whose affiliation matches
only `akoya_aka` (the account's common/short name form
[VERIFIED via the reviewer-request-context.js:28-31 source comment]) but not the formatted name
would pass a gate we claim is hard. The caller cannot currently distinguish "no applicant account
on this request" from "account exists but fetch failed".

## 3. Target design

### 3.1 Principle: two-tier server institution set, fail-closed on the Dataverse tier

The server-owned institution set for save-time COI has two tiers with different availability
semantics:

| Tier | Source | Availability semantics at save |
|---|---|---|
| **Authoritative (Dataverse)** | Request formatted applicant name + `wmkf_organizationname` + applicant-account `name`/`akoya_aka`/`wmkf_legalname` [VERIFIED via reviewer-request-context.js:90-96] | **Fail closed.** Save already requires Dataverse for its writes; if this tier cannot be loaded per the §5 completeness rules, the batch does not save. |
| **Additive (external)** | Structured-PI union `piInstitutions(pi, …)` — ORCID-current + OpenAlex last-known [VERIFIED via lib/services/proposal-pi-identity.js:287-308], resolved via `resolveProposalPI` [VERIFIED via proposal-pi-identity.js:130-233; ORCID/OpenAlex network calls at :183, :198] | **Fail open.** A transient OpenAlex/ORCID outage must not block saving; discover and enrich already treat PI resolution as fail-open [VERIFIED via pages/api/reviewer-finder/discover.js:174-195; enrich-contacts.js:141-149]. When this tier is absent, the authoritative tier still enforces the applicant institution itself; a PI holding an appointment at a *different* institution than the applicant is the accepted residual for that window (§7.9). |

This deliberately does **not** make the hard save gate depend on external-API availability, while
still recomputing against the widest set available at save time. The LLM-extracted
`authorInstitution` third leg of the discover/enrich union [VERIFIED via discover.js:218;
enrich-contacts.js:139] is *not* re-derived at save — its Dataverse equivalent (the formatted
applicant name [VERIFIED via reviewer-request-context.js:83-86]) is already inside the
authoritative tier.

### 3.2 `loadCoiContext` — shape and placement decision

**Decision: `loadCoiContext` lives in `lib/services/reviewer-request-context.js`.**

Rationale:
- `reviewer-request-context.js` already owns the request-scoped server context: GUID validation
  [VERIFIED via :107-111, throws 400], the request read [VERIFIED via :112-117, throws 404], co-PI
  fetch [VERIFIED via :118], and the applicant alias set [VERIFIED via :90-96]. `loadCoiContext`
  is a composition of that plus the PI resolver.
- `proposal-pi-identity.js` is deliberately a leaf: CommonJS, READ-ONLY, context-agnostic,
  never-throws-for-unresolved [VERIFIED via proposal-pi-identity.js:12-20 header contract].
  Putting a Dataverse-request-context loader inside it would invert its dependency posture.
  `reviewer-request-context.js` (ESM) can import the CJS `proposal-pi-identity` module in the same
  direction `discover.js:27` and `lib/services/workbench/enrich-recommended-service.js:29` already
  do [VERIFIED via those import lines].

**Signature and return shape (PLANNED):**

```js
// lib/services/reviewer-request-context.js (new export) — PLANNED
export async function loadCoiContext(requestId, { signal, resolvePi = true, requireCompleteInstitutions = false } = {})
// → {
//   requestContext,            // projectReviewerRequestContext output (title, PI name, co-Is,
//                              //   applicantInstitutionNames, …)
//   institutionContext: {
//     state: 'complete' | 'fallback',   // §5 — typed F4 state
//     names: string[],                  // authoritative Dataverse tier (alias set)
//     applicantAccountId: string|null,  // GUID when the request has an applicant lookup
//     fetchError: string|null,          // populated in 'fallback' state
//   },
//   piIdentity,                // resolveProposalPI() result, or { resolved:false, reason } —
//                              //   best-effort; never blocks (fail-open, abort rethrown as today)
//   people: {                  // for callers that also need author-name exclusion
//     principalInvestigator: string|null,
//     coInvestigators: string[],
//   },
//   institutionEntries,        // UNION for matching: piInstitutions(piIdentity, null) objects
//                              //   + institutionContext.names strings, deduped. Mixed array is
//                              //   safe — both institutionInput and institutionDisplayName accept
//                              //   string OR object [VERIFIED via deduplication-service.js:514-516, :488-491]
// }
```

- **Caching:** none inside the helper. Each route/service invocation calls it **once** and threads
  the result down (the save path calls it once per batch, before the candidate loop). A
  module-level cache would be a cross-request staleness hazard in a serverless runtime for zero
  measurable win. This matches how discover/enrich already call `resolveProposalPI` /
  `loadReviewerRequestContext` once per invocation [VERIFIED via discover.js:182-185;
  enrich-recommended-service.js:123, :203].
- **DAL context:** `loadCoiContext` performs Dataverse reads via the adapters and therefore
  ASSUMES a trusted DAL context, same as the rest of the service layer
  [VERIFIED via save-candidates-service.js:27 header]. It does **not** open its own context. The
  save route already wraps the entire service call in `withDalContext('save-candidates', …)`
  [VERIFIED via save-candidates.js:52], so all new reads run inside it — satisfying the CLAUDE.md
  invariant that entity access runs inside a trusted context. (Contrast: discover has no ambient
  context and wraps PI resolution itself [VERIFIED via discover.js:182-185]; callers own the
  context per the proposal-pi-identity.js:18-20 contract.)
- **GUID validation:** `loadCoiContext` delegates to `loadReviewerRequestContext`, which rejects a
  non-GUID `requestId` with a 400 [VERIFIED via reviewer-request-context.js:107-111 using
  `isGuid`]. This *adds* GUID validation to the save path (today the route checks presence only
  [VERIFIED via save-candidates.js:43-45]), aligning with the `check:trust-boundary-guid` gate
  [VERIFIED via package.json:68]. No other client-supplied id is used as a Dataverse selector by
  this change.

### 3.3 The recompute in the save flow — exact insertion points

**A. Batch level — in `saveCandidates()` (`save-candidates-service.js:166`), before the
`for (const rawCandidate of candidates)` loop at `:184`:**

```js
// PLANNED
const coiContext = await loadCoiContext(requestId, { requireCompleteInstitutions: true }); // throws per §5
const coiEntries = coiContext.institutionEntries.map((inst) => ({
  raw: inst,
  display: DeduplicationService.institutionDisplayName(inst),
  identity: DeduplicationService.institutionInput(inst),
}));
```

The `{raw, display, identity}` wrapping is exactly what `partitionConflicts` builds before calling
the per-candidate decision [VERIFIED via lib/services/deduplication-service.js:363-369;
`markInstitutionCOI` does the same at :279-283]. Prefer adding a tiny static
`DeduplicationService.wrapPiInstitutions(list)` used by all three call sites — but only if the
diff stays trivially behavior-preserving; otherwise inline the map (simplest-thing rule).

**B. Candidate level — replace the gate body at `save-candidates-service.js:222-232`:**

```js
// PLANNED
// Client flags remain as a tightening-only fast path (a client that KNOWS it has COI
// is always rejected, even if the server's affiliation view is thinner):
const enrichmentInstitutionCOI = candidate.contactEnrichment?.coiRecomputed
  && !!candidate.contactEnrichment?.hasInstitutionCOI;
// NEW — authoritative server recompute from the candidate's own affiliation signals:
const serverCoi = coiEntries.length
  ? DeduplicationService.institutionCOIDecision(candidate, coiEntries)
  : null;
if (candidate.hasInstitutionCOI || enrichmentInstitutionCOI || serverCoi) {
  rejectedInstitutionCOI += 1;
  errors.push({ name: candidate.name, error: …, code: 'institution_coi',
                serverRecomputed: !!serverCoi });   // additive key; existing keys unchanged
  continue;
}
```

Placement stays exactly where the current gate is — after the identity hard-reject (`:202-210`),
before `resolveValidatedReferredSeedAnchor` (`:243-249`) and before the first adapter write
(`potentialReviewerAdapter.upsertByEmail`, `:386-393`) — so no write of any kind precedes the
recompute [VERIFIED via read of the full loop body :184-505]. It applies to `pdConfirmed` rows too
(no `pdConfirmed` bypass in this block), preserving the `:194` "COI is not waived by identity
confirmation" invariant.

**Why `institutionCOIDecision` and not `institutionsMatchForCOI` directly:** the decision helper
[VERIFIED via deduplication-service.js:620-688] already implements the whole vetted policy stack:
- it reads the candidate's affiliation from every server-visible field —
  `candidate.affiliation || candidate.primaryAffiliation || contactEnrichment.affiliation` plus the
  ORCID-current and OpenAlex-current enrichment signals with their OpenAlex/ROR ids
  [VERIFIED via `institutionSignalsForCandidate`, deduplication-service.js:565-618, building on
  `institutionInputForCandidate`, :535-555];
- it matches with the deliberately strict COI matcher (`institutionsMatchForCOI`,
  [VERIFIED via :816-853] — id-equality first, no bare containment, no similarity fallback);
- it prefers id-matched and high-trust-source matches [VERIFIED via :638-655].

This is the "prefer the most authoritative server-resolved affiliation available" requirement: the
decision helper consumes the enrichment-resolved (ORCID/OpenAlex, id-bearing) signals ahead of the
free-text `candidate.affiliation` when both exist.

**`dropDecision: 'flagged'` handling — reject.** The Phase-C "flagged" branch (single low-trust
affiliation contradicted by high-trust current evidence [VERIFIED via
deduplication-service.js:657-661]) exists so *discovery* can surface a contested match to the PD
instead of silently dropping it [VERIFIED via discover.js:332-341]. But at save, the *current*
behavior already rejects such rows: both `markInstitutionCOI` [VERIFIED via :295-299] and
`institutionCOIDecision` [VERIFIED via :675-677] set `hasInstitutionCOI: true` on flagged
candidates, and the existing gate at `save-candidates-service.js:224` rejects on that flag with no
dropDecision distinction. Treating any non-null decision as a reject is therefore
behavior-preserving and strictly stronger — and matches the stated policy ("current
same-institution is a HARD policy conflict at save", `:212-213`). The PD's remedy for a contested
flag is to correct the candidate's affiliation evidence, not to save through the conflict.

**Candidate with no affiliation signal at all:** `institutionSignalsForCandidate` returns `[]` and
the decision is `null` [VERIFIED via deduplication-service.js:621-622] → the candidate saves
(assuming no client flag). This is deliberate and matches every existing COI surface (discover,
enrich, recommended all no-op on unknown affiliation). Rejecting affiliation-less candidates would
regress a legitimate population; the residual is bounded in §7. "Fail closed" in this plan applies
to the **context** side (§5), not to per-candidate missing data.

## 4. Applicant-RECOMMENDED reviewers — explicitly not regressed

Applicant-recommended reviewers do **not** flow through `save-candidates` at all
[VERIFIED via save-candidates-service.js:217-218 comment, corroborated below]:

- Their COI treatment is FLAG-not-drop by decision S240 D3, applied in
  `lib/services/workbench/enrich-recommended-service.js` — `markInstitutionCOI(coiChecked,
  recInstitutions)` flags and filters nothing [VERIFIED via enrich-recommended-service.js:214-221].
- Their promotion path is `POST /api/workbench/promote-applicant-reviewer`, which updates the
  existing suggestion row via `updateLifecycle` — "No `save-candidates` path"
  [VERIFIED via docs/API_ROUTE_SECURITY_MATRIX.md:203].

**This plan touches neither surface.** The new recompute lives only in
`save-candidates-service.js`; `enrich-recommended-service.js` and `promote-applicant-reviewer` are
unchanged. Whether promotion should get its own recompute is a separate policy decision (out of
scope, §7.8) because D3 deliberately lets the PD accept a flagged applicant pick.

## 5. F4 — typed COMPLETE-vs-FALLBACK institution context, and the fail-closed rule

### 5.1 Typed state (in `reviewer-request-context.js`)

`loadReviewerRequestContext` / `projectReviewerRequestContext` gain a typed institution-context
state alongside the existing `applicantInstitutionNames` array (which stays, unchanged, for the
analyze-prompt consumer — additive change only):

- **`complete`** — either (a) the request has no applicant lookup / no valid applicant GUID
  (`request._akoya_applicantid_value` empty or `!isGuid` [VERIFIED via
  reviewer-request-context.js:124-125]), so the formatted names ARE the full knowable set; or
  (b) the applicant account fetch succeeded and `name`/`akoya_aka`/`wmkf_legalname` were folded in.
- **`fallback`** — a valid applicant GUID exists but the account fetch failed (the `catch` at
  `:128-130`); names are formatted-request-only and the alias set is known-incomplete.
  `fetchError` carries the message for the save-path error body and logs.

Implementation shape: the swallowed `catch` at `:128-130` records
`{ state: 'fallback', fetchError }` instead of only nulling; `projectReviewerRequestContext`
surfaces `applicantInstitutionContext = { state, names, applicantAccountId, fetchError }`.
Existing consumers read `applicantInstitutionNames` and are untouched.

### 5.2 Fail-closed rule for COI-sensitive save

Implemented in `loadCoiContext` behind `requireCompleteInstitutions: true` (keeps the policy
reusable if another hard-enforcement caller appears):

1. Request read failure / not found → propagate today's 400/404
   [VERIFIED via reviewer-request-context.js:103-117]. The batch does not save.
2. `institutionContext.state === 'fallback'` → **retry the account fetch once** (single immediate
   retry inside `loadReviewerRequestContext`'s fetch block — cheap, covers transient blips). Still
   failing → **fail closed**: throw
   `new ServiceHttpError('COI context unavailable', { httpStatus: 503, body: { error: 'Could not
   load the applicant institution record needed for conflict screening. Nothing was saved —
   please retry.', retryable: true } })` before the candidate loop. Zero writes have happened at
   that point. The shell already maps any `ServiceHttpError` to
   `status(error.httpStatus).json(error.body)` [VERIFIED via save-candidates.js:65-67], so no
   route change is needed for the new 503. It is a new envelope alongside the contractual 422/500
   bodies [VERIFIED via save-candidates-service.js:510-534]; those existing envelopes stay
   byte-for-byte unchanged.
3. `state === 'complete'` with no applicant account existing → proceed; the formatted names are
   the whole truth for that request. **Do not** claim the stronger alias guarantee in docs for
   such requests — the guarantee is "matches no *known* applicant institution name".
4. PI-resolution failure (`resolveProposalPI` non-abort error / `resolved:false`) → proceed with
   the authoritative tier only (fail-open per §3.1), mirroring discover.js:186-195.

Analyze/discover/enrich continue to consume the alias set best-effort (their current semantics);
only the save path opts into the fail-closed rule. That is the correct asymmetry: the earlier
stages are slot/UX optimizations, the save is the enforcement boundary (§10).

## 6. Repo-invariant compliance checklist

- **No identity from request input where authenticated context supplies it** (CLAUDE.md Universal
  Safety Invariants): unchanged — `actingUserSystemId` still comes from the session
  [VERIFIED via save-candidates.js:32]. The change *reduces* trust in request input (COI flags
  demoted from authoritative to tightening-only).
- **Trusted DAL context for all Dataverse access:** all new reads (request, co-PIs, account, and
  the contact read inside `resolveProposalPI`) execute inside the route's existing
  `withDalContext('save-candidates', …)` [VERIFIED via save-candidates.js:52]; the service keeps
  its "ASSUMES a trusted DAL context" contract [VERIFIED via save-candidates-service.js:27]. No
  new `withDalContext`/bypass sites are introduced.
- **GUID validation of client-supplied selectors:** `requestId` (the only client id this change
  uses as a selector) is validated by `isGuid` inside `loadReviewerRequestContext`
  [VERIFIED via reviewer-request-context.js:107-111]. Run `npm run check:trust-boundary-guid` and
  its self-test sequentially [VERIFIED via package.json:68-69] after the change.
- **Security matrix:** update the existing row for `/api/reviewer-finder/save-candidates`
  [VERIFIED via docs/API_ROUTE_SECURITY_MATRIX.md:189] to note the server-side COI recompute + 503
  fail-closed context rule. No auth change (`requireAppAccess('reviewer-finder', 'reviewers')`
  stays).
- **Minimal change:** no refactor of discover/enrich in this change (adoption of `loadCoiContext`
  there is a follow-up, §8 Stage 4); no changes to `enrich-recommended-service.js`,
  `promote-applicant-reviewer`, `deduplication-service.js` matching logic, or the partial-success
  envelope shapes clients depend on [VERIFIED contract via save-candidates-service.js:11-22].

## 7. Risks and residual gaps

1. **Affiliation-string quality → false negatives.** `institutionsMatchForCOI` is deliberately
   strict (no containment, no similarity fallback [VERIFIED via deduplication-service.js:812-816
   docblock + :816-853 body]), so a free-text candidate affiliation ("Dept. of Chemistry, 77 Mass
   Ave" style) can fail to match a real same-institution case. Bounded by: (a) the discover-time
   hard drop and enrich-time recompute still run upstream with richer id-bearing signals; (b)
   client flags are retained as a tightening-only input, so anything upstream caught still rejects
   at save; (c) id-based matching (OpenAlex/ROR) engages whenever enrichment attached ids. Residual
   accepted: a hand-crafted direct POST with a deliberately obfuscated affiliation string can evade
   the name matcher — the gate is policy enforcement against stale/buggy clients and honest-user
   drift, not a cryptographic boundary against a malicious *authorized* staff user (who could
   equally enter the reviewer in Dynamics directly).
2. **`akoya_aka` short-form false positives.** Short common-name aliases entering the match set
   could over-reject (an alias that key-word-normalizes identically to a different institution's
   name). Bounded by the strict matcher (equal sorted key-word sets or narrow-campus-qualifier
   only [VERIFIED via deduplication-service.js:842-850]; `isInverseUniversityName` guard at :846)
   and by the tight alias source (three specific account fields
   [VERIFIED via reviewer-request-context.js:32]). Mitigation: the reject error row carries
   `serverRecomputed: true`; add a structured `console.warn` with
   `institutionCOIDetails.{piInstitution, matchedAffiliationSource}` on every server-recomputed
   reject so over-rejection is visible in logs.
3. **No-affiliation candidates still save** (§3.3). Accepted, consistent with all upstream COI
   surfaces; the identity gates [VERIFIED via save-candidates-service.js:202-210, :250-252] bound
   what such a row can carry.
4. **Latency/availability.** The batch adds three Dataverse reads (request, co-PIs, account) and,
   in the additive tier, ORCID+OpenAlex calls. Dataverse is already on the save path's critical
   dependency (the writes). External calls are fail-open; if save-path latency matters, ship with
   `resolvePi: false` first and rely on the authoritative tier only — decide during implementation
   with a timing probe (the additive tier can be a fast-follow).
5. **New 503 envelope.** Clients currently branch on 200/422/500 bodies. [ASSUMED] both clients
   (standalone Reviewer Finder, Workbench) render `body.error` through a generic error path for
   unexpected statuses — client rendering was NOT read this session; Stage 3 must verify both
   clients' fetch handlers and add a manual pass before shipping.
6. **Doc/plan drift.** `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` (summary line mentions a
   "durable save-boundary re-reject" [VERIFIED via that file's line 20]) and
   `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` must be reconciled when this ships
   (durable-docs rule), plus the stale "Authoritative" comment at
   `save-candidates-service.js:212-221` itself.
7. **Working-tree dependency.** §2/§5 originally built on the chunk-1
   `reviewer-request-context.js` applicant-institution alias work. The 2026-07-06 implementation
   folded that dependency into the same branch before adding F2/F4 save-time recompute.
8. **Promotion path has no server recompute** (out of scope; D3 flag-not-drop is deliberate).
   Revisit only as an explicit policy decision with Justin.
9. **PI at a different institution than the applicant, with the external tier down.** In that
   state a same-PI-institution (but not applicant-institution) candidate saves. Accepted:
   identical to today's behavior when discover/enrich PI resolution fails, and strictly better
   the rest of the time.

## 8. Staged implementation steps (each independently testable)

**Stage 0 — rebase + land the dependency.**
- Status: complete before the F2/F4 implementation pass on branch `codex/reviewer-coi-build`.
- The `applicantInstitutionNames` dependency now lives in `lib/services/reviewer-request-context.js`
  alongside the typed `applicantInstitutionContext` used by `loadCoiContext`.

**Stage 1 — F4 typed state + retry (no behavior change for existing consumers).**
- `lib/services/reviewer-request-context.js`: add `applicantInstitutionContext { state, names,
  applicantAccountId, fetchError }` to the projection; single retry on account-fetch failure;
  keep `applicantInstitutionNames` unchanged for existing consumers.
- Status: implemented 2026-07-06.
- Tests: extended `tests/unit/reviewer-request-context.test.js` for account fetch fallback,
  save-time complete context with account aliases, complete context with no applicant lookup, and
  fail-closed fallback when complete institutions are required.
- Gates: `npm test`, `npm run lint`.

**Stage 2 — `loadCoiContext`.**
- `lib/services/reviewer-request-context.js`: new export per §3.2 (composes
  `loadReviewerRequestContext` + `resolveProposalPI` + `piInstitutions`; builds
  `institutionEntries`; `requireCompleteInstitutions` implements §5.2 rules 2-4).
- Status: implemented 2026-07-06.
- Tests: covered in `tests/unit/reviewer-request-context.test.js`; `institutionEntries` are emitted
  as `{ identity, display }` wrappers consumed by `DeduplicationService.institutionCOIDecision`.
- Gates: `npm test`, `npm run lint`, `npm run check:trust-boundary-guid` + self-test
  (sequentially).

**Stage 3 — save-path recompute (the F2 fix).**
- `lib/services/reviewer-finder/save-candidates-service.js`: batch-level `loadCoiContext` call +
  save-time institution recompute per §3.3; `lookupReviewerIdentity` runs before the COI gate and
  before upsert; server-known CRM affiliation participates in the recompute; stale gate-order
  comments were updated; server-recomputed COI error rows carry additive `serverRecomputed`,
  `decisionSource`, and `institutionCOIDetails`.
- `pages/api/reviewer-finder/save-candidates.js`: no code change expected (ServiceHttpError
  mapping already handles 503 [VERIFIED via :65-67]); confirm only.
- Status: implemented 2026-07-06.
- Tests: extended `tests/unit/save-candidates-service.test.js`,
  `tests/integration/save-candidates-route.test.js`, and
  `tests/unit/reviewer-route-identity-gate.test.js` mocks/coverage.
- Docs in the same change: `docs/API_ROUTE_SECURITY_MATRIX.md` row;
  `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`; chunk-2 design cross-ref; this plan's status →
  implemented.
- Gates: `npm test`, `npm run lint`, `npm run check:api-routes`, `npm run build`.

**Stage 4 (follow-up, separate change, optional) — centralize consumers.**
- Migrate `discover.js` / `enrich-contacts.js` / `enrich-recommended-service.js` to consume
  `loadCoiContext` instead of their hand-rolled `resolveProposalPI` + `piInstitutions` pairs
  [VERIFIED sites: discover.js:182-218; enrich-contacts.js:132-140;
  enrich-recommended-service.js:203-219], behavior-preserving (they keep fail-open semantics).
  Not required for F2/F4 enforcement; do not bundle into Stage 3 (don't-touch-unrelated-code
  rule).

## 9. Test plan (Stage 3 core)

Extend `tests/unit/save-candidates-service.test.js` [VERIFIED: existing suite already exercises
the flag-driven reject — `hasInstitutionCOI: true` fixtures and `code: 'institution_coi'`
assertions at its lines 58, 81, 158, 171], mocking the adapters plus `loadCoiContext`'s
dependencies:

1. **F2 proof — missing flags, real same-institution affiliation → rejected server-side.** Batch
   of one: `{ name, affiliation: 'Univ. of Testing', email }` with **no** `hasInstitutionCOI` and
   **no** `contactEnrichment`; COI context whose alias set contains `'University of Testing'`.
   Expect: 422 all-rejected envelope with `rejectedInstitutionCOI: 1`, error
   `code: 'institution_coi'`, `serverRecomputed: true`, and **zero** adapter write calls
   (`upsertByEmail` never invoked).
2. **F2 — enrichment-affiliation match.** Flags absent; `candidate.affiliation` null but
   `contactEnrichment.affiliation` matches an alias → rejected (proves the
   `institutionSignalsForCandidate` read path, deduplication-service.js:589).
3. **pdConfirmed does not waive COI.** Same as (1) plus `pdIdentityConfirmed: true` → still
   rejected (guards save-candidates-service.js:194 semantics).
4. **Non-COI candidate unaffected.** Different-institution affiliation, no flags → saved; 200
   envelope shape unchanged.
5. **Client flag still tightens.** `hasInstitutionCOI: true` but server context has *no* matching
   institution → still rejected (regression guard for the existing tests).
6. **F4 fail-closed.** Account fetch fails twice for a request *with* a valid applicant GUID →
   `ServiceHttpError` 503 with `retryable: true`, zero candidate iterations, zero writes.
7. **F4 retry-success.** Account fetch fails once then succeeds → state `complete`, batch
   proceeds; alias-matched candidate rejected.
8. **No-applicant-account request.** No applicant GUID → state `complete`; gate matches against
   formatted names only; same-formatted-name candidate rejected; batch otherwise saves.
9. **PI-resolver outage is fail-open.** `resolveProposalPI` throws non-abort → batch saves
   normally; a candidate matching only an OpenAlex-last-known PI institution is (accepted, §7.9)
   not rejected in this state.
10. **Mixed batch partial success.** One clean + one server-recomputed-COI candidate → 200 with
    `savedCount: 1`, `rejectedInstitutionCOI: 1`, `savedNames` containing only the clean name
    (preserves the partial-success contract, save-candidates-service.js:11-22).

Plus the Stage-1/2 unit tests (§8) and one manual end-to-end pass: save from the Workbench Find
tab (happy path + a forced-COI candidate) confirming client rendering of the reject and of the
503 (§7.5).

## 10. Relationship to chunk 1 / the v4 plan

Chunk 1 (shipped `b19b3b9` [VERIFIED via docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md:30]; extended
by the in-flight `applicantInstitutionNames` work and the v4 plan's third `piInstitutions`
parameter threading server institution-name variants into discover/enrich — that third parameter
is PLANNED, not yet in source [VERIFIED: piInstitutions takes two params today,
proposal-pi-identity.js:287]) makes **analyze/discover/enrich-time** exclusion better: a
best-effort slot/UX optimization that keeps conflicted names from wasting candidate slots,
reasoning tokens, and PD attention. It runs fail-open by design [VERIFIED via
discover.js:174-178; enrich-contacts.js:131-149] and its outputs travel to the client as flags —
which is precisely why it can never be the enforcement boundary (F2).

**This plan is the complementary hard boundary:** the same server-owned institution truth
(`loadCoiContext`), recomputed at the last responsible moment before any Dataverse write,
fail-closed on incomplete context (F4). The two layers deliberately share their sources
(`applicantInstitutionNames`, `resolveProposalPI`, `piInstitutions`,
`DeduplicationService.institutionCOIDecision`) so they cannot drift in policy, but differ in
failure posture: upstream fails open (UX), save fails closed (enforcement). Chunk-1/v4 work should
cross-reference this doc, and vice versa, when either ships.

## 11. Post-build adversarial hardening (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). An adversarial review of the built diff
found a residual fail-open in the save-time recompute and it was fixed in the same branch:

- **Finding:** the recompute originally read the reused reviewer's CRM affiliation only when
  `lookupReviewerIdentity` returned `outcome === 'confident'`. But `upsertByEmail` reuses an
  existing potential reviewer purely by email (`potential-reviewer.js:235-248`), and the lookup can
  return `outcome: 'candidates'` (ambiguous) carrying that reviewer's affiliation
  (`reviewer-identity-lookup.js:49-77`). A flag-less payload that omitted/falsified affiliation, or
  a transient lookup failure, could still save a same-institution existing reviewer.
- **Fix (`save-candidates-service.js`):** `resolveServerReuseAffiliations({ contactMatch, candidateEmail,
  hasSeedAnchor })` resolves the CRM affiliation of the EXACT reviewer persistence will reuse:
  `getByEmail(candidateEmail)` for the email-reuse path (no seed anchor — the same key `upsertByEmail`
  uses), or the confident anchor lookup for a seed anchor. This is INDEPENDENT of the identity-lookup
  shape, so every non-confident outcome (`candidates`, `source:'linked'`, `conflict`, `none`, or a
  thrown lookup) is covered — a review had shown the earlier confident/`source:'reviewer'`-only
  version still fell open for `linked`/`conflict` shapes. `recomputeInstitutionCOI` evaluates the
  payload affiliation then each server affiliation; any non-null decision rejects before any write; a
  `getByEmail` read failure throws to the per-candidate catch (fail-closed). Regression tests:
  email-reuse reject, non-confident (`linked`) reject with no write, and the then-existing
  lookup-throw-still-saves path (later superseded by §15's uniform fail-closed posture). Full suite green
  (5002).

## 12. TOCTOU close — single-read reuse (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). A further adversarial review found the §11
gate still read the reuse target via `getByEmail` while `upsertByEmail` performed its OWN second
`getByEmail`, so a concurrent create/re-affiliation between the two reads could make the write reuse a
same-institution reviewer the gate never evaluated.

- **Fix:** `potentialReviewerAdapter.upsertByEmail(payload, { existing })` now accepts the caller's
  already-fetched row: a truthy `existing` is reused after an email-match assertion (fail-closed on
  mismatch), `existing: null` is a CHECKED MISS (create without a second read), and omitting `existing`
  preserves the original internal-`getByEmail` behavior for other callers. `save-candidates-service.js`
  fetches the reuse target ONCE (`resolveServerReuseAffiliations` → `{ affiliations, existing }`),
  evaluates COI against it, and threads that SAME row into `upsertByEmail`. Additive return key
  `reusedAffiliation`; `{ id, created }` contract unchanged for the other callers
  (`contact-enrichment/persistence.js`, backfill/e2e scripts). Tests: adapter single-read (no second
  query when `existing` provided) + service threading/reuse. Full suite green (5006).

## 13. Email-less confident-match close (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). A final whole-branch review found the
exact-reuse refactor (§11) had scoped affiliation resolution behind `if (candidateEmail)`, so a NO-EMAIL
candidate with a confident ORCID/name match to an existing same-institution reviewer was recomputed with
no server affiliation and saved (the write CREATEs a new reviewer for an email-less candidate).

- **Fix:** `resolveServerReuseAffiliations` now ALWAYS evaluates `collectLookupAffiliations(contactMatch)`
  (the identity lookup's CRM affiliation — confident match incl. ORCID/name on an email-less candidate,
  plus reviewer-source `candidates`) on every path, IN ADDITION to the `getByEmail` reuse-target
  affiliation on the email path (still threaded via `existing` for single-read atomicity). Regression
  test: a no-email ORCID-confident same-institution match is rejected with zero potential-reviewer/
  researcher/suggestion writes. Full suite green (5007).

## 14. No-email path hardening (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). A whole-branch review found the no-email
candidate path (which CREATEs a new reviewer and has no `getByEmail` reuse target) still fell open in two
ways: `collectLookupAffiliations` only read `source:'reviewer'` candidates (dropping `source:'linked'`),
and a no-email candidate whose identity lookup THREW was screened on payload only.

- **Fix (principled, not shape-by-shape):** `collectLookupAffiliations` now reads `context.affiliation`
  from EVERY candidate (contact-source is null-safe), so any reviewer-carrying shape (`reviewer`/`linked`)
  is screened without a source allowlist. `collectLookupReviewerIdsMissingAffiliation` gathers reviewer
  IDs the lookup surfaces WITHOUT an affiliation (confident/candidates without `context.affiliation`, and
  `conflict.details` keys matching `/reviewerid$/i` — excluding `reviewerContactId`, which is a contact
  id); for the no-email/no-seed path those are resolved via `getById(reviewerId)` and screened, with a
  `getById` error/miss → reject pre-write (`institution_coi`, `serverRecomputed`). And a no-email/no-seed
  candidate whose lookup THREW (`contactMatch === null`) is rejected fail-closed
  (`decisionSource:'reviewer_identity_lookup_failed'`). At this stage the email path (`getByEmail` +
  `existing`) and seed-anchor path were unchanged; §15 replaces that asymmetry with the shared screening
  choke point. An `{outcome:'none'}` no-email candidate with a non-conflicting payload affiliation still
  saves (no over-rejection). Full suite green (5012).

## 15. Producer-declared reviewer identities and single save-time screening choke point (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). The save-time institution-COI gate is reframed away
from branch-by-branch parsing of lookup outcomes. The identity lookup producer now returns an additive
`referencedReviewers: [{ reviewerId, affiliation }]` field on every `confident`, `candidates`, `conflict`,
and `none` outcome. The field is populated beside each outcome constructor: reviewer-sourced confident and
candidate outcomes carry in-hand CRM affiliation, contact-only outcomes carry an empty reviewer set, and
conflicts declare only potential-reviewer ids (`reviewerId`, `existingReviewerId`, `orcidReviewerId`,
`emailReviewerId`) with `affiliation:null`; `reviewerContactId` remains treated as a contact id, not a
reviewer id.

The save service now screens through one choke point before any potential-reviewer, researcher, suggestion,
or roster write. For every non-seed email path it reads the `getByEmail` reuse target once and threads that
same `existing` row into `upsertByEmail`. It then builds one identity set from that reuse target plus
`contactMatch.referencedReviewers`, resolves missing affiliations through `getById`, rejects on lookup
failure, `getById` throw, or missing reviewer row, and runs the existing `recomputeInstitutionCOI` /
`DeduplicationService.institutionCOIDecision` matcher across the payload and all server affiliations. The
`{ outcome:'none' }` path still has an empty identity set and saves when the payload itself is not
same-institution.

This closes both live bypasses by construction:

- Email `orcid_email_split` and other conflict outcomes no longer depend on the save consumer parsing
  conflict-detail key names or entering a no-email-only `getById` branch. If the producer references a
  reviewer id, that id is in `referencedReviewers` and the single choke point resolves/screens it regardless
  of email presence.
- Email lookup throws now fail closed with
  `decisionSource:'reviewer_identity_lookup_failed'` before the `getByEmail` reuse check can save an
  unscreened reviewer. This is the intended behavior change; the former "lookup throws -> still saves" test
  has been updated to assert the 422 institution-COI envelope and zero writes.

Regression coverage includes the email `orcid_email_split` conflict where `orcidReviewerId` resolves by
`getById` to the applicant institution while `getByEmail` is null, the email lookup-throw fail-closed case,
the existing single-read `upsertByEmail({ existing })` threading, the no-email linked/conflict/lookup-throw
matrix, seed-anchor reuse, partial-success envelopes, and a producer invariant test. The invariant test
deep-scans each representative lookup outcome outside the `referencedReviewers` declaration for reviewer-id
fields and asserts exact set equality with the declared reviewer ids, including a fixture proving
`reviewerContactId` is not treated as a reviewer id.

Accepted residuals outside this layer:

- Contact-entity affiliations that the lookup does not select remain out of scope for save-time screening;
  this layer screens potential-reviewer CRM affiliation and payload/enrichment institution signals.
- Stale or incomplete CRM affiliations can still affect the matcher; this gate can only enforce against the
  affiliations Dataverse currently exposes.
- Identities the lookup never surfaces, such as a wrong name with no email or ORCID signal, remain outside
  this save-time identity set and depend on upstream identity-resolution quality.

## 16. Post-§15 adversarial findings closed (2026-07-06)

Status: IMPLEMENTED (branch `codex/reviewer-coi-build`). A confirming adversarial review of the §15 branch
returned two verified findings, both now fixed.

- **[high] Top-up LLM prompt bypassed the A7 boundary.** The decoupled Part-2 reviewer top-up
  (`_topUpReviewerSuggestions` / `buildTopUpPrompt` in `claude-reviewer-service.js`) interpolated the
  proposal context (`createProposalSummary(result.proposalInfo)`, an LLM/proposal-derived value) directly
  into the prompt with no `wrapUntrustedContent`, no `buildUntrustedContentPreamble`, and no
  `ANALYZE_INTEGRITY_BLOCK` — unlike the main analyze path. Because the top-up fires precisely when the first
  pass under-produced, the missing anti-fabrication integrity block was the highest-risk omission. Fix: the
  top-up now wraps the proposal context in untrusted sentinels, names its nonce via the untrusted-content
  preamble, and appends the trusted integrity block. Regression: the existing top-up test asserts the
  preamble/sentinel/integrity markers, and a new test asserts the proposal context lives only inside the
  sentinels.

- **[medium] Name-only namesakes could falsely trigger save-time institution COI.** The §15 choke point
  screened every `referencedReviewers` entry, including fallback name-search candidates (`matchKey:'name'`).
  A candidate with a new safe email and safe affiliation could be rejected `institution_coi` merely for
  sharing a name with an existing applicant-institution reviewer — even though persistence would create a
  new reviewer and never reuse that namesake. (This was pre-existing behavior preserved from the earlier
  `collectLookupAffiliations`, not introduced by §15.) Fix: the producer now declares a `viaNameMatch`
  boolean on each `referencedReviewers` entry (true only for `matchKey:'name'` references, and cleared —
  "sticky-strong" — if any exact email/ORCID/link reference also surfaces the same id). The save choke point
  skips `viaNameMatch` entries. The candidate's own payload affiliation and the actual `getByEmail` reuse
  target stay screened, so this removes the false positive without reopening the §15 bypass class. Residual:
  a candidate with no payload affiliation, no email, and only a name-search match to an applicant-institution
  namesake now saves as a new reviewer — an accepted trade for not hard-blocking distinct people on common
  names; upstream identity resolution owns that ambiguity. Regression: a name-only namesake at the applicant
  institution saves, while an exact (`viaNameMatch:false`) reference at the applicant institution still fails
  COI even with no email reuse target.
