# Review — Reviewer Contact Leads / Scout Layer Spec

Reviewer: Claude (Opus 4.8)
Date: 2026-06-18
Reviews: `docs/REVIEWER_CONTACT_LEADS_SPEC.md` (PROPOSED DRAFT)
Purpose: Pre-implementation alignment. This memo is written **for Codex** — please confirm,
refute, or sharpen each point against the live code, then return a GO / GO-WITH-CHANGES / NO-GO
on the spec **as reordered below**. The goal is to agree the slice order and the safety gates
before any implementation.

## Outcome (2026-06-18)

**Codex verdict: GO-WITH-CHANGES.** Codex incorporated this review's reordering into the spec
(`REVIEWER_CONTACT_LEADS_SPEC.md`): measurement first, split cheap lead-surfacing from paid scouting,
`namesake_ambiguous` bucket, faculty/profile pages in the first useful slice, defined evidence flags,
roster-cache-only lead persistence. Codex's required changes: keep Slice 1 first; build Slice 2a
(surface discarded results + existing page URLs, no new calls) before broad search; add the SerpAPI
pre-null capture hook; broad scout is later + hard-capped; persist compact `contactLeads` through the
roster DTO + merge/render plumbing (not Dataverse); add a test that promoted leads stay
`manual`/low-confidence for first-contact invites.

**One correction Codex made to this memo (verified true):** the "a suggestion carrying an institution
already runs its search" claim is too strong. The search gate uses `_effectiveInstitution`
(`contact-enrichment-service.js:91-97`), which reads `orcidAffiliation` / `candidate.affiliation` /
`candidate.institution` / `candidate.primaryAffiliation` — it does **not** read `suggestedInstitution`.
So a Claude suggestion's institution only triggers the paid search if it was mapped into one of those
fields; the dominant-bucket question is entirely a Slice-1 measurement, not an assumption. (The
spec body below is now the source of truth; this memo is the point-in-time review.)

---

## Context (why this spec exists)

The Reviewer Finder became safer by withholding wrong-person contact data, but the same gates now
suppress useful, human-findable contact info. The product owner's complaint: candidates surface with
no email, yet the email is trivially discoverable with a manual web search. The point of the tool is
that staff should not have to do that search by hand.

The spec's resolution — a separate quarantined `contactLeads[]` collection that is populated
aggressively but never feeds `email` / `website` / `facultyPageUrl` / `*_PersistAllowed` — is, in the
reviewer's judgment, the correct architecture. This memo does **not** dispute the architecture; it
proposes a **reordering of the slices** and tightens several safety/scoping points.

## Verified premise (Codex: re-confirm)

`[VERIFIED via lib/services/contact-enrichment-service.js:487]`
`hasIdentityAnchor = !!effectiveInstitution || this._hasOrcidAnchor(...)` — i.e. the anchor is an
**institution OR ORCID**, NOT full identity confirmation.

`[VERIFIED via lib/services/contact-enrichment-service.js:494-496, :501]`
Unanchored candidates hit `_markUnanchoredAbstain` (contact cleared); the Tier-3 Claude web search
runs only when `hasIdentityAnchor` is true.

`[VERIFIED via lib/services/contact-enrichment-service.js:581]`
SerpAPI (Tier 4) is gated the same way: it runs only when `!contactEnrichment.email && hasIdentityAnchor`.

`[VERIFIED via lib/services/contact-enrichment-service.js:511-521, :591-597]`
When a Claude or Serp result **contradicts the anchor**, the full result is recorded in
`tierResults.{claude,serp}_search` with `rejectedReason: 'identity_anchor_contradiction'` but is NOT
applied to `email`. So **this class of found-then-discarded data is already preserved** in the result
object — surfacing it is nearly free.

`[VERIFIED via lib/services/contact-enrichment-service.js:606-613]` — **caveat that narrows Slice 2a:**
a *name-inconsistent* SerpAPI email is set to `null` **in place** on the same object already stored in
`tierResults.serp_search` (`serpResult.email = null` at :612), so it is **destroyed, not preserved**.
Slice 2a can cheaply surface anchor-contradiction discards, but to recover name-mismatch discards it
must add a capture hook **before** the in-place null. Codex: confirm this mutation aliasing and whether
the Claude tier has an analogous in-place destruction.

**Implication the spec under-weights:** the anchor is institution-OR-ORCID (not confirmation). NOTE
(corrected by Codex, verified): the gate's institution comes from `_effectiveInstitution`
(`:91-97`) = `orcidAffiliation` / `candidate.affiliation` / `candidate.institution` /
`candidate.primaryAffiliation` — NOT `suggestedInstitution`. So a Claude suggestion's institution only
triggers the paid search if it was mapped into one of those fields. The dominant "missing email" buckets
(searched_no_result / has_page_no_email / lead_found_not_persisted vs. search_skipped_no_anchor) are
therefore a pure **Slice-1 measurement question**, with no safe a-priori assumption either way.

---

## Overall verdict

**Approve the direction; build it in a reordered sequence.** The architecture, the safety invariants
(§7), and the non-goals (§8) are right. The changes below are about (a) sequencing for fastest utility
at lowest cost/risk, (b) one cheap high-value win the spec buries, and (c) tightening the parts that
re-introduce the wrong-person hazard.

## Recommended changes

### A. The cheapest, highest-value win is in Slice 2 — split it and do it FIRST
For anchored candidates the search often **already found** an email/page and discarded it. The
anchor-contradiction class is fully preserved in `tierResults.{claude,serp}_search` with a
`rejectedReason` (`:511-521`, `:591-597`), so surfacing it is nearly free — no new searches, no new
provider cost. **Caveat (see verified premise):** the *name-inconsistent SerpAPI email* is nulled
in place (`:612`) and is NOT recoverable from `tierResults`; recovering that one requires a small
capture hook before the null. So "free" applies to anchor-contradiction discards; the name-mismatch
discard costs one capture hook (still no new network calls).

- **Slice 2a (do first):** surface already-captured-but-discarded Claude/Serp results as
  `contactLeads` (incl. `confidence: 'rejected'` with `rejectedReason`); add a pre-null capture hook
  for the name-mismatch SerpAPI case. No new network calls.
- **Slice 2b (defer):** new broad **lead-only scout** searches (the paid, latency-adding part). Gate
  behind measurement (Slice 1) and a hard per-run budget.

### B. Slice 1 (measure first) is correct — keep it first, add one category
Do not commit to the broad scout build until Slice 1 reports the real distribution of missing-email
reasons. Add **`namesake_ambiguous`** (found contact but could not disambiguate among same-name
candidates) — distinct from `searched_no_result`; it is the Smirnova-class failure.

### C. Promote "faculty-page-as-lead" (spec Open Q6) into the FIRST slice
A page link is a pure breadcrumb with near-zero wrong-person risk, the SSRF-safe institution-page
fetcher already exists, and the email is frequently one click away on that page. This is the highest
value-to-risk recovery path and should not be deferred behind email leads.

### D. Specify the confidence scoring — it is the hard part, and currently hand-waved
Computing `nameMatched` / `institutionMatched` from a SerpAPI **snippet** is the same
namesake-disambiguation problem the project has repeatedly hit. Required:
- Define exactly how each `evidence` flag is derived from a snippet/page.
- **Bias labels conservative:** when the name is common or the institution is snippet-only, cap the
  lead at `medium`. A "high-confidence" label on a namesake is the failure mode to prevent. The human
  is the backstop, but the label must not lull them.

### E. Default-on for the workbench (bounded) — not opt-in
An opt-in `useContactLeadSearch` toggle re-creates the manual burden the spec is trying to remove.
Default the **cheap** path (2a + faculty-page leads) ON for staff; gate only the **paid broad scout**
(2b) behind a budget/limit. Quantify: 3-5 queries × ~20 candidates ≈ up to ~100 paid searches/run —
needs a real per-run cap plus the existing "only candidates missing email" filter (spec §5).

### F. Two plumbing/safety items to nail down
- **Roster persistence (spec Open Q3):** prefer **Option A** (compact JSON on the roster cache) from
  v1, AGAINST the spec's "transient first." The review→promote workflow spans reloads; transient leads
  that vanish on reload frustrate the exact workflow this is for. Cost is low — add `contactLeads` to
  the `pruneCandidateForRoster` whitelist; no Dataverse change. Codex: confirm the prune-whitelist is
  the only plumbing needed and that lead payload size is bounded.
- **Promotion → invite confidence:** make it a **tested invariant** that a lead promoted via "Use this
  email" (stamped `manual`) still hits the confirm-before-invite flow and is NOT treated as
  high-confidence merely because the source is `manual` — a promoted lead may be a namesake the staff
  eyeballed quickly. (Spec asserts this at §6 Slice 4; we want a test that locks it.)

## Answers to the spec's Open Questions (§9)

1. **Run scout for unresolved identities?** Yes, but only for **name-grounded** unresolved (has an
   OpenAlex/PubMed footprint). Skip pure zero-footprint / fabricated names — no payoff, and it only
   surfaces strangers.
2. **Hide namesake leads?** Audit expander, not hidden; labeled "possible namesake," never in the
   primary slot.
3. **Persist across reloads?** Yes — Option A (see F).
4. **Per-candidate budget?** Start at **3**, not 5; let Slice 1 measurement justify more.
5. **Require opening source URL before "Use this email"?** No — edit/save + confirm-before-invite is
   enough friction.
6. **Faculty/profile pages as leads even without email?** Yes — highest priority (see C).

## Relationship to the in-flight identity work

There is a separate, Codex-design-reviewed proposal (GO-WITH-CHANGES) to widen the OpenAlex
affiliation match to all of `last_known_institutions` (recovers e.g. Olga Smirnova, whose OpenAlex
last-known flipped to Technion while the proposal places her at Max Born Institute). That work and this
spec are **complementary, not competing** — the affiliation fix moves a few candidates
needs-review→probable (so their search runs), but the leads layer restores utility **regardless** of
whether identity resolves. **Recommendation: prioritize this spec; park the affiliation-history fix**
until the leads layer ships, because the leads layer addresses the owner's actual pain (recall) without
depending on the identity-precision rabbit hole.

## Proposed build order (the thing to agree on)

1. **Slice 1 — Measurement/audit** (missing-email reason buckets, incl. `namesake_ambiguous`).
2. **Slice 2a — Surface already-discarded Claude/Serp results as leads** (no new network cost;
   anchor-contradiction discards are already in `tierResults`, name-mismatch SerpAPI needs a pre-null
   capture hook — see §A) + **faculty-page-as-lead**.
3. **Slice 3 — Candidate-card lead display** (verified contact vs. quarantined leads, unambiguous).
4. **Slice 4 — Staff promotion** ("Use this email" → existing manual edit/save → confirm-before-invite).
5. **Slice 2b — Broad paid lead-only scout**, default-on-but-budget-capped, only if Slice 1 justifies it.
6. **Slice 5 — Durable lead storage:** roster-cache (Option A) from v1; defer any Dataverse schema.

## Asks for Codex

1. Confirm/refute the verified premise + the "dominant buckets" **hypothesis** (anchor = institution OR
   ORCID, so suggestions carrying an institution already search; the big buckets are *likely*
   searched-no-result / has-page-no-email / found-then-discarded — to be measured in Slice 1, not
   asserted). Cite code.
2. Confirm the Slice 2a cost split: anchor-contradiction discards are fully present in `tierResults`
   (surface only, no re-fetch), but the name-mismatch SerpAPI email is destroyed in place at `:612`
   and needs a pre-null capture hook. Confirm the aliasing and whether the Claude tier has the same
   in-place destruction.
3. Adversarially check the wrong-person risk of: (a) faculty-page-as-lead for a common name, (b)
   displaying medium/low leads, (c) promotion → manual → invite. Where does a namesake's contact reach
   an actual invite?
4. Give a GO / GO-WITH-CHANGES / NO-GO on the **reordered** build order, with any required changes.
