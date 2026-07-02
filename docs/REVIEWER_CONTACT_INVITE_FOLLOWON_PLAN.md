---
title: "Reviewer Follow-on Plan: Deferred-Candidate Gating (Fix E) + Invite-Confidence + Faculty-Page Email Recovery"
domain: reviewer-workbench
kind: plan
status: active
summary: "Date: 2026-06-08 corrections folded in (see \"## R. Codex review corrections\")."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - pages/api/review-manager/send-emails.js
  - lib/utils/safe-fetch.js
  - pages/api/reviewer-finder/my-candidates.js
---

# Reviewer Follow-on Plan: Deferred-Candidate Gating (Fix E) + Invite-Confidence + Faculty-Page Email Recovery

Date: 2026-06-08
Status: Slice E IMPLEMENTED 2026-06-08 (S235, see §2); Slices G/F PROPOSED — Codex-reviewed 2026-06-08;
corrections folded in (see "## R. Codex review corrections").
Author: Claude (Opus 4.8). Builds on the merged-pending branch `reviewer-contact-anchor-fixes`
(Fixes A–D + Scholar-verified-domain validation) and its design docs
(`REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md`, `..._REVIEW(_2/_3)`).

State labels: [VERIFIED] = read in source this session; [SUBAGENT] = reported by an Explore pass,
re-verify before implementing; [ASSUMED] = inference. Per `docs/CLAUDE_REMEDIATION_PLAN.md`, treat
destructive/schema items as unverified until checked.

---

## 0. Why this slice

Fixes A–D made contact enrichment *safe* (anchor-or-abstain; identity-confirmed ≠ contact-validated) and
the Scholar-verified-domain check *recovers* a real institutional email (Smirnova → mbi-berlin.de). Two
gaps remain, both surfaced during that work:

1. **Deferred Track-B candidates are silently selectable (Fix E, deferred from the A–D slice).**
2. **The product goal is to *invite* the reviewer by email.** When enrichment abstains or the snippet
   yields no address, a confirmed, high-value reviewer currently has no email — so they can't be invited.
   We want to (a) recover the email from the institution's own page when possible, and (b) make the invite
   step safe regardless (never email an unconfirmed/namesake address).

---

## 1. Current state (grounded)

### 1a. Deferred Track-B candidates
- [VERIFIED] `discovery-service.js`: `TRACK_B_IDENTITY_RESOLUTION_LIMIT = 25`; `toResolve = ranked.slice(0,25)`,
  `deferred = ranked.slice(25)`; `[...resolvedTrackB, ...deferred]` merged into `results.discovered`.
  Deferred candidates skip `mapTrackBIdentityResult`, so they carry **no** `identityStatus`/`needsIdentification`.
- [VERIFIED] `reviewer-provenance.js` `provenanceGroupOf`: routes to `needs_identity_review` ONLY when
  `needsIdentification || identityStatus==='unresolved' || verificationStatus==='unresolved'`. So deferred
  candidates fall into the **selectable** `literature_retrieved` group.
- [SUBAGENT] `ReviewerSearchSection.js`: `displayCandidates` grouped into provenance sections (~:797–818);
  the `needs_identity_review` section renders toggleable `CandidateCard`s at ~:1022 (no `readOnly`), unlike
  the `unverified` section (~:1066, `readOnly`). `toggleAll` (~:677) selects EVERY `displayCandidate`; the
  save handler (~:728) POSTs whatever is `selected` with no provenance filter. `save-candidates.js` does not
  reject unresolved candidates (relies on the UI).

### 1b. Invite send path
- [SUBAGENT] `pages/api/review-manager/send-emails.js` (~:251): recipient = the **potential-reviewer**
  record's `wmkf_emailaddress`. If absent → skip `no_email` (~:254). Duplicate-invite guard via
  `shouldSkipDuplicateInvitation` (reviewer-invite.js) when `wmkf_invited` and `!allowResend`. **No
  email-confidence/trust gate before send.**
- [SUBAGENT] No existing "contact confidence / needs-confirmation" field on the suggestion or
  potential-reviewer entity. `wmkf_revieweremail` is a POST-accept self-report, not the send-to address.
- [VERIFIED, this branch] Fix C already gates persistence: a low-confidence email has
  `emailPersistAllowed=false` and is NOT written to the person record → the invite path already skips it as
  `no_email`. So a *floor* of protection exists; what's missing is recovery + a surfaced confirm path.

### 1c. Faculty-page email recovery
- [SUBAGENT] `ContactParser` is text-only (`extractEmails`/`extractPrimaryEmail`/`extractContactFromPublications`);
  `SerpContactService.findContact` reads SerpAPI *snippets*, never fetches page HTML. No page-fetch-and-parse
  exists anywhere.
- [VERIFIED, this branch] `contactEnrichment` already carries `facultyPageUrl` and `website`, and the
  raw `tierResults.serp_search.{facultyPageUrl,website}` (e.g. for Smirnova, `mbi-berlin.de/p/olgasmirnova`).
- [VERIFIED 2026-06-08] `lib/utils/safe-fetch.js` ALREADY EXISTS (`safeFetch`/`isAllowedUrl`): HTTPS-only,
  a FIXED `ALLOWED_HOSTS` regex allowlist, and a manual-redirect cap (`MAX_REDIRECTS`). Slice F must REUSE
  and extend it — not write a new wrapper. Gaps for faculty-page use: it has no DNS/private-IP (rebind)
  check, no max-body cap, no content-type gate, and its allowlist is a fixed set (no per-call dynamic
  institution-domain allowlist).

### 1d. Manual email-entry path (G-opt1 bypass)
- [VERIFIED 2026-06-08] `pages/api/reviewer-finder/my-candidates.js:436` writes a staff-entered `email`
  straight to the potential-reviewer person record (`personUpdates.email = email`). So the Fix-C
  enrichment-time persistence gate is NOT the only writer of `wmkf_emailaddress` — a manual edit bypasses
  it, and `send-emails` then trusts that address. Any "no auto-invite to an unconfirmed email" guarantee
  must account for this path, not just the enrichment path.

---

## 2. Slice E — deferred/unanchored candidates must not be silently selectable

**Status: IMPLEMENTED 2026-06-08 (S235).** E1+E2+E3 built as specified, plus a new **E1b** the plan's
pre-flight surfaced: the durable Find-roster's `pruneCandidateForRoster` dropped `identityStatus`/
`needsIdentification`/`verificationStatus`, so a deferred candidate stamped at discovery would lose the
marker on reload and re-surface as selectable (reload-leak). E1b persists those three markers through the
roster DTO; a regression test asserts `provenanceGroupOf(pruned)==='needs_identity_review'` survives the
round-trip. Pre-flight also confirmed: no legitimate "pursue anyway" flow exists (so the 422 is safe), and
the standalone `reviewer-finder.js` page (no client identity grouping) is covered by the E3 server reject
because its `discoveryResult.ranked` carries the stamp. Build + 70/70 jest + 11/11 offline smoke green.

**Codex post-impl review (folded in):** (HIGH) the standalone `reviewer-finder.js` now also gates select-all/
toggle/save on `provenanceGroupOf` + renders a read-only "Needs identity review" group + surfaces
`rejectedUnresolved` on partial saves (was silent-success before). (MEDIUM) `provenanceGroupOf`'s
barred/unknown-kind fallback no longer gates a positively-resolved row (confirmed/probable/verified) — a
BARRED Track-A row upgraded by a shared-ORCID Track-B match is now a legitimate, selectable reviewer on BOTH
clients (Codex's "split the client group" option). The server save gate intentionally stays on the EXPLICIT
unresolved triple (NOT the full `provenanceGroupOf`): a BARRED-no-top-level-identity row with a resolver
verdict is legitimately saved here with field-level gating (proven by `reviewer-route-identity-gate` tests),
so the client select list is deliberately stricter than the server save gate. Re-verified: build + jest +
11/11 smoke green.

Goal: a candidate the system could not identity-resolve is visible but NOT selectable/savable as a vetted
reviewer (anchor-or-abstain at the UI/persistence boundary).

- **E1 (discovery):** in `discovery-service.js`, stamp deferred Track-B candidates with an explicit
  unresolved identity before they enter `results.discovered` (`needsIdentification: true` /
  `identityStatus: 'unresolved'`), so `provenanceGroupOf` routes them to `needs_identity_review`. Do this
  AFTER resolved mapping so it never overwrites a confirmed/probable row; the shared-ORCID merge
  (`mergeTrackBWithNeedsReviewBySharedOrcid`, only fires on `openAlexAuthorId`+confirmed/probable) is
  unaffected. Log the deferred count to the user (no silent truncation).
- **E2 (UI):** render the `needs_identity_review` section `readOnly` (like `unverified`) — no checkbox; show
  an identity-review affordance. Exclude `needs_identity_review` rows from `toggleAll` (select-all) and from
  the `selected`/`chosen` save set (`ReviewerSearchSection.js` ~:677 and ~:728: filter
  `provenanceGroupOf(c) !== 'needs_identity_review'`).
- **E3 (server HARD-reject — required, not just belt-and-suspenders):** [Codex] `save-candidates.js`
  currently gates *fields* but still writes the person + selected-suggestion rows, so the client gate alone
  is insufficient. The server must **hard-reject** a candidate whose incoming DTO has
  `identityStatus === 'unresolved'` (return 422 for that row; write neither the person nor the suggestion).
  Gate on the DTO `identityStatus` (the client key is `provenanceGroupOf`; the server receives the field).
  PRE-FLIGHT before coding: confirm no legitimate flow intentionally saves a needs-review candidate (e.g. a
  staff "pursue anyway"); if one exists, make E3 a soft "save as non-selected/needs-review" instead of a
  hard 422.

Open question: a "needs identity review" candidate is still a legitimate person staff may want to pursue —
should the read-only card offer a "resolve identity" action (re-run the work-author resolver on demand) or
just display? (Out of scope to build; flag the UX seam.)

---

## 3. Slice F — faculty-page email recovery (identity-safe, SSRF-guarded)

> **Update (S265):** the automated server-side fetch WAS built (with the named SSRF mechanism),
> behind `REVIEWER_PAGE_EMAIL_TIER_ENABLED` (**default OFF — the live default is still the
> zero-SSRF path below**). Live design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`; contract #7
> in `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`.
>
> **Status (S235): SHIPPED via the ZERO-SSRF path** (not the automated fetch below). The
> automated server-side fetch was designed + Codex-reviewed (READY WITH NAMED CHANGES) but NOT
> built; per Codex Q6 we surfaced the already-persisted `facultyPageUrl` as a "find on faculty
> page →" link on no-email candidates and let staff enter the address via the existing manual
> edit (→ `emailSource='manual'` → Slice-G confirm-before-invite). No server fetch, no SSRF
> surface, no new dependency. Full design + decision in
> `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` (§D). The sketch below is the automated
> design that was NOT built.

Goal: when a confirmed/anchored candidate has no accepted email but we DO have an institution page on the
anchored domain, fetch it and parse the email.

- **F1 (trigger, narrow):** only for candidates that are identity-anchored (ORCID or work-grounded) AND have
  no `emailPersistAllowed` email AND carry a `facultyPageUrl`/`website` whose host matches the anchored
  institution domain (or the Scholar-verified domain). Never for abstained/unanchored candidates. Runs at
  most once per such candidate (bounded; latency-aware — only the candidates we actually want).
- **F2 (safe fetch — SECURITY-CRITICAL; REUSE + EXTEND `lib/utils/safe-fetch.js`):** [Codex] do NOT write a
  new fetch wrapper. Build on `safeFetch` (already gives HTTPS-only, host allowlist, redirect cap) and ADD
  the gaps it lacks before using it for faculty pages: (1) a **per-call dynamic allowlist** = the anchored
  institution domain only (its fixed `ALLOWED_HOSTS` won't cover institution domains); (2) **DNS/private-IP
  (rebind) protection** — resolve the host and reject RFC-1918/loopback/link-local, re-checked after any
  redirect (the highest-risk gap, since the allowlist domain is dynamic per-institution); (3) **max-body
  cap** (stream truncation / content-length); (4) **content-type gate** (only parse `text/html`). Extract
  with **regex (ContactParser), never an LLM** — faculty-page HTML is attacker-controllable, so an LLM here
  is a prompt-injection vector. Put it behind an explicit opt-in like the existing paid tiers.
- **F3 (validation):** a parsed email is still run through `_validateEmailAgainstVerifiedDomain` (domain
  must match the anchored/Scholar domain) and gets `emailSource: 'institution_page'`, treated as
  high-confidence (NOT in the droppable search-source set).

Open question: do we add this as a real "Tier 5" in `enrichCandidate`, or a separate on-demand recovery
endpoint staff trigger for a specific candidate (cheaper, avoids fetching for the whole list)? Recommend
**on-demand** first (lower latency/SSRF exposure), promote to a tier later if it pays off.

---

## 4. Slice G — invite-confidence gating (never email an unconfirmed address)

> **Status (S235): IMPLEMENTED** on branch `reviewer-slice-g-invite-confidence` (design +
> impl notes in `docs/REVIEWER_INVITE_CONFIDENCE_DESIGN.md`). G-opt1 + manual-confirm; no
> schema change; warning + one-click "confirm & send"; server-enforced
> recipient-specific `confirmedLowConfidenceIds` allowlist, scoped to
> `templateType==='invitation'`. The summary below is the original plan-level sketch — the
> design doc is authoritative.

Goal: the invite send is the high-stakes action; it must only auto-send to a high-confidence address, else
route to a staff "confirm contact" step.

Define **email confidence** from signals we already hold (no model call):
- HIGH: `emailSource ∈ {orcid, pubmed, institution_page}` OR a `serp/claude` email whose domain MATCHED the
  Scholar-verified domain.
- LOW/UNCONFIRMED: a `serp/claude` email with no verified-domain corroboration; or none.

Two implementation options (Codex to weigh in):
- **G-opt1 (no schema change):** lean on Fix C — only HIGH-confidence emails are persisted to
  `wmkf_emailaddress`; LOW/none never reach it, so `send-emails` already skips `no_email`. Add a UI
  surface so staff SEE the unconfirmed candidate email + the identity/affiliation/Scholar-domain/profile
  link and can confirm-and-save it (promoting it to persisted). Minimal infra.
- **G-opt2 (new field):** add a contact-confidence flag to the suggestion/potential-reviewer entity
  (e.g. `wmkf_emailconfirmed` bool, or a confidence picklist) stamped at save; `send-emails.js` gates on it
  before line ~:254; UI shows a "confirm before sending" state. More complete, but a **Dataverse schema
  change** ([SUBAGENT] no such field today) — must follow `project-dataverse-schema-deploy-gotchas`, the
  no-PII rule, and "expand enums over new child tables."

**G-opt1 does NOT fully achieve the safety goal by itself.** [Codex, verified §1d] the manual-edit path
(`my-candidates.js:436`) writes `wmkf_emailaddress` directly, bypassing the Fix-C enrichment gate, and
`send-emails` trusts it. So G-opt1 must be paired with a **manual-confirm gate**: a staff-entered/unconfirmed
address must be explicitly confirmed before `send-emails` will auto-send to it (either a confirm step in the
manual-edit UI, or the send path refusing an address that lacks a confirmation marker). Without that, G-opt1
only covers the enrichment path.

Recommendation: **G-opt1 + manual-confirm gate first** (no schema change; closes both the enrichment and
manual-edit writers). Add the field (G-opt2) only if an auditable *send-time* "email was confidence-gated"
record is a hard requirement, or staff need a per-row "confirmed" state distinct from "has a persisted email."

---

## 5. Sequencing (revised per Codex)
1. ✅ **Slice E hard-block (DONE S235)** — client eligibility gate (toggleAll/save) + **server 422** for
   unresolved rows + E1 discovery stamp + E1b roster-marker persistence. Pure defensive addition, no new infra.
2. ✅ **Slice G-opt1 + manual-confirm gate (DONE S235)** — enrichment floor + the manual-edit confirm gate
   that closes the `my-candidates.js` bypass. No schema change.
3. ✅ **Slice F (DONE S235 — ZERO-SSRF path, not the hardened fetch)** — the automated server-side fetch was
   Codex-reviewed but NOT built (see §3 banner); instead we surface the persisted `facultyPageUrl` as a
   staff link and route the address through the Slice-G manual/confirm flow. No SSRF surface, no new dep.
4. **G-opt2 field** — only if a send-time audit guarantee is a hard requirement. NOT built.

---

## 6. Questions for Codex
1. Slice E1: is stamping deferred candidates `identityStatus:'unresolved'` in discovery safe against ALL
   consumers of `results.discovered` (ranking, roster recordSurfaced, the workbench client), or does some
   consumer assume discovered rows are resolved? Any interaction with the durable Find-roster
   (`recordSurfaced`) storing a now-unresolved row?
2. Slice E2/E3: is filtering by `provenanceGroupOf(c) !== 'needs_identity_review'` in `toggleAll`/save the
   right key, and should the server (`save-candidates`) hard-reject unresolved rows or just null their
   fields? Any legitimate flow that saves a needs-review candidate on purpose?
3. Slice F2: is a domain-allowlisted server-side page fetch acceptable here, and what's the right SSRF
   guard set in THIS codebase (existing safe-fetch util? `lib/services/llm-client.js`/A7 patterns)? Tier-5
   vs on-demand endpoint — which fits the latency budget and security posture better?
4. Slice G: is the Fix-C persistence floor (G-opt1) actually sufficient to guarantee "no auto-invite to an
   unconfirmed email," given the send path reads `wmkf_emailaddress` directly? Any path that could write a
   low-confidence email to that field today?
5. Confidence definition: is "Scholar-verified-domain match OR orcid/pubmed/institution_page source" the
   right HIGH bar, or too strict/loose for the invite gate?
6. Anything mis-scoped, or a simpler path to the same safety/recovery outcome.

## 7. Out of scope (explicit)
- Email-pattern *construction* (firstname.lastname@domain guessing) — too unreliable for an invite address.
- SMTP/MX verification of addresses.
- Bulk page-fetch for every discovered candidate (latency/SSRF) — recovery is per-candidate, anchored only.
- Re-running discovery/identity automatically (the "resolve identity on demand" UX is noted but not built).

## R. Codex review corrections (2026-06-08)
Codex reviewed this plan and gave "needs changes" (design-level, not blocking). Corrections folded in above:
1. **Two current-state claims were wrong** → fixed: `lib/utils/safe-fetch.js` ALREADY EXISTS (reuse it, §1c
   + Slice F2); `save-candidates.js` does NOT hard-reject unresolved rows today (it gates fields only), so
   Slice E needs an explicit server 422 (E3).
2. **G-opt1 bypass found** → the manual email-edit path `my-candidates.js:436` writes `wmkf_emailaddress`
   directly, so the Fix-C floor isn't a full guarantee; G now requires a manual-confirm gate (§1d, Slice G).
3. **Slice F SSRF gaps enumerated** → safe-fetch lacks DNS/private-IP (rebind), max-body, content-type, and
   per-call dynamic allowlist; on-demand over Tier-5; regex-not-LLM extraction confirmed (Slice F2).
Codex confirmed the answers to all six §6 questions (provenanceGroupOf is the right client key / DTO
identityStatus on the server; 422 hard-reject; on-demand fetch; G-opt1 insufficient alone; HIGH bar correct
with domain-anchoring; regex-only mandatory). Full review text is in the session transcript (Codex sandbox
was read-only and could not write `..._REVIEW.md`).
