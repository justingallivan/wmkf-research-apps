---
title: "Reviewer Finder — Live Enforcement Contracts"
domain: reviewer-identity
kind: source-of-truth
status: canonical
summary: "Status: MAINTAINED current-state reference (owns the live behavioral guarantees below)."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/review-manager/send-emails.js
---

# Reviewer Finder — Live Enforcement Contracts

**Status:** MAINTAINED current-state reference (owns the live behavioral guarantees below).
**Owner:** reviewer-finder.
**Created:** 2026-06-13 (S253).
**Last verified:** 2026-08-02 on branch
`codex/reviewer-find-performance-build` (not deployed) — Contracts 1–3 were
re-traced through the canonical contact projection, v3/v4 attestation,
server-owned roster finalization, explicit contact-clear command, and focused
tests. Contract 5 was last re-verified 2026-07-06 against the server-side save
recompute; Contract 7 was last re-verified 2026-07-03. See `[VERIFIED]` tags per
section.

> **What this doc is.** The single maintained home for the Reviewer Finder feature's
> *live* fail-closed enforcement contracts — the hard blocks, force-nulls, and
> asymmetric gates that protect against the wrong-person-invite failure
> (`project-reviewer-verify-fail-dangerous`). Each contract names its enforcement
> point in source (file:line) and the audit/test that proves it.
>
> **What this doc is NOT.** Not a feature overview (see `docs/REVIEWER_FINDER.md`),
> not a design snapshot. The `*_PLAN`/`*_DESIGN`/`*_SPEC` docs hold *rationale and
> history*; this doc holds *what the code enforces today*. When code and this doc
> disagree, **source wins** and this doc must be corrected in the same change.
>
> **How to keep it current.** When you change any enforcement point below, update the
> contract here in the same commit and bump **Last verified**. The agent-wiki topic
> pages (`docs/agent-wiki/topics/reviewer-identity.md` and siblings) route here as
> their canonical owner — keep their `canonical_docs:` pointer intact.

Authoritative source files: `pages/api/reviewer-finder/save-candidates.js`,
`pages/api/review-manager/send-emails.js`, `lib/utils/reviewer-invite.js`,
`lib/utils/reviewer-provenance.js`, `lib/services/proposal-pi-identity.js`,
`lib/services/reviewer-identity-evidence.js`, `lib/services/contact-enrichment-service.js`.
Promotion contact authority additionally lives in
`lib/utils/reviewer-vetted-email.js`,
`lib/services/reviewer-candidate-attestation.js`, and
`lib/services/reviewer-finder/save-candidates-service.js`.

---

## 1. Identity-unresolved retention and promotion gate `[VERIFIED 2026-07-29 IN SOURCE; NOT DEPLOYED]`

**Contract.** Find retention and Invite promotion are separate decisions. An
unresolved row may remain visible and actionable for staff resolution, but it
does not become selectable for promotion and the server writes neither a
person nor a suggestion until the canonical contact projection is `ready`.

- **Client (Find select list).** `isCandidateSelectable` requires both the
  existing provenance/identity group to be selectable and
  `projectReviewerContact(candidate).decision === 'ready'`. Rows needing
  identity confirmation or an authoritative email remain visible with the
  exact required action, but are excluded from select-all/promotion.
- **Server (`lib/services/reviewer-finder/save-candidates-service.js`,
  `saveCandidates`).** Recomputes the same canonical contact projection before
  any durable write. `needs_identity_confirmation` and `missing_email` return
  explicit per-candidate `withheld` results. A mixed batch can still save its
  independent ready rows; only server-confirmed saved keys graduate.

**Enforcement points.** `lib/utils/reviewer-provenance.js` (`provenanceGroupOf`) ·
`lib/services/reviewer-finder/save-candidates-service.js`
(`saveCandidates`) · `lib/utils/reviewer-vetted-email.js`
(`projectReviewerContact`) ·
`shared/components/reviewers/reviewer-search-logic.js`
(`isCandidateSelectable`).

**Why.** Client gating is explanatory only; a direct caller can still POST the
row. The server projection is therefore the authority and the roster preserves
the evidence needed to reproduce the same decision after reload.

**Audit.** `tests/unit/reviewer-route-identity-gate.test.js`.

---

## 2. Human-grounded provenance retains recall but never promotes name-only `[VERIFIED 2026-07-29 IN SOURCE; NOT DEPLOYED]`

**Contract.** `cited_reference`, `proposal_named`, and `referred` provenance may
retain a candidate in Find even when automated identity resolution abstains.
That provenance is discovery evidence, not contact authority. Until the exact
identity/contact projection is ready—or staff stores an exact actor-bound
identity/contact confirmation—the row is read-only for promotion and no
potential-reviewer or selected suggestion is created.

**Enforcement points.**
`lib/utils/reviewer-vetted-email.js` (`projectReviewerContact`) derives the
effective nested identity decision, exact normalized email/source, persistence
flags, affiliation rescue, and anti-scrape rejection. The Find card renders
**Needs identity confirmation** or **Missing verified email**; only `ready`
renders a promotion checkbox. `save-candidates-service.js` recomputes the
decision before adapters are called.

New automated attestations mint projection v4. V3 and v4 bind the exact
projected email, source, persistence flags, request, immutable roster key,
identity decision, and eligibility evidence, so both remain
contact-authoritative during their TTL. V4 additionally binds
`eligibilityCheckStatus`; a valid legacy v3 receipt may restore the bound
eligibility result/evidence but not overwrite the stored check-status field.
V1/v2 receipts still verify their historical identity claims during their TTL
but are never contact-authoritative. Staff confirmation remains an exact
server-stored, actor-bound value contract; changing any confirmed contact field
requires reconfirmation.

**Why.** The old force-null path safely withheld a possibly wrong email but
still created a selected name-only row, which made retention look like a
successful Invite promotion. The new contract preserves recall without
creating that ambiguous durable state.

---

## 3. Reviewer address-action gate `[IMPLEMENTED IN SOURCE 2026-07-31; NOT DEPLOYED]`

**Contract.** On a first-contact **invitation**, the server independently computes
`emailConfidence(person)` and applies one of five actions. A client-provided confidence label
never authorizes a send.

- **Ready** = `orcid`, `institution_page`, or `scholarly_multi` (the same address on at least
  two distinct recent, identity-matched scholarly works). Sends without an extra address check.
- **Quick check** = `scholarly_single`, legacy `pubmed`, `manual`, `affiliation`, legacy source-only `staff_verified`,
  or unknown/null source. The recipient's `suggestionId` must be in `confirmedLowConfidenceIds`; the
  acknowledgement is recipient-specific, not a batch boolean.
- **Research only** = `serp_search`, `claude_search`, or `search_contested`. The server skips the
  invitation with `email_research_only`; a checkbox cannot override it. Find or Invite now calls
  `POST /api/workbench/reviewer-address-trust` with the exact address, affirmative person/address
  attestation, and a publication or institution-page link (or another validated evidence type).
  Before promotion this produces a server-owned roster receipt; after promotion it re-reads the
  exact suggestion/person and ETag-writes address + `staff_verified` + the versioned exact-address
  bundle atomically. The retired `my-candidates verifyEmailAddress` action returns 409
  `address_verification_moved` and cannot relabel provenance without evidence.
- **Blocked** = a valid exact-email bundle has `conflict_pending`. Promotion, invitation,
  materials, follow-up, and thank-you all refuse the address with
  `address_conflict_pending`; no low-confidence acknowledgement bypasses it. Staff choose and
  verify the stored or found address in Find, or create a durable repair request.
- **Missing** = no address. There is nothing to send.
- **Scope.** Ready/quick/research-only remain first-contact invitation policy. A pending
  contradiction is a wrong-recipient risk and therefore blocks every outbound reviewer template.

**Enforcement points.** `lib/utils/reviewer-invite.js` (`emailConfidence`) ·
`lib/services/review-manager/render-emails-service.js` (server-computed action in preview;
research-only rows are skipped) · `lib/services/review-manager/send-emails-service.js`
(fresh server recomputation; hard research-only skip and recipient-specific quick-check
allowlist) · `shared/components/reviewers/InviteEmailModal.js` (checkboxes for quick-check rows
only). Manual email edits stamp `emailSource='manual'`. The researcher adapter treats `manual`
and `search_contested` as authoritative source overwrites so stale provenance cannot make an
address look more trusted than it is.

**Source PRECEDENCE (S387).** `wmkf_emailsource` used to be fill-if-empty apart from those two
overwrites and a narrow `scholarly_multi` upgrade, so the FIRST source ever recorded for a person
pinned their address tier permanently — a reviewer captured as `serp_search` stayed
`research_only` (unsendable) even after another request's enrichment found the SAME address in
their own PubMed affiliation string. `researcher.upsertByPotentialReviewer` now lets a strictly
stronger tier supersede a weaker one, where the tier ranking is `ready` > `quick check` >
`research only` and is derived from `emailSourceTier`/`emailSourceOutranks` in
`lib/utils/reviewer-invite.js` — the same module that defines the send-gate buckets, so the
adapter cannot disagree with the gate about which source is stronger. Preconditions: the SAME
normalized address (a source describes one specific address), both sides a KNOWN source (an
unrecognized value neither upgrades nor is upgraded, even though the live gate still treats it as
quick-check), strictly greater (an equal tier never churns the value, so a staff attestation is
not displaced by a same-tier machine source), ETag-conditional, and — reversed after adversarial
review — **the stored value must not be a human assertion**. `manual`/`staff_verified` are
TERMINAL against machine evidence (`emailSourceUpgradeAllowed`): their quick-check tier is not
merely a weaker evidence claim, it is what keeps a human in the loop at send for an address a
person had to vouch for, and because the person row is shared across requests an automatic
promotion to `ready` would delete that acknowledgement everywhere — including on the request
where the staffer made the assertion. A human still supersedes a human: `manual` and
`search_contested` overwrite unconditionally, so a staff re-entry or fresh contradicting evidence
still moves the value. Downgrades remain explicit for the same reason — those two are safety
assertions rather than evidence claims.

**Address + source are ONE write, enforced at the ADAPTER rather than per caller.** Every
`wmkf_emailaddress` writer in `potential-reviewer.js` carries
`wmkf_emailsource` in the same payload: `update`, `create`, `upsertByEmail`,
merge-only `clearEmail`, and staff-edit `clearEmailForEdit` (both clear
address and source together). A source left behind describes an address the row
no longer has, so the next address written without a source would inherit it;
in the merge flow that is a loser row keeping `orcid` after its address moved
to the keeper. Normal `update` ignores null/blank email rather than treating
absence as destructive authority. `clearEmailForEdit` requires the exact
expected address/source, a reason, and the person ETag, so a concurrent
shared-person edit fails stale instead of being overwritten. Adapter support is
NOT the invariant, though — `pruneEmpty` drops the field when a caller omits
it, so every CALLER must supply a source. Three successive reviews each found a caller the
previous claim had missed, so the invariant is now enforced by a scanner rather than by
enumeration: `tests/unit/email-source-pairing-invariant.test.js` walks `lib/`, `pages/`,
`scripts/`, and `shared/`, extracts each `create`/`upsertByEmail`/`update` call's object literal,
and fails when one passes `email` without `emailSource`. A second scan covers RAW Dataverse
payloads that set `wmkf_emailaddress` directly, bypassing the adapter (smoke tests and probes do
this, and the adapter cannot enforce anything about them). It carries a positive control (a
literal of the exact production shape the reviews found) so an empty or broken scan cannot pass
silently, and an exemption set where each entry states its reason. That scanner found **seven**
sites the three reviews never named — a live one in `contact-enrichment/persistence.js`, two
historical backfills, three fixture/smoke scripts, and one raw smoke payload — all now paired.
Two entries are exempt and argued in code: the field-DESCRIPTION map in
`shared/config/prompts/dynamics-explorer.js` (documentation, not a write) and
`scripts/probe-merge-altkey-ordering.mjs` (its purpose is to observe `wmkf_emailaddress_unique`
alt-key behavior by setting the address alone; pairing would change what it measures). The former
source-only `verifyEmailAddress` writer is retired; evidence-backed verification now writes the
address, source, and trust bundle atomically through the potential-reviewer adapter. Previously
each of these wrote the address, then
the source, in two calls — so an address that landed while the source write failed left the row
describing the NEW address under the OLD source, and a hand-typed address inheriting a stored
`orcid` reads as `ready` and sends with no acknowledgement. One patch means a duplicate-key
rejection drops both; email stays isolated from the other person fields, so its 409 still yields
`partialSuccess` for them.

Existing pinned rows are corrected by `scripts/backfill-email-source-precedence.mjs` (dry-run
default). Writes route through the adapter inside `withDalContext`, so DAL enforcement, the
target/write interlock, the precedence rule, and the ETag all apply. It pairs each address with
the source asserted by the SAME roster object — never two independent COALESCEs, which could
re-assert provenance that was never evidence for that address — requires `pickVettedEmail`'s
persistence envelope on the contributing row, restricts contributors to `active`/`saved` rows,
caps the population, aborts on the first error, verifies the address still holds after each
write, and refuses to execute unless the plan matches the manifest from a reviewed dry run.

**Why.** The API is the enforced boundary — the modal acknowledgement alone is not trusted.

---

## 4. Structured-PI identity — fail-open + augment-only `[VERIFIED 2026-06-13]`

**Contract.** `discover.js` and `enrich-recommended.js` resolve the proposal PI from STRUCTURED
Dataverse data (`resolveProposalPI`: request `_wmkf_projectleader_value` → contact `wmkf_orcid`
→ exact OpenAlex author via `OpenAlexService.getAuthorByOrcid`) instead of trusting the
LLM-extracted PI name. It is **server-resolved from the request GUID** (clients send `requestId`,
never a client-claimed identity), runs in a Dynamics bypass under the time budget, and is
**FAIL-OPEN + AUGMENT-ONLY**:

- Never throws for "couldn't resolve" — returns `{ resolved: false, reason }` so the caller falls
  open to the existing proposal-text identity. Only abort/time-budget signals propagate.
- Appends the canonical PI name to the author-exclusion/coauthor set (never replaces the LLM PI +
  co-Is) and identity-excludes candidates sharing the PI's exact ORCID/OpenAlex id — **gated on
  `confirmed`/`probable`** (unresolved rows keep their id fields; acting on them would risk a
  namesake).
- A mis-entered ORCID is caught by a forename/surname name guard (`forenamesContradict`) → abstain.

**Enforcement points.** `lib/services/proposal-pi-identity.js`
(`resolveProposalPI`) · `lib/services/reviewer-identity-evidence.js`
(`forenamesContradict` — full-forename
contradiction only; returns false if either name is initial-only).

---

## 5. S240 current-institution COI — default hard drop + durable gate `[VERIFIED 2026-07-06]`

**Contract.** Current same-institution affiliation (reviewer at a proposal-PI institution) is a
foundation POLICY conflict, **hard-dropped by default on BOTH discovery tracks** and
**hard-rejected again at the durable save boundary**. Matched against the UNION of
`piInstitutions(pi, authorInstitution)` (ORCID-current + OpenAlex last-known + LLM).

- **Discovery.** Track A via `partitionConflicts` / `filterConflicts` in `discover.js`; Track B via
  the same COI partition inside `DiscoveryService.discover()`. Hard-dropped candidates are also
  written to Postgres `reviewer_find_roster` as `status='coi_dropped'` by `recordCoiDropped` when a
  valid request id is present. That ledger is observability-only: it stays out of active/excluded
  render buckets and cannot be selected, recovered, promoted, or saved from the Find UI.
- **Approved Phase C exception.** `partitionConflicts` may return a same-institution row as a
  visible read-only flag instead of a ledger drop ONLY when exactly one low-trust affiliation string
  (`openalex_current`, `pubmed_recency`, or legacy `scholar_current`) matches a PI institution AND
  an independent current-affiliation signal contradicts it. Matching OpenAlex/ROR institution ids,
  high-trust current affiliation (`orcid_current` / manual current source), multiple matching
  signals, or insufficient evidence all stay hard-dropped. Flagged rows carry
  `hasInstitutionCOI=true` with `institutionCOIDetails.dropDecision='flagged'`; they are not
  selectable in the Find UI and are still rejected by the save route.
- **Matcher precision.** The COI path uses `DeduplicationService.institutionsMatchForCOI`, not the
  looser generic `institutionsMatch`. COI matching now compares shared OpenAlex/ROR institution ids
  first when both sides carry ids, keeps exact-normalized / abbreviation-expanded / exact key-word
  equality, and uses only narrow same-system campus qualifier containment. It does not use bare
  substring containment or broad subset matching for COI.
- **Save (authoritative).** `lib/services/reviewer-finder/save-candidates-service.js` loads
  `loadCoiContext(requestId, { includeCoPIs:false, requireCompleteInstitutions:true })` before the
  candidate loop, so save-time COI screening uses trusted request/applicant/PI institution context
  and fails closed with a 503 `ServiceHttpError` if a valid applicant-account alias set cannot be
  loaded after retry. The save path computes persisted contact fields, calls
  `lookupReviewerIdentity`, then HARD-REJECTS before any `wmkf_potentialreviewer`,
  researcher-overlay, or suggestion upsert when any of these are true: client top-level
  `hasInstitutionCOI`, post-enrichment `contactEnrichment.coiRecomputed &&
  contactEnrichment.hasInstitutionCOI`, or a fresh server recompute via
  `DeduplicationService.institutionCOIDecision`. The recompute evaluates payload affiliation
  signals and, when `lookupReviewerIdentity` returns a confident match, the server-known CRM
  reviewer affiliation from `match.context.affiliation`. Rejections increment
  `rejectedInstitutionCOI`; 422 still applies when the whole batch is COI/unresolved.
- **Retired.** Historical / former-shared institution COI is RETIRED — `markInstitutionCOI` is
  current-affiliation only; `institutionCOIDetails.historical` is gone. `affiliationHistory` is
  still produced but COI-inert (deferred dead-code). The SOFT flag survives only on the
  applicant-recommended (`enrich-recommended.js`, flag-not-drop) and post-enrichment
  (`enrich-contacts.js`) paths.

**Enforcement points.** `lib/services/reviewer-finder/save-candidates-service.js`
(`loadCoiContext`, `lookupReviewerIdentity`, `recomputeInstitutionCOI`, `rejectedInstitutionCOI`) ·
`lib/services/reviewer-request-context.js` (`loadCoiContext`, applicant-alias retry/fail-closed,
Co-PI reads skipped for save-time COI context) · `discover.js` (`partitionConflicts` +
`recordCoiDropped`) · `DiscoveryService.discover()` (`partitionConflicts`) ·
`lib/services/deduplication-service.js` (`institutionCOIDecision`, `institutionsMatchForCOI`) ·
`lib/services/reviewer-roster-store.js` (`recordCoiDropped`).

> **This contract previously had no documentary home outside the agent wiki** — the
> `rejectedInstitutionCOI` durable gate appeared in zero non-wiki docs before this reference
> (S253). The AI `POTENTIAL_CONCERNS` advisory retirement **shipped as Chunk 2b (S254)** — removed
> from prompt/parser/validator/repair/render/persist; COI is now screened deterministically
> server-side. See `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` (historical). Policy memory:
> `project-reviewer-coi-rely-on-self-disclosure`.

---

## 6. OpenAlex bibliometrics + verified-domain source `[VERIFIED 2026-06-13]`

**Contract.** Bibliometrics (h-index/i10/citations), the OpenAlex last-known-affiliation candidate, and the
verified-email domain all source from **OpenAlex, NOT SerpAPI Scholar** (Slice 1b, S251 free-stack
migration). `ContactEnrichmentService._attachOpenAlexMetrics` (was `_attachScholarMetrics`) uses
the ORCID path (`getAuthorByOrcid`) or the discovery-resolved author id carried on the candidate
(`getAuthorById` on `candidate.openAlexId`/`openAlexAuthorId` + identity status) — **never a bare
name search**; no anchor → ABSTAIN (no metrics). FREE, so it runs regardless of the paid SerpAPI
toggle. It writes the `tierResults.openalex_author` DTO that the resolver re-proves (allowlist gate
`isOpenAlexAuthorAccepted`).

- **Field renames (same slice):** `scholarVerifiedEmail`→`verifiedInstitutionDomain`,
  `scholarAffiliations`→`openAlexAffiliation`, `affiliationSource:'scholar_current'`→
  `'openalex_current'`, `tierResults.scholar_profile`→`tierResults.openalex_author`.
- **Google Scholar:** exact deep-links (`user=ID`) are DROPPED — `googleScholarId=null`; only a
  free Scholar **search** link (`buildGoogleScholarUrl(name, affiliation)`) remains. Any doc that
  says "Google Scholar profile links" is drifted.

**Enforcement points.** `lib/services/contact-enrichment-service.js`
(`_attachOpenAlexMetrics`, delegated to
`lib/services/contact-enrichment/openalex-metrics.js`). Deeper rationale +
call-site inventory:
`docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` (design owner, status COMPLETE).

---

## 7. Faculty-page email recovery — guarded fetch + ranked mailbox ownership `[VERIFIED 2026-07-19]`

**Contract.** `my-candidates` still returns `facultyPageUrl`, and staff can manually enter an
address when automation abstains. The automated path is guarded by
`REVIEWER_PAGE_EMAIL_TIER_ENABLED`: code fails closed when unset, while production explicitly
enables the tier. When enabled, `_attachEmailFromResolvedPage` runs inside
`_finalize` (after `_attachOpenAlexMetrics`, before the verified-domain guard) and recovers a
page-grounded email via `safeFetchInstitutionPage` (`lib/utils/safe-fetch.js`) with the named SSRF
mechanism Codex required: HTTPS-only, host = exact-or-subdomain of `verifiedInstitutionDomain` ONLY,
DNS private/reserved-IP block incl. IPv6, **undici IP-pinning dispatcher** (closes the DNS-rebind
TOCTOU), per-hop redirect re-validation, content-type + 512 KB + timeout caps.

The email is stamped `emailSource='institution_page'` ONLY when deterministic ownership ranking
has one best address: exact full-name mailbox; initials+surname, surname+initials, or exact surname
on a page whose title or sole H1 names the candidate; then exact personal-URL slug and narrow
full-forename directional adjacency as fallbacks. Equal-best ties, body-only weak mailbox forms,
domain-only matches, and unmatched role addresses abstain. `ContactParser.isNameConsistentEmail`
is not used because its surname-containment rule is appropriate only for quarantined search leads.
`institution_page` remains HIGH-trust per Contract 3. Rationale + full design:
`docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md` (supersedes `REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D).
Do NOT enable without that mechanism intact; multi-domain institutions (e.g. Kansas State `ksu.edu` vs
OpenAlex `k-state.edu`) are an intentional v1 gap (the fetch is refused, not relaxed).

`emailEvidence` records the official source URL, match class, ownership proof, and bounded
alternatives. `pruneCandidateForRoster` preserves that compact evidence in Postgres
`reviewer_find_roster`, and `CandidateCard` shows the source and explanation after reload.
Dataverse and the send gate do not consume the detailed proof: invitation authorization remains
the binary persisted `institution_page` source and is recomputed server-side.

**Related verified-domain guard (S321 contests; 2026-07-18 policy makes contests research-only).**
`_validateEmailAgainstVerifiedDomain` in
`lib/services/contact-enrichment-service.js` now validates against **two domain
sets** built in `_finalize` by `_buildInstitutionDomainEvidence`:
*anchored* (identity-proven, ID-resolved: `verifiedInstitutionDomain` + ORCID
disambiguated-organization RORs → `OpenAlexService.getInstitution`, only on a confirmed/probable
identity) and *plausible* (anchored + name-resolved via `OpenAlexService.searchInstitutions`,
lane-routing only). An anchored match confirms persistence; a SEARCH-sourced contradiction is
re-stamped `emailSource='search_contested'` (`_markEmailContested`) — kept as a visible
research lead but never invitation-sendable per Contract 3 — instead of nulled into a rejected
lead. A `name_mismatch`-rejected email whose domain is plausible is likewise retained as
contested in `_finalize` (`_readjudicateNameMismatchRejectedEmail`).
ORCID/PubMed/affiliation emails still outrank the heuristic. The opt-in fetch tier above is
SSRF-bound to the **anchored** set only (fallback: the single `verifiedInstitutionDomain` when
the anchored set is empty — today's bound). Design + review history:
`docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`.

**Enforcement points.** `lib/utils/safe-fetch.js`
(`safeFetchInstitutionPage`, `hostWithinDomain`, `isPrivateAddress`) ·
`lib/services/contact-enrichment/page-email.js`
(`attachEmailFromResolvedPage`, `selectGroundedEmailWithEvidence`) ·
`lib/utils/contact-parser.js` (`extractEmailsFromHtml`) ·
`shared/components/reviewers/reviewer-search-logic.js` (`pruneEmailEvidence`) ·
`shared/components/reviewers/ReviewerSearchSection.js` (`CandidateCard`). The related
verified-domain guard remains in the contact-enrichment finalization path. Audit:
`tests/unit/resolved-page-email-grounding.test.js`, `tests/unit/resolved-page-email-tier-service.test.js`.
Design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`.

---

## 8. Work-grounding rescue — namesake safety contract `[VERIFIED 2026-06-13]`

**Contract.** `rescueByWorkGrounding` resolves a name the normal path already abstained on, and is
**purely additive** — it can only promote an abstained name, never alter an existing verdict. It
fires ONLY on `no_openalex_affiliation_or_topic_match`. For the top-3 **forename-fully-agreeing**
candidate authors it fetches recent work titles (`OpenAlexService.getWorksByAuthor`) and re-tests
field overlap against the actual titles, with the author's own **ORCID works list**
(`ORCIDService.getWorks`, merge-immune) as a second corroborator: an informative (≥5-title)
off-topic ORCID corpus VETOES the match (likely cluster contamination); a sparse list is
uninformative.

**Safety invariants.**
- Strict forename gate → cannot bind a wrong-forename namesake.
- Promotes via an `authorship_grounded` (strong) anchor with a **`probable` ceiling**
  (selectable-with-verify, not auto-trusted).
- Requires EXACTLY ONE work-grounded candidate (else abstain).
- On abort during probing, never promotes on partial evidence (returns null — keep safe abstain).

**Enforcement points.** `lib/services/reviewer-identity-evidence.js`
(`rescueByWorkGrounding`). **Audit:** `tests/unit/reviewer-identity-evidence.test.js`
(`describe('work-grounding rescue')`). Safety posture memory:
`project-reviewer-verify-fail-dangerous`, `project-openalex-merge-use-orcid-works`.

---

## 9. Exact applicant-linked canonical contact reuse `[VERIFIED 2026-07-29]`

**Contract.** A populated applicant-recommended reviewer slot is already an
exact `wmkf_potentialreviewers` GUID. This path may hydrate and reuse only that
person; it never searches or merges by normalized name. The canonical email and
`wmkf_emailsource` travel as one bounded `applicantKnownReviewer` pair. An
address is reusable only when the person is active and the active exact-email
owner is the same person. Missing, inactive, unavailable, conflicting, or
stored/enriched-mismatch contact remains blocked with a stable reason.

GET ingestion materializes the suggestion first and performs person hydration
in a separate failure boundary. SSE enrichment freshly re-reads the exact
person, seeds stored affiliation/ORCID into identity resolution, persists only
the bounded applicant projection in roster JSON, and reports per-row hydration
failures. If every person read fails, the result contains explicit unresolved
rows rather than a false clean empty success. Roster cache version 3 prevents
pre-contract JSON from suppressing a retry.

Promotion ignores client-supplied canonical-contact claims and freshly
revalidates the suggestion, person, and active email ownership. Canonical reuse
does not write the email. `quick_check` and `research_only` retain their
existing promotion semantics; the invitation send classifier remains the final
authority and still requires acknowledgement or blocks sending as applicable.
When the exact person has no stored address, an identity-vetted enrichment
address remains a paired roster claim and can reach the server-owned B1 write;
address and source land in one PATCH before canonical re-read. The bibliometric
writer receives no source unless it describes the already stored canonical
address. Anti-scrape manual input is rejected before any person write, and an
unavailable applicant-linked person cannot receive staff confirmation through
either the UI or the authenticated roster endpoint.
Applicant-link evidence is rendered as “Existing linked reviewer record” and
is deliberately distinct from general-search `dataverseContactEvidence`.
Late request-A ingestion success or failure is discarded after the UI has
switched to request B.

**Enforcement points.**
`lib/services/workbench/applicant-known-reviewer-service.js`,
`lib/utils/applicant-known-reviewer.js`,
`lib/services/workbench/applicant-reviewers-service.js`,
`lib/services/workbench/enrich-recommended-service.js`,
`lib/services/workbench/promote-applicant-reviewer-service.js`, and
`shared/components/reviewers/ReviewerFindPanel.js`.

**Audits.** `tests/unit/applicant-known-reviewer.test.js`,
`tests/unit/workbench-applicant-reviewers-service.test.js`,
`tests/unit/workbench-enrich-recommended-service.test.js`,
`tests/unit/workbench-promote-applicant-reviewer-service.test.js`,
`tests/unit/reviewer-search-logic.test.js`, and
`tests/unit/reviewer-find-panel-stale-ingestion.test.js`.

---

## Contract → enforcement-point index

| # | Contract | Primary enforcement point |
|---|----------|---------------------------|
| 1 | Slice-E client/server asymmetry | `save-candidates-service.js` (`isUnresolvedIdentity`, `saveCandidates`) + `reviewer-provenance.js` (`provenanceGroupOf`) |
| 2 | PI-named/cited/referred exemption + force-null | `save-candidates-service.js` (`contactBlockedForUnresolvedExempt`, `saveCandidates`; kinds: `reviewer-provenance.js` `isIdentityReviewExemptProvenance`) |
| 3 | Invite-confidence allowlist | `reviewer-invite.js` (`emailConfidence`) + `send-emails-service.js` |
| 4 | Structured-PI fail-open/augment-only | `proposal-pi-identity.js` (`resolveProposalPI`) + `reviewer-identity-evidence.js` (`forenamesContradict`) |
| 5 | S240 institution COI default hard drop + flagged exception | `save-candidates-service.js` + `discover.js`/`DiscoveryService` (`partitionConflicts`) + `reviewer-roster-store.js` (`recordCoiDropped`) |
| 6 | OpenAlex bibliometrics/verified-domain | `contact-enrichment-service.js` (`_attachOpenAlexMetrics`, `_validateEmailAgainstVerifiedDomain`) |
| 7 | Faculty-page guarded fetch + ranked mailbox ownership | `safe-fetch.js` + `contact-enrichment/page-email.js` + roster/UI evidence projection |
| 8 | Work-grounding rescue | `reviewer-identity-evidence.js` (`rescueByWorkGrounding`) |
| 9 | Exact applicant-linked canonical contact reuse | `applicant-known-reviewer-service.js` + `applicant-known-reviewer.js` + `promote-applicant-reviewer-service.js` |
