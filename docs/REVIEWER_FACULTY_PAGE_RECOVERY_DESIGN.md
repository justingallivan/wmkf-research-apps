# Reviewer Faculty-Page Email Recovery (Slice F) — Design

Date: 2026-06-08 (S235)
Status: **DECISION (2026-06-08, S235): the automated server-side fetch (§2–§5 below) was
DESIGNED + Codex-reviewed (READY WITH NAMED CHANGES) but NOT BUILT.** Per Codex Q6 and a
user decision, we shipped the **zero-SSRF alternative** instead (see "## D. Decision +
shipped" immediately below). The auto-fetch design is retained as a record of what was
considered + Codex's verified SSRF mechanism, in case it's revisited. Implements Slice F of
`docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` §3.

State labels: [VERIFIED] = read in source this session; [ASSUMED] = inference.

## D. Decision + shipped (zero-SSRF)

Codex validated the automated fetch as buildable-but-complex (DNS-rebind IP-pinning, a new
`undici` dependency, private-IP blocklist incl. IPv6, streaming caps) and surfaced a
**zero-SSRF alternative** that delivers most of the value with none of the surface: the app
already persists `facultyPageUrl`, so just surface it to staff. **Chosen + IMPLEMENTED:**
- `my-candidates` GET now selects `wmkf_facultypageurl` and returns `facultyPageUrl` in the
  candidate DTO.
- `CandidatesPanel` "no email — can't invite" state is now actionable: when a
  `facultyPageUrl`/`website` exists it shows a **"find on faculty page →"** link (opens the
  page in a new tab) so staff read the reviewer's real address and enter it via the existing
  Edit flow (`CandidateEditModal` → `my-candidates` PATCH).
- That manual entry already stamps `emailSource='manual'` (Slice G 3a) → the address is
  LOW-confidence → the Slice-G invite gate shows the warning + one-click "confirm & send".

So the full loop — *no email → open the right page → enter the address → confirmed-before-
invite* — is delivered with **no server fetch, no SSRF surface, no new dependency**, reusing
Slices E/G. The §2–§5 automated design below is NOT built.

## 0. Goal
When a confirmed/anchored reviewer candidate has NO accepted email but we DO hold an
institution page on the anchored domain, fetch that page and parse the email — so a
high-value reviewer can actually be invited (the email is the product goal). Identity-safe
(anchored candidates only) and SSRF-guarded.

## 1. Grounded current state
- [VERIFIED] `lib/utils/safe-fetch.js` exports `safeFetch`/`isAllowedUrl`: HTTPS-only, a
  FIXED `ALLOWED_HOSTS` regex allowlist, manual per-hop redirect validation (`MAX_REDIRECTS=5`).
  Gaps for faculty pages: (a) no DNS resolution / private-IP check — the allowlist is
  hostname-regex only, so a host that *resolves* to an internal IP would pass; (b) no
  max-body cap; (c) no content-type gate; (d) the allowlist is a fixed set, no per-call
  dynamic institution domain.
- [VERIFIED] `ContactParser.extractEmails(text)` (`lib/utils/contact-parser.js:16`) is a pure
  regex extractor (no LLM) — returns all emails in text, lowercased, false-positive-filtered.
- [VERIFIED] In `contact-enrichment-service.js`: `_effectiveInstitution(candidate, ce)` (the
  anchored institution), `_hasOrcidAnchor(candidate, ce)`, `_normalizeDomain(...)`,
  `ce.verifiedInstitutionDomain` (verified institutional domain; Slice 1b re-sourced it from
  the OpenAlex author's institution homepage — was the Google-Scholar self-reported domain
  `ce.scholarVerifiedEmail`),
  `ce.facultyPageUrl`, `ce.emailPersistAllowed`, and `_validateEmailAgainstVerifiedDomain(ce)`
  (runs in `_finalize`, sets `emailPersistAllowed` on a domain match). These are the anchor +
  validation primitives Slice F reuses.
- [VERIFIED] No page-fetch-and-parse exists anywhere today; `SerpContactService` reads SerpAPI
  *snippets* only (disconfirming grep: no `text/html`/`fetchPage`/`fetchHtml` pipeline in
  `lib`/`pages` outside tests).
- [VERIFIED] No existing private-IP / DNS-SSRF helper to reuse — must be built fresh
  (`cloudmersive-scan.js` uses `undici` only for a multipart upload, no IP checks).
- [VERIFIED] `undici` is already an available dep (used by `cloudmersive-scan.js`) → usable
  for the IP-pinning dispatcher in §4.2. `jsdom` is also a dep, but extraction stays **regex**
  (`ContactParser`) — parsing attacker-controlled HTML through a DOM is a larger surface than a
  byte-regex, and the plan mandates regex-not-LLM.

## 2. Where it runs — ON-DEMAND endpoint (not a tier) [recommended]
A new staff-triggered endpoint `POST /api/reviewer-finder/recover-faculty-email` (guarded by
`requireAppAccess('reviewer-finder','reviewers')`), NOT a new Tier 5 in `enrichCandidate`.
Rationale: (a) latency — the binding constraint (a PD won't wait); a per-candidate fetch on
every discovery run would slow the whole list, whereas on-demand fetches one candidate only
when staff ask; (b) SSRF exposure is bounded to an explicit staff action; (c) it composes
with the Slice-G invite flow (staff hit "recover email" on a confirmed candidate with no
address). Promote to a tier later only if it pays off.

## 3. F1 — trigger (narrow, identity-safe)
Recover ONLY when ALL hold (server re-checks; never trusts the client):
- the candidate is **identity-anchored**: `_effectiveInstitution` present OR `_hasOrcidAnchor`;
- there is **no accepted email** (`!emailPersistAllowed` / no persisted `wmkf_emailaddress`);
- a `facultyPageUrl`/`website` is present whose host **matches the anchored institution
  domain** (the `verifiedInstitutionDomain`, or the effective-institution domain).
Never for abstained/unanchored candidates. At most once per candidate per request (bounded).

## 4. F2 — hardened fetch (SECURITY-CRITICAL; EXTEND `safe-fetch.js`, do NOT write a new wrapper)
Add an opt-in hardened mode to `safe-fetch.js` (new export, e.g.
`safeFetchExternalPage(url, { allowedDomain, maxBytes, allowedContentTypes })`) that REUSES the
existing HTTPS + manual-redirect-per-hop logic and ADDS, on every hop:
1. **Dynamic per-call allowlist** — the host must equal or be a subdomain of `allowedDomain`
   (the anchored institution domain). The fixed `ALLOWED_HOSTS` does NOT apply here; this is a
   separate, caller-supplied single-domain allowlist.
2. **DNS resolution + private-IP rejection** — resolve the hostname (`dns.lookup`, all
   addresses) and REJECT if any resolved IP is loopback/private/link-local/reserved
   (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, etc.). Re-checked after
   each redirect. **[Codex Q1 — the key SSRF question]** To close the DNS-rebind TOCTOU window
   (host re-resolves to an internal IP between check and connect), PIN the validated IP: use
   an undici dispatcher / `connect.lookup` that returns only the pre-validated address and
   rejects a mismatch. Is full IP-pinning required here, or is resolve-then-check sufficient
   given the domain is NOT free user input (it comes from the verified institutional
   domain / anchored institution)? Recommend pinning — it's the correct SSRF posture.
3. **max-body cap** — enforce a byte limit WHILE streaming the body (don't trust
   `Content-Length` alone); abort past `maxBytes` (e.g. 2 MB).
4. **content-type gate** — only read the body when `Content-Type` is `text/html` (or `text/*`).
Extraction is **regex only** (`ContactParser.extractEmails`), NEVER an LLM — faculty-page HTML
is attacker-controllable, so an LLM here is a prompt-injection vector.

## 5. F3 — validation + persistence
The parsed email is still run through `_validateEmailAgainstVerifiedDomain` (domain must match
the anchored/verified institutional domain). On a match: set `emailSource: 'institution_page'`,
`emailPersistAllowed: true`, and treat it as HIGH-confidence (NOT in the droppable
search-source set; and HIGH for the Slice-G invite gate — `institution_page` is already in the
Slice-G HIGH set). Persist via the same field-gated save path. Pick the email whose domain
matches the anchored domain when the page yields several.

## 6. Out of scope
- Email-pattern construction; SMTP/MX verification; bulk page-fetch for the whole list.
- Obfuscated-email decoding ("name [at] domain") beyond what the regex catches.
- A real Tier 5 (deferred; on-demand first).

## Q. Questions for Codex
1. **SSRF (§4.2):** is resolve-then-check-private-IP sufficient, or is full IP-pinning
   (undici `connect.lookup` returning the validated IP) required, given the domain is derived
   from the verified institutional domain, not free user input? What's the correct
   Node/undici mechanism to pin the IP through `fetch` + manual redirects in THIS codebase?
2. **Extend vs new module:** add `safeFetchExternalPage` to `safe-fetch.js` (one wrapper, your
   plan-review guidance) vs a `lib/utils/faculty-page-fetch.js` that composes safe-fetch
   primitives — which keeps the SSRF logic most reviewable?
3. **Trigger (§3):** is "host matches the anchored institution domain" the right safety
   predicate, and where does the anchored domain most reliably come from
   (`verifiedInstitutionDomain` vs `_effectiveInstitution`)?
4. **Endpoint vs tier (§2):** on-demand endpoint over Tier-5 — agree given the latency budget?
5. **maxBytes / content-type:** right caps; any header/stream-handling gotcha with undici in
   this Next.js runtime?
6. Anything mis-scoped, or a simpler path to "recover the anchored reviewer's real email
   without opening an SSRF hole."
