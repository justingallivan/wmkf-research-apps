---
title: "Reviewer Fail-Closed Gating — Fresh Strategy Review (prompt for a reviewing LLM)"
domain: reviewers
kind: draft
status: active
summary: "Brief for a fresh reviewing LLM: assess whether reviewer-finder fail-closed gates over-gate or fire at the wrong stage/input, and produce a redesign doc."
canonical: false
cataloged: 2026-07-03
owner: product-engineering
related:
  - lib/services/contact-enrichment-service.js
  - lib/services/reviewer-identity-resolver.js
  - lib/utils/reviewer-invite.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/review-manager/send-emails.js
  - shared/components/reviewers/reviewer-search-logic.js
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md
---

# Reviewer Fail-Closed Gating — Fresh Strategy Review

**You are a fresh reviewing LLM with read access to this repository, including its
skills (`.claude/skills/`, e.g. `contract-reconcile`).** You have not worked on this
code and carry no prior assumptions. Your job is to evaluate a gating *strategy*, not
to fix a single line. Read the source before you conclude; label any claim you make
about current behavior `[VERIFIED via <file:line or probe>]` or `[ASSUMED]`. Use
`contract-reconcile` to trace caller → persistence → consumer where a gate's effect
is non-obvious.

## 1. Your mission

The reviewer-finder subsystem discovers and vets potential grant reviewers, then
lets program directors invite them by email. It is protected by a set of
**fail-closed gates**. The real harm to prevent is **actually sending an invitation
to the wrong person** (a namesake collision emailing a confidential proposal to a
stranger) — NOT surfacing a candidate email for a human to look at.

**Reframed guiding principle (this is a deliberate loosening — apply it throughout):**
the safe default should be **"surface the candidate contact for staff to resolve,"
not "silently drop it."** Staff are in the loop and are good adjudicators; a
best-guess email a program director can confirm or reject in one click is far more
useful than a blank they must go re-find by hand. The confirm-before-invite backstop
at send time (contract 3) is the true wrong-person protection — a gate earlier in the
pipeline that *silently discards* a plausible email is usually solving a problem the
send-time gate already solves, at the cost of recall. Prefer moving uncertainty into
a **staff-visible, one-click-resolvable** surface over dropping it.

We suspect we may have **over-gated, or fired gates at the wrong stage of the
pipeline, or fed gates the wrong input** — to the point where correct, findable
reviewer emails are being discarded and correct people are being suppressed. The
presenting symptom is the "enrichment email-coverage miss" (internally "Cause #2"),
detailed in §3.

**Deliver:** a design document (see §7) that (a) evaluates whether the overall
gating strategy is sound or has painted us into a corner, and (b) proposes a
concrete redesign. You MAY recommend removing or relaxing a silent-drop gate — but
when you do, name the compensating control (usually: surface it to staff for
confirm-before-invite, or route it to a "needs one-click confirm" lane) that keeps a
wrong-person invite from actually being *sent*. The bar is on the send, not on the
surfacing.

## 2. Frame every gate against three separate questions

For each gate, keep these distinct — most of our uncertainty is (b) and (c), not (a):

- **(a) Is the gate itself correct?** — Does the rule encode the right policy at all?
- **(b) Does it fire at the wrong stage / in the wrong order?** — e.g. a per-tier
  inline reject that discards data a later tier could have vindicated; a gate that
  runs before the evidence it needs is available; a gate that runs on every tier
  when it should adjudicate once at the end.
- **(c) Does it consume the wrong input?** — e.g. treating a single OpenAlex
  "last known institution" as ground truth, or applying a local-part name heuristic
  as a hard reject rather than a soft signal.

A recurring hypothesis to test explicitly: **the pipeline rejects candidate contact
inline, per-tier, instead of collecting all candidate evidence and adjudicating
once.** Is a "collect-all-then-decide" architecture safer AND higher-recall than the
current "reject-inline-per-tier" one, or does inline rejection carry a safety
property we would lose? Argue it from the code, not from first principles.

## 3. The presenting evidence (Cause #2), live-verified

A read-only probe over the last 120 days: 482 selected reviewers, 11 with no
invitable email (2.3%). Five are true "enrichment ran, no email surfaced." In
**four of the five, a correct institutional email was found and then discarded by a
gate.** Reviewer names are withheld (confidential reviewer-consideration data);
each case is given by its technical pattern and real example domains:

| # | Correct email pattern (discarded) | Gate that discarded it | Root cause (live-verified) |
|---|---|---|---|
| 1 | `<name>@princeton.edu`, found on a `princeton.edu` page | `verified_domain_contradiction` in `_validateEmailAgainstVerifiedDomain` | OpenAlex `lastKnownInstitution` resolved to the researcher's **other real affiliation** (`hhmi.org`); the guard trusts that single domain and rejects the correct Princeton email. **Legit dual-affiliation.** |
| 2 | `<name>@seas.upenn.edu`, found on a `seas.upenn.edu` page | `verified_domain_contradiction`, same guard | OpenAlex **mis-mapped** the author to a *different, similarly-named institution* (`calu.edu` — a separate school, not UPenn). The guard rejects the correct UPenn email against a garbage domain. **Bad OpenAlex affiliation entity.** |
| 3 | `<truncated-surname>@<med-center>.edu`, correct domain | `name_mismatch` (`ContactParser.isNameConsistentEmail`) | The local part is a truncated surname; the heuristic hard-rejects it even though the domain is the person's real institution. **Local-part heuristic as hard reject.** |
| 4 | `<initials><number>@columbia.edu`, correct domain | `name_mismatch`, same heuristic | Initials+number local part hard-rejected on the correct institutional domain. Same class as #3. |
| 5 | (no email extracted; only a captured faculty-page URL) | n/a — never fetched | The captured page was never fetched/parsed. The fetch tier that would do this exists but is behind a default-off flag (see §5). |

Key structural finding to verify and reason about: **the resolved-page fetch tier
(§5) cannot rescue #1 or #2 even if enabled**, because its fetch is SSRF-bound to
the *same* wrong `verifiedInstitutionDomain` (`hhmi.org` / `calu.edu`), so it would
refuse the correct `princeton.edu` / `upenn.edu` pages. The domain-contradiction
cases can only be fixed in the guard, not by the fetch tier.

## 4. The enrichment pipeline order (read the source; anchors below)

`lib/services/contact-enrichment-service.js`, `enrichCandidate` → `_finalize`:

1. Discovery/affiliation/database email (from the candidate blob).
2. ORCID tier.
3. PubMed tier. *(A recent trusted email here early-returns through `_finalize`.)*
4. Tier 3 `claude_search` (web search) — sets an email, then a name check can flag
   `emailRejectedReason='name_mismatch'` (~line 635).
5. Tier 4 `serp_search` — `isNameConsistentEmail` hard-rejects a mismatched local
   part → `name_mismatch` (~line 696–709).
6. `_finalize` (single exit for every return path, ~line 1124):
   - `_attachOpenAlexMetrics` → **sets `verifiedInstitutionDomain`** from the
     OpenAlex author's last-known institution homepage eTLD+1 (~line 874).
   - `_attachEmailFromResolvedPage` — the flag-gated fetch tier (~line 1064).
   - `_validateEmailAgainstVerifiedDomain` — drops a *search-sourced* email whose
     domain doesn't relate to `verifiedInstitutionDomain` (~line 300–338).
   - `_collectContactLeads` — quarantines discarded contacts as visible-but-unusable
     "leads" (~line 254).
   - `resolveIdentity` + `_applyAffiliationOverride` + `saveToDatabase`.

Then, downstream of enrichment:
- `pruneCandidateForRoster` (`shared/components/reviewers/reviewer-search-logic.js`
  ~line 250) builds the roster DTO and **drops `verifiedInstitutionDomain`** (note:
  this is why a naive roster probe shows it as null even when it was set live).
- Server save gate: `save-candidates.js` `isUnresolvedIdentity` (~line 60),
  `contactBlockedForUnresolvedExempt` (~line 83).
- Invite gate: `review-manager/send-emails.js` recomputes `emailConfidence`
  (`lib/utils/reviewer-invite.js` ~line 94; `HIGH_TRUST_EMAIL_SOURCES` ~line 82) and
  refuses LOW confidence unless allow-listed (`confirmedLowConfidenceIds`).

All line numbers above are starting anchors, not guarantees — confirm each against
the live file, since the code moves.

## 5. The full gate inventory to evaluate

The maintained contract reference is
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (each contract traced to
`file:line`). Read it first. It defines **8 fail-closed contracts**; evaluate the
whole set for over-gating / mis-sequencing / wrong-input, not just the two email
guards:

1. Slice-E identity-unresolved gate (client select stricter than server save).
2. PI-named / cited / referred exemption + contact force-null.
3. Slice-G invite-confidence allowlist (`send-emails.js`).
4. Structured-PI identity (fail-open, augment-only).
5. S240 institution-COI default hard drop (+ durable re-reject at save), with the
   2026-07-03 Phase-C read-only flag exception for single low-trust contradicted
   strings.
6. OpenAlex bibliometrics + verified-domain (the domain source behind guard #1/#2 above).
7. Faculty-page recovery fetch tier — code-default OFF behind
   `REVIEWER_PAGE_EMAIL_TIER_ENABLED`, explicitly enabled in production since
   2026-07-03 (design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`).
8. Work-grounding rescue (additive, forename-gated).

**Scope of redesign:** contracts **1, 3, 6, 7** and the two email guards are in the
blast radius of the email-coverage problem — redesign these. Contracts **2, 4
(structured-PI identity), 5 (institution-COI), and 8** are adjacent: **assess** each
for over-gating/mis-sequencing and flag if you find it implicated in the email miss,
but do **not** propose redesigning them unless you show they are. Keep the redesign
focused on recovering invitable emails.

Also relevant: `docs/agent-wiki/topics/reviewer-identity.md` routes the domain and
names the safety memories (e.g. "verify-fail is dangerous", namesake-collision
worked example).

## 6. Specific tensions we want your judgment on

1. **Single-domain trust (guards #1/#2, contract 6).** `verifiedInstitutionDomain`
   is one OpenAlex-derived eTLD+1. Real researchers have multiple valid affiliations,
   and OpenAlex mis-maps affiliations. Should the domain check validate against the
   *set* of a candidate's affiliation signals (discovery affiliation + OpenAlex +
   ORCID) rather than one domain? What breaks if we do — does the namesake
   protection weaken, and how would we keep it?
2. **Local-part name heuristic as a hard reject (guards #3/#4).** `isNameConsistentEmail`
   correctly rejects role inboxes (`office@…`) but also rejects real truncated/initial
   addresses on the correct domain. Should a *domain-confirmed* email be immune to the
   local-part heuristic (domain match = grounding), leaving the heuristic as a soft
   signal only? The resolved-page design already argues page-grounding should trump
   the local-part heuristic — should that principle generalize?
3. **Inline reject vs. collect-then-adjudicate.** See §2. Does the per-tier inline
   discard cause us to throw away evidence (e.g. a correct email from tier 4) that a
   later signal (OpenAlex affiliation, faculty page) could have vindicated — and would
   a single end-of-pipeline adjudication be both safer and higher-recall?
4. **Client/server asymmetry (contract 1).** The client select list is intentionally
   stricter than the server save gate. Is that asymmetry still earning its keep, or is
   it a source of confusing double-gating?
5. **Where the flag sits.** Is a global default-off fetch tier the right shape, or
   should page-grounding be part of the core adjudication rather than an opt-in tier?

## 7. Deliverable

Write a design document to `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` (repo
frontmatter style: `title/domain/kind/status/summary/canonical/cataloged/owner/related`;
`kind: spec`, `status: active`, `canonical: false`). It must contain:

1. **Verdict on the strategy** — is the current fail-closed gating sound, over-gated,
   or mis-sequenced? Answer §2(a/b/c) per gate for at least contracts 1, 3, 6, 7 and
   the two email guards; a short table is fine.
2. **The corner, if any** — name the specific architectural decision(s) that trade
   recall for a safety property we may not actually be getting, with the code
   evidence.
3. **Concrete redesign** — for each change: which gate moves where, what input it
   should consume, and — mandatory for any loosening — the compensating control that
   preserves wrong-person-invite protection. Cover the two email guards, the fetch
   tier's placement, and any of contracts 1/3 you find mis-sequenced.
4. **Migration / rollout** — how to ship incrementally behind the existing safety
   posture; what to measure (recall on the Cause #2 population; any new false-positive
   risk); and the tests/gates to add.
5. **Explicit non-goals and residual risks** — what you are deliberately not changing
   and why.

**Concrete pass/fail bar (use the §3 five as the test case):** your redesign should
recover, or route to a one-click staff-confirm lane, **all 5** of the §3 cases —
minimally the 4 where a correct email was already found and discarded — **without
opening any path by which an invitation is actually *sent* to an unconfirmed
wrong-person email.** Walk each of the 5 through your proposed pipeline and show the
outcome (recovered / surfaced-for-confirm / still-dropped-and-why).

Constraints: cite `file:line` for every current-behavior claim; do not name the
withheld reviewers; you may relax or remove a *silent-drop* gate, but each such change
must name the compensating control that keeps a wrong-person invite from being sent
(surface-for-confirm is an acceptable control — see §1); prefer the simplest change
that clears the pass/fail bar above.

## 8. Where to start

1. `docs/agent-wiki/topics/reviewer-identity.md` (domain map + safety memories).
2. `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (the 8 contracts, traced).
3. `lib/services/contact-enrichment-service.js` — read `enrichCandidate`,
   `_finalize`, `_validateEmailAgainstVerifiedDomain`, `_attachEmailFromResolvedPage`,
   `_attachOpenAlexMetrics`, `_collectContactLeads`.
4. `lib/utils/reviewer-invite.js` (`emailConfidence`, `HIGH_TRUST_EMAIL_SOURCES`),
   `pages/api/reviewer-finder/save-candidates.js` (`isUnresolvedIdentity`),
   `pages/api/review-manager/send-emails.js` (invite-confidence gate).
5. `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md` (the fetch tier's design + limitations).
