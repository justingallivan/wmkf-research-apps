# External capability-token policy audit — 2026-09-01

**Status:** COMPLETE — source and durable-document audit; no runtime changes made  
**Scope:** every repository surface that issues or consumes a bearer token used as a human-facing magic link, browser upload capability, proof/confirmation receipt, or internal browser-carried authorization receipt  
**Trigger:** a reviewer reminder replaced the reviewer's original portal token while the reviewer was authoring a review

## Executive conclusion

This was not an isolated bad reminder. The reviewer portal has a systemic token-lifecycle defect.

Routine reviewer communications — invitations, materials messages, follow-ups, manual reminders, and scheduled reminders — mint a replacement token and overwrite the only stored token hash. The prior link stops working immediately. Both the general email path and the reminder path persist that replacement authority **before** email delivery is known to have succeeded. A failed send can therefore destroy the recipient's working link without delivering its replacement. `[VERIFIED via lib/services/review-manager/send-emails-service.js:614-681; lib/services/reviewer-reminder-sweep.js:258-378; lib/external/token-lifecycle.js:55-70; lib/dataverse/adapters/reviewer-suggestion.js:234-245; lib/external/verify-suggestion-token.js:134-170]`

The authoring client turns that server failure into apparent data loss. A failed draft load is ignored and the page renders an empty form; autosave and submit failures do not explain that the link was replaced; there is no local recovery buffer; and the page promises that work saves automatically. `[VERIFIED via shared/components/external/ReviewAuthoringForm.js:117-168,190-248,343-351,536-545]`

The correct policy is: **ordinary communications must preserve the active access grant and in-progress work. Only an explicit, disclosed revoke or security reissue may retire authority. A replacement must never destroy the prior working grant before the replacement is successfully delivered.** This policy is already written for the planned site-visit applicant link but is not applied to the live reviewer portal. `[VERIFIED via docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:640-666,1110-1122]`

## Scope and taxonomy

This audit distinguishes three token classes. Applying one lifecycle rule to all three would be a mistake.

| Class | Examples | Correct lifecycle |
|---|---|---|
| Long-lived human workflow grant | Reviewer portal link; grantee deliverables link; future site-visit applicant link | Stable across routine messages; explicit revoke/reissue; continuity of drafts and open sessions; auditable authority changes |
| Short-lived browser capability | Direct-upload token; export result/download token | Narrow audience/type/path/actor binding; short TTL; freely re-minted; one-shot or leased finalization where applicable |
| Proof/attestation receipt | Waiver-render proof; reviewer-candidate identity attestation | Bound to the exact fact being attested; independently verified; re-minting does not alter the underlying human access grant |

OAuth access/refresh tokens, NextAuth session/CSRF tokens, Dataverse service-principal tokens, webhook signatures, and provider API keys are authentication infrastructure rather than emailed external workflow grants. They are outside this product-lifecycle audit and must remain governed by their existing authentication and credentials contracts.

## Incident causal chain

1. The reviewer received a valid portal JWT. Only its SHA-256 hash, issued time, expiry, and revocation state were retained on the reviewer-suggestion row. `[VERIFIED via lib/services/external-token.js:79-106; lib/dataverse/adapters/reviewer-suggestion.js:234-245]`
2. A later reminder called the shared reminder sender, which minted a new JWT and overwrote the stored hash. `[VERIFIED via lib/services/reviewer-reminder-sweep.js:258-336; lib/external/token-lifecycle.js:55-70]`
3. The original JWT still had a valid signature and expiry, but verification compared it to the replacement hash and returned `hash_mismatch`. `[VERIFIED via lib/external/verify-suggestion-token.js:134-170]`
4. Draft GET/PUT and submit validate the token before loading or saving content, so the open page could no longer save or submit. `[VERIFIED via pages/api/external/review/[token]/draft.js:109-126; pages/api/external/review/[token]/submit.js:57-73]`
5. The client reduced this authorization transition to a silent empty-load or generic save/submit error. `[VERIFIED via shared/components/external/ReviewAuthoringForm.js:130-168,190-248]`

The production recovery investigation found no substantive server-side draft in the available point-in-time snapshots; this audit therefore does not claim that the system deleted this review's text. It does establish that the product can strand text in an open browser, falsely present a blank form after a failed load, and deliberately delete other in-progress server drafts during staff token recovery actions.

## Complete surface inventory

### A. Reviewer portal — long-lived human workflow grant

**Issuer and authority model**

- `mintToken` signs an HS256 JWT containing reviewer suggestion, request, operations, issue/expiry, and random JTI. Reviewer tokens have no audience claim. `[VERIFIED via lib/services/external-token.js:73-106]`
- `mintAndStore` always mints a new value and overwrites the one current hash. `ensureToken` is idempotent only while a usable token exists, but cannot reproduce its URL because the raw JWT is not retained. `[VERIFIED via lib/external/token-lifecycle.js:55-70,107-163]`
- Verification enforces signature/expiry plus row hash, stored expiry, revocation, and exclusion state. `[VERIFIED via lib/external/verify-suggestion-token.js:134-203]`
- A previous signing secret is accepted during key rotation. Operational secret rotation therefore preserves links while routine email delivery does not. `[VERIFIED via lib/services/external-token.js:291-324]`

**Mint/replace surfaces**

| Surface | Current behavior | Finding |
|---|---|---|
| Accept lifecycle (`ensureToken`) | Keeps an active token; mints if absent/expired/revoked | Reasonable idempotence, but cannot resend the same URL |
| Invitation, materials, follow-up, other templates containing `{{externalLink}}` | Replaces authority immediately before Dynamics dispatch | Routine communication invalidates all prior emails and open tabs |
| Manual reminder | Uses shared reminder sender and replaces authority | The action named “reminder” is actually an undisclosed reissue |
| Scheduled reminder | Same replacement behavior | Cron can invalidate links without a staff member seeing the side effect |
| Regenerate link | Replaces authority, then best-effort deletes the draft | Recovery can destroy the work it is intended to recover |
| Revoke link | Revokes authority, then best-effort deletes the draft | Confirmation warns about link access but not draft deletion |
| Acceptance confirmation | Stores the accepting raw token encrypted in an async job and later embeds it in the withdraw URL | An intervening email can make the just-sent confirmation link stale |

`[VERIFIED via lib/services/review-manager/send-emails-service.js:614-681; lib/services/reviewer-manual-reminder.js; lib/services/reviewer-reminder-sweep.js:258-378; lib/services/review-manager/regenerate-token-service.js:93-100; pages/api/review-manager/revoke-token.js:54-69; lib/services/reviewer-acceptance-job-service.js:27-59; lib/services/reviewer-acceptance-drain.js:408-435]`

**Consumer surfaces**

| Public surface | Token checks | Additional authorization | Finding |
|---|---|---|---|
| Portal context | Reviewer-token verification | Engagement state selects the view | Appropriate high-level routing |
| Accept/decline response | Reviewer-token verification | State/form validation | No explicit `respond` operation exists or is enforced |
| Proposal download | Verification + `download_proposal` operation + file membership | No accepted/materials-released state gate | Invite-stage default tokens already carry proposal-download authority; knowing a valid file id/library can bypass the intended “proposal later” stage |
| Draft GET/PUT | Verification + `upload_review` operation + authoring engagement state | Question-set and sanitization checks | Old/open links fail immediately after any routine reissue |
| Structured submit | Verification + `upload_review` operation + authoring state | Validation and persistence checks | Same continuity failure |
| Legacy upload | Verification + `upload_review` operation; upload service guards materials state | State guard exists | Better state enforcement than proposal download |

`[VERIFIED via lib/external/token-lifecycle.js:26-55; pages/api/external/review/[token]/respond.js:32-41; pages/api/external/review/[token]/proposal.js:45-88; pages/api/external/review/[token]/draft.js:109-144; pages/api/external/review/[token]/submit.js:57-91; pages/api/external/review/[token]/upload.js:48-70; lib/services/review-upload.js]`

**Browser behavior**

- The complete bearer JWT remains in the page URL and is repeated in same-origin API paths. Public external paths intentionally bypass NextAuth. `[VERIFIED via pages/external/review/[token].js:4-8,52-54; proxy.js:97-104]`
- The site sends `Referrer-Policy: strict-origin-when-cross-origin`, so cross-origin navigation does not expose the full path, but browser history and request-path observability still contain the credential. `[VERIFIED via next.config.js:18-23]`
- There is no URL-to-HttpOnly-session exchange, URL cleanup, or local unsent-work recovery.
- A top-level context failure explains `hash_mismatch`, but draft-load, autosave, and submit errors do not provide equivalent recovery behavior. `[VERIFIED via pages/external/review/[token].js:263-285; shared/components/external/ReviewAuthoringForm.js:130-248]`

### B. Grantee deliverables portal — long-lived human workflow grant

- Every invitation/reminder may mint a new audience-scoped 30-day JWT, but there is no stored hash and therefore old unexpired links continue working. `[VERIFIED via lib/external/grantee-token-lifecycle.js:2-16,26-69; lib/external/verify-grantee-token.js:43-82]`
- This avoids the reviewer's failed-delivery lockout: a failed new send does not invalidate the prior link.
- There is no per-link or per-grant revocation. Explicit package status controls whether editing/submission is allowed, while an unexpired token can still access the status-appropriate portal view. `[VERIFIED via pages/api/external/grantee/[token]/context.js:36-117; pages/api/external/grantee/[token]/submit.js:200-220; docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md:735-752]`
- `GRANTEE_OPS` claims (`edit_abstract`, `upload_image`) are minted but not enforced by the context, upload-token, upload-failure, or submit routes. The claims are decorative and create a misleading least-authority contract. `[VERIFIED via lib/external/grantee-token-lifecycle.js:26-29,51-66; pages/api/external/grantee/[token]/context.js; pages/api/external/grantee/[token]/upload-token.js; pages/api/external/grantee/[token]/upload-failure.js; pages/api/external/grantee/[token]/submit.js]`

The grantee continuity behavior is safer than the reviewer behavior, but the lack of explicit revocation and non-enforced operations must be resolved before this model is reused for more sensitive applicant-material workflows.

### C. Waiver-render proof — proof receipt

The waiver token is audience-scoped and binds request, policy version, and policy-body hash. The submit route can prove which exact waiver text was rendered. Re-minting it is appropriate because it is evidence, not the portal's access authority. `[VERIFIED via lib/services/external-token.js:156-244]`

### D. Browser-direct upload capabilities — short-lived capabilities

- Shared portal upload staging issues a 15-minute, path-scoped Blob token and a one-hour durable staging row. Finalization is bound to staging id, actor, scope, resource, persisted pathname, and a lease. `[VERIFIED via lib/services/portal-upload-staging.js:2-8,35-37,74-183]`
- Applicant intake upload-token requires the authenticated applicant/draft relationship and binds the staged upload to applicant identity and draft membership. `[VERIFIED via pages/api/intake/draft/upload-token.js:84-184,243-334]`

These are correctly modeled as ephemeral capabilities and should not be made stable or emailed.

### E. Staff export and identity receipts — short-lived internal receipts

- Dataverse export preview/run and private-download tokens are type-pinned, signed with the staff-session secret, expire in approximately one hour, and remain behind staff authentication. `[VERIFIED via lib/services/dataverse-export/result-token.js:23-94; pages/api/dataverse-export/run.js]`
- Reviewer candidate identity attestations are 14-day internal receipts binding the candidate identity projection and request; they are not external reviewer access links. `[VERIFIED via lib/services/reviewer-candidate-attestation.js:17,93-137,188-240]`

Their current re-mint semantics are appropriate.

## Findings

### F1 — Critical: routine reviewer email is an authority rotation

The application treats “send another message” as “invalidate every previous link.” That violates normal recipient expectations, breaks bookmarked links and open tabs, and makes email ordering a security state transition. The UI and email copy do not disclose it. `[VERIFIED via REVIEWER_ENGAGEMENT_SPEC.md:44,60,70,86-93 and the live mint paths above]`

### F2 — Critical: failed delivery can destroy the only working reviewer link

Both send pipelines replace the stored hash before transport success. Reminder code explicitly leaves the new token/claim in place after delivery failure. This is an availability failure caused by the security mechanism itself. `[VERIFIED via lib/services/review-manager/send-emails-service.js:674-681; lib/services/reviewer-reminder-sweep.js:326-378; tests/unit/reviewer-reminder-sweep.test.js]`

### F3 — High: the authoring client can present authorization failure as lost work

Draft-load failure is swallowed, an empty form is rendered, autosave has no automatic retry despite its text, submit gives a generic error, and there is no local export/recovery buffer. The claim “Your work saves automatically” is not defensible while these failure modes exist. `[VERIFIED via shared/components/external/ReviewAuthoringForm.js:130-168,190-248,343-351,536-545]`

### F4 — High: staff regenerate/revoke actions delete drafts without adequate disclosure

Both operations best-effort delete the server draft. Regenerate is precisely the recovery action staff are likely to use when a link fails. The management UI does not warn that in-progress work can be removed or offer preserve/quarantine/export choices. `[VERIFIED via lib/services/review-manager/regenerate-token-service.js:93-100; pages/api/review-manager/revoke-token.js:54-69; shared/components/reviewers/ReviewerManagePanel.js:1653-1695]`

### F5 — High: reviewer token capability and engagement state are not consistently aligned

Default invitation tokens carry both proposal-download and review-upload operations. Draft/submit/upload add authoring/materials state checks, but proposal download does not require acceptance or materials release. Respond has no dedicated operation. The operations claim is therefore over-broad at mint time and incomplete at consumption time. `[VERIFIED via lib/external/token-lifecycle.js:26-55; pages/api/external/review/[token]/proposal.js:45-88; pages/api/external/review/[token]/respond.js:32-41]`

### F6 — High: queued acceptance email can send an already-superseded withdrawal link

The token used to accept is encrypted into a durable job. The eventual worker embeds that historical token instead of resolving current authority. Any link-bearing communication between acceptance and job completion can invalidate the confirmation's withdrawal link. `[VERIFIED via lib/services/reviewer-acceptance-job-service.js:27-59; lib/services/reviewer-acceptance-drain.js:408-435]`

### F7 — Medium: grantee access has continuity but lacks revoke and honest operation claims

Multiple links overlap until expiry, which is safer for delivery continuity. However, there is no grant-level revoke/version and the operations claim is unused. Status gates writes, not the existence of access. `[VERIFIED via lib/external/grantee-token-lifecycle.js; lib/external/verify-grantee-token.js; docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md:735-752]`

### F8 — Medium: URL bearer exposure is wider than necessary

Long-lived credentials remain in browser history and request URLs throughout the session. Referrer policy prevents the most obvious cross-origin path leak, but a verified URL should be exchanged for a scoped, HttpOnly session and removed from the visible URL when practical. `[VERIFIED via pages/external/review/[token].js; pages/external/grantee/[token].js; next.config.js:18-23]`

### F9 — Governance: harmful reviewer behavior is documented and regression-tested as intended

The canonical reviewer specification, tests, wiki/memory, and onboarding material describe “latest-link-wins.” This is not an untested implementation accident. In contrast, the newer site-visit plan explicitly says resend the same active link and never destroy it during a failed replacement. Durable policy has diverged by feature. `[VERIFIED via docs/REVIEWER_ENGAGEMENT_SPEC.md:44,60,70,86-93; tests/unit/token-lifecycle.test.js; tests/unit/send-emails-service.test.js; tests/unit/reviewer-reminder-sweep.test.js; docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:640-666,1110-1122]`

## Required policy

### 1. Human workflow grants

1. **Continuity invariant:** invite resend, reminder, materials notification, due-date notice, follow-up, and thank-you must not invalidate an active unexpired grant or an already-open authorized session.
2. **Stable-link preference:** routine resend should use the same active URL. If implementation constraints temporarily require a new URL, old and new grants must overlap until expiry or explicit retirement.
3. **Explicit authority changes:** “Resend,” “Reissue,” and “Revoke” are separate actions. Reissue/revoke require reason, actor, timestamp, and visible impact disclosure.
4. **Safe replacement:** issue and validate replacement authority without retiring the prior grant; send it; retire prior authority only after accepted delivery and any configured grace period. A failed send leaves the old grant valid.
5. **Draft ownership:** a draft belongs to the reviewer engagement, not a particular token version. Reissue and ordinary revoke preserve it by default. Destruction must be a distinct, confirmed action with recoverable quarantine/versioning.
6. **Open-session protection:** a routine email cannot interrupt an authorized authoring session. Explicit compromise revocation may interrupt it, but the client must preserve unsent work for export/recovery and explain why saving stopped.
7. **Least authority:** audience, subject, operations, request, stage, and expiry must be enforced consistently. Do not mint decorative claims.
8. **Scanner safety:** opening a link must remain read-only; do not make the token one-time-on-first-GET because security scanners prefetch email links.

### 2. Short-lived capabilities and proof receipts

These may be freely re-minted, but must have an explicit audience/type, minimal scope, short TTL, actor/resource binding, and single-use/lease semantics where a mutation is finalized. They must never be used as a substitute for the stable human workflow grant.

### 3. Credential transport and observability

- Never log raw tokens or include them in analytics events.
- Hash tokens for rate-limit keys and audit correlation.
- Exchange the initial URL credential for a secure, HttpOnly, same-site, narrowly scoped session where feasible, then scrub the token from the browser URL.
- Preserve current cross-origin referrer protection and no-store/no-index controls.
- Maintain signing-key rotation overlap independently from grant reissue/revocation.

## Recommended target architecture

The current reviewer single-hash row cannot resend the same URL and cannot safely overlap old/new grants. Replace it with one of these reviewed designs:

1. **Preferred: stable engagement grant plus token ledger.** Give the engagement a stable public grant id and secret; persist only the secret hash for verification and store an encrypted resend value only if exact URL reproduction is required. Record grant versions/statuses in a ledger. Routine sends reuse the active grant. Explicit reissue adds a new active version; old authority is retired only after delivery success/grace. Drafts key to suggestion/engagement, never token version.
2. **Acceptable transitional design: multiple-active hash ledger.** Each message may carry a new JWT, but every active hash remains valid until expiry/revoke. This provides continuity without recoverable plaintext, though URLs will differ and revocation/version management is more complex.

A single overwritable hash must not remain the authority model.

## Prioritized action plan

### P0 — Contain immediately

1. Stop routine reviewer communications from rotating authority. Until the durable fix is deployed, send reminders without a portal link or block link-bearing reminder/resend actions with clear staff copy.
2. Remove draft deletion from regenerate/revoke. Preserve and quarantine existing drafts; add explicit destructive recovery only after separate approval.
3. Change the authoring client so a failed draft load does not render an editable blank form. On 401/hash mismatch, freeze remote writes, retain current text, explain the link transition, and offer copy/download recovery.
4. Remove the unconditional “saves automatically” promise until failed-save retry and recovery are real.
5. Add operational detection for reviewer `hash_mismatch`, failed reminder/send after token persistence, and repeated draft-save 401s without logging raw credentials.

### P1 — Repair reviewer authority

1. Implement the stable grant/token-ledger model and migrate current active reviewer grants without invalidating them.
2. Split staff actions into Resend, Reissue, Revoke, and Destroy draft, with explicit semantics and audit events.
3. Make replacement delivery two-phase: activate new alongside old; dispatch; retire old only after success/grace.
4. Resolve queued acceptance confirmation links at send time from current authority, or issue a dedicated withdrawal grant that routine reviewer email cannot supersede.
5. Add a reviewer audience claim and stage-specific operations. Invitation/respond authority must not imply proposal download/upload. Enforce stage on proposal download as well as upload/draft/submit.
6. Add browser recovery: durable debounced retry, visible last-saved time, local recovery snapshot with expiry, and export-to-file before navigation when remote persistence fails.

### P2 — Unify external-link governance

1. Apply the same human-grant policy to grantee and future site-visit applicant links.
2. Add explicit grantee grant-level revoke/version support; enforce `GRANTEE_OPS` or remove them and document status as the sole authorization model.
3. Exchange URL bearer grants for scoped HttpOnly sessions and clean the browser URL.
4. Separate signing keys/audiences by external surface so a key or verifier mistake cannot enable cross-surface replay.
5. Publish one canonical external-capability-token policy and reconcile reviewer spec, grantee spec, route matrix, Atlas, wiki, memory, runbooks, and UI language.

## Required regression and release evidence

Before promotion, the implementation must prove these complete stories:

1. Reviewer opens link, types unsaved text, staff sends reminder, open page continues saving and submits.
2. Reviewer opens the original email after one or more routine reminders; the link still works.
3. Replacement email delivery fails; the old link and open session remain valid.
4. Explicit reissue succeeds; grace/retirement behavior matches policy and is visible in audit history.
5. Explicit revoke blocks all relevant grants but preserves the draft and lets staff recover/export it.
6. Draft GET returns 401/network failure; the client never renders an apparently authoritative empty form.
7. Save/submit returns 401 or network failure; text remains recoverable and UI does not claim saved.
8. Acceptance job drains after intervening messages; withdrawal link is valid.
9. Invite-stage reviewer cannot download proposal materials even with a known file id; released reviewer can.
10. Grantee resend preserves older link; explicit revoke blocks it; operation and status checks are both tested according to the final policy.
11. Email security-scanner GETs cause no accept/decline/revoke/write transition.
12. Logs, analytics, error reports, and rate-limit storage contain hashes/redacted identifiers, never raw JWTs.

Existing unit tests that assert latest-link-wins or persistence-before-failed-send must be replaced, not merely supplemented, because they currently lock the defect in place.

## Durable-document reconciliation required with implementation

The following sources currently restate the unsafe reviewer behavior and must change in the same implementation series:

- `docs/REVIEWER_ENGAGEMENT_SPEC.md`
- `docs/REVIEWER_INTERACTION_DESIGN.md`
- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`
- `docs/agent-wiki/topics/external-reviewer-portal.md`
- `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
- `.claude-memory/feedback-behavior-claims-cite-the-producer.md`
- onboarding/deck copy that describes latest-link-wins
- token lifecycle, email authority, reminder, acceptance-email, and external route tests

The safer resend/reissue rule in `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` should become the system-wide source policy rather than a future-feature exception.

## Audit boundary and confidence

- `[VERIFIED via repository census]` `/external/*` and `/api/external/*` expose the live reviewer and grantee human portals; no other live public magic-link portal was found.
- `[VERIFIED via source]` all identified mint, persistence, send, verify, authoring, upload, proof, and internal receipt paths were traced to their consumers.
- `[VERIFIED via tests/docs]` reviewer latest-link-wins is intentional current behavior and grantee overlapping-link behavior is intentional current behavior.
- `[ASSUMED pending owner decision]` exact same-string URL reuse is preferred over merely overlapping valid URLs. Both satisfy continuity, but exact reuse matches the stated staff/reviewer expectation and simplifies support.
- This was a source-of-truth and durable-policy audit. It did not mutate production, inspect raw credentials, or attempt to enumerate infrastructure-managed OAuth/session tokens.
