# Reviewer Follow-on Plan: Deferred-Candidate Gating (Fix E) + Invite-Confidence + Faculty-Page Email Recovery

Date: 2026-06-08
Status: PROPOSED — for Codex review before implementation.
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

---

## 2. Slice E — deferred/unanchored candidates must not be silently selectable

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
- **E3 (defense-in-depth, server):** `save-candidates.js` should refuse to write a *selected suggestion* for
  a candidate whose `provenanceGroupOf`/identity is `needs_identity_review`/unresolved (it already nulls
  their contact via Fix C; this stops the row itself). Belt-and-suspenders against a stale client.

Open question: a "needs identity review" candidate is still a legitimate person staff may want to pursue —
should the read-only card offer a "resolve identity" action (re-run the work-author resolver on demand) or
just display? (Out of scope to build; flag the UX seam.)

---

## 3. Slice F — faculty-page email recovery (identity-safe, SSRF-guarded)

Goal: when a confirmed/anchored candidate has no accepted email but we DO have an institution page on the
anchored domain, fetch it and parse the email.

- **F1 (trigger, narrow):** only for candidates that are identity-anchored (ORCID or work-grounded) AND have
  no `emailPersistAllowed` email AND carry a `facultyPageUrl`/`website` whose host matches the anchored
  institution domain (or the Scholar-verified domain). Never for abstained/unanchored candidates. Runs at
  most once per such candidate (bounded; latency-aware — only the candidates we actually want).
- **F2 (safe fetch — SECURITY-CRITICAL):** new helper (e.g. `SerpContactService.fetchPageEmail(url, {anchorDomain})`)
  that fetches ONLY when the URL host resolves to the anchored institution domain; enforce: https-only,
  no off-host redirects, timeout, max-body-size, and **regex extraction (ContactParser), not an LLM**, so
  there is no prompt-injection surface. This is new outbound-fetch surface — must be reviewed against the
  security posture (SSRF/allowlist). Consider whether it belongs behind an explicit opt-in flag like the
  existing paid tiers.
- **F3 (validation):** a parsed email is still run through `_validateEmailAgainstVerifiedDomain` (domain
  must match the anchored/Scholar domain) and gets `emailSource: 'institution_page'`, treated as
  high-confidence (NOT in the droppable search-source set).

Open question: do we add this as a real "Tier 5" in `enrichCandidate`, or a separate on-demand recovery
endpoint staff trigger for a specific candidate (cheaper, avoids fetching for the whole list)? Recommend
**on-demand** first (lower latency/SSRF exposure), promote to a tier later if it pays off.

---

## 4. Slice G — invite-confidence gating (never email an unconfirmed address)

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

Recommendation: **G-opt1 first** (achieves the safety goal — you cannot auto-email an unconfirmed address —
with no schema change), and only add the field (G-opt2) if staff need an explicit per-row "confirmed" state
distinct from "has a persisted email."

---

## 5. Sequencing
1. **Slice E** — self-contained, no new infra; closes the known anchor-or-abstain UI hole. Ship first.
2. **Slice G-opt1** — invite safety with no schema change; pairs with the Fix C persistence floor.
3. **Slice F (on-demand)** — email recovery; new fetch surface, needs the security review. Highest value
   for "actually invite the reviewer," but most review-heavy.
4. **G-opt2 field** — only if G-opt1 proves insufficient.

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
