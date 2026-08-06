# Plan v3: Preview-failure Retry + stale-render and send-time token authority

Date: 2026-08-06 (S404). Author: Codex. Status: v3 — authored by Codex to implement its own v1/v2 review verdicts; next step is Claude review, then owner authorization and a Sonnet build on `fix/invite-preview-error-retry`.

## Why v3 exists

v1 treated preview rendering as read-only. Codex found two HIGH defects:

1. [VERIFIED via `lib/services/review-manager/render-emails-service.js:144-175`, `lib/external/token-lifecycle.js:28-60`] A render containing `{{externalLink}}` mints a new JWT and overwrites `wmkf_externaltokenhash`; an older draft can therefore contain a dead link.
2. [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:324-333,549-590,702`] `EmailModal` remains mounted when closed, while `handlePreview` has no modal-session guard; a late response can repopulate a reopened modal with the prior selection.

v2 added the modal-session epoch guard and client render guards, which close finding 2, but deferred server authority to a later increment. Codex’s v2 verdict was **NO-SHIP**: generation/epoch guards suppress client writes but cannot order the durable token-hash writes performed by two requests or two clients. v3 therefore has one shipping increment. Retry UX, client stale-state guards, and server send-time token verification ship together or none ships.

## Shipping invariants

| Invariant | Enforcement | Verification |
|---|---|---|
| Retry is offered only for preview-render failures, never for send-path errors. | `previewFailed` gates the manage-panel banner; the invite modal retains the same gate. | UI pins 1–3. |
| At most one preview fetch per modal is executing at a time. | Per-modal serialized promise tail plus UI ref/state lock; the invite tail collapses queued superseding requests to the latest generation. | UI pins 5–6. |
| A response from an earlier manage-modal open/close session cannot mutate the current session. | Monotonic modal-session epoch checked before every post-`await` write or callback in `handlePreview` and `handleSend`. | UI pin 4. |
| A draft that was rendered from a template containing `{{externalLink}}` cannot dispatch without exactly one current, recipient-matching reviewer JWT in its body. | Render-stamped `externalLinkExpected`; body extraction; `verifySuggestionToken` immediately before dispatch. | Server pins S1–S7. |
| A stale or malformed link fails only its recipient; other recipients continue. | Existing `failed[]` + `email_failed` per-row stream contract. | Server pins S2, S4, S5. |
| A template that never contained `{{externalLink}}` and whose edited draft contains no reviewer link is not forced to have a token. | `externalLinkExpected === false` plus no extracted token bypasses token verification. | Server pin S3. |
| Owner-verbatim 503 copy is unchanged. | Do not edit `lib/utils/auth.js`; retain the exact test string. | UI pin 1 and existing test. |

## Single shipping increment

### 1. Stamp link expectation at render time

**File:** `lib/services/review-manager/render-emails-service.js`

- At the existing `needsExternalLink` derivation [VERIFIED at `:144-151`], keep the current definition: either the source template subject or body contains `{{externalLink}}`.
- Add `externalLinkExpected: needsExternalLink` to every draft returned by the `rows.map` at `:178-318`, including skipped rows for a uniform DTO. Sendable rows are the consumers; skipped rows remain excluded by both modals.
- Preserve best-effort minting at `:153-175`: a mint failure still returns the preview, but its draft now carries `externalLinkExpected: true` and an empty rendered link. The send service will fail that recipient closed instead of shipping a broken email.
- Update the service header contract at `:10-22` to name `externalLinkExpected` and the downstream send-time fail-closed behavior. Do not change token TTL, mint frequency, or placeholder substitution.

### 2. Carry the expectation through both clients

**File:** `shared/components/reviewers/ReviewerManagePanel.js`

- In `EmailModal` [VERIFIED start at `:281`], preserve `externalLinkExpected` when drafts are edited; `updateDraft` already spreads the draft at `:592-596`.
- Add `externalLinkExpected: d.externalLinkExpected` to the `drafts` projection posted by `handleSend` at `:638-650`.

**File:** `shared/components/reviewers/InviteEmailModal.js`

- `draftView` already spreads each server draft [VERIFIED at `:309-316`], so edits retain the marker.
- Add `externalLinkExpected: d.externalLinkExpected` to the invitation draft projection posted at `:559-586`.

Do not derive this marker from the edited body on the client. It records whether the server-rendered source template requested a token; the send service independently inspects the final edited body.

### 3. Verify the final edited JWT at the per-recipient dispatch boundary

**File:** `lib/services/review-manager/send-emails-service.js`

Insertion points are the import block at `:59-76`, helper region before `sendEmails` at `:78-84`, and the per-recipient loop immediately before the existing dispatch `try` at `:560-578`.

1. Import `verifySuggestionToken` from `../../external/verify-suggestion-token`.
2. Add a small local `extractExternalReviewJwts(text)` helper. It must:
   - scan the final draft **subject AND body** concatenated (Claude review amendment: the expectation stamp derives from the placeholder in the template subject OR body at `render-emails-service.js:150-151`, so a PD-edited template with the placeholder in its subject would otherwise stamp `true` while body-only extraction finds 0 JWTs — a permanent fail-closed dead-end that "regenerate the preview" cannot resolve);
   - capture tokens from `/external/review/<jwt>` with a three-base64url-segment pattern equivalent to `/\/external\/review\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g`;
   - ignore query strings such as `?action=accept` by capturing only the JWT path segment;
   - deduplicate repeated copies of the same JWT, because invitation HTML generation already tolerates a repeated identical link;
   - return the unique JWT array so zero, one, and multiple-distinct-token cases are explicit.
3. Immediately before `DynamicsService.createAndSendEmail` is invoked, apply this complement-complete decision table. There must be no intervening application `await` between a successful verification and invoking the dispatch helper.

| `externalLinkExpected` | Extracted unique JWTs | Behavior |
|---|---:|---|
| `false` | 0 | No token expected; do not call the verifier; continue to dispatch. |
| `false` | 1 | A reviewer JWT was manually introduced, so verify it; dispatch only if current and recipient-matching. |
| `true` | 0 | Fail this row with `external_link_missing`; no dispatch. This also closes render-time mint failures. |
| `true` or `false` | >1 | Fail this row with `external_link_ambiguous`; no dispatch, even if one token is current. |
| missing/non-boolean | any | Fail this row with `external_link_expectation_missing`; require a fresh preview rather than guessing. |
| `true` or `false` | 1 | Call `verifySuggestionToken(jwt)` and continue only on the checks below. |

4. Reuse the existing token lifecycle authority exactly:
   - `mintAndStore` creates the JWT/hash and persists the hash [VERIFIED at `lib/external/token-lifecycle.js:45-60`].
   - `verifySuggestionToken` calls `verifyToken`, re-reads the suggestion, and compares `suggestion.wmkf_externaltokenhash !== hashToken(jwt)` [VERIFIED at `lib/external/verify-suggestion-token.js:133-201`, especially `:162-169`].
   - `verifyToken` checks signature/expiry and supports the configured previous-secret rotation window [VERIFIED at `lib/services/external-token.js:279-324`].
   - `hashToken` is the SHA-256 helper used by that comparison [VERIFIED at `lib/services/external-token.js:326-338`].
5. A verifier success is necessary but not sufficient. Also require case-insensitive GUID equality (for example, compare `String(value).toLowerCase()` on both sides) for:
   - `verified.payload.suggestionId` versus `draft.suggestionId`; and
   - `verified.payload.requestId` versus `request.akoya_requestid`.
   A valid token belonging to another recipient or request fails closed as `external_link_recipient_mismatch`.
6. Map failures before any email activity is created. The verifier's ACTUAL failure vocabulary (Claude review amendment — enumerated from `lib/external/verify-suggestion-token.js:133-201` and `lib/services/external-token.js:279-324`; do not invent reasons) is: `hash_mismatch`, `revoked` (which deliberately also covers excluded applicant-disposition — an intentional non-leak that MUST stay collapsed), `token_expires_passed`, `not_found`, plus `verifyToken`'s signature/expiry failures. Mapping:
   - `reason === 'hash_mismatch'` → code `external_link_superseded`, error `This email’s secure reviewer link was replaced by a newer preview. Regenerate the preview and send this recipient again.`
   - Every other case — extraction missing (`external_link_missing`), ambiguous (`external_link_ambiguous`), marker missing (`external_link_expectation_missing`), recipient/request mismatch (`external_link_recipient_mismatch`), and verifier reasons `revoked` / `token_expires_passed` / `not_found` / signature-or-expiry failure or a verifier exception (all → `external_link_invalid`) → the actionable error `This email’s secure reviewer link is missing or no longer valid. Regenerate the preview and send this recipient again.` Verifier exceptions are per-row failures, not a terminal batch `error` event.
7. Push the row into the existing `failed[]` array and emit the existing `email_failed` event with this shape:

```js
{
  suggestionId,
  candidateName,
  candidateEmail,
  code: 'external_link_superseded', // or the specific code above
  error: 'This email’s secure reviewer link was replaced by a newer preview. Regenerate the preview and send this recipient again.',
}
```

Then emit normal `progress` for that recipient and `continue`. Do not use `skipped[]` (the row is actionable and retryable after a new preview) or invitation `unconfirmed[]` (dispatch was never attempted). The loop must still end with the existing `result` → `complete` sequence at `:780-804`, including when all rows fail. The current clients already render each `failed[].error` without a response-shape change [VERIFIED at `ReviewerManagePanel.js:1026-1037,1071-1079` and `InviteEmailModal.js:1107-1114`].

Update the service header’s event vocabulary at `:23-48` to document optional `email_failed.code` and the send-time token-authority gate. No change is required in `pages/api/review-manager/send-emails.js`: its shell forwards service events unchanged at `:78-94` and the trusted DAL context already encloses `verifySuggestionToken`’s Dataverse read.

### 4. ReviewerManagePanel Retry, single-flight, and session epoch

**File:** `shared/components/reviewers/ReviewerManagePanel.js`

At `EmailModal` state/ref declarations `:281-323` add:

- `previewFailed` state, initialized `false`;
- `rendering` state, initialized `false`;
- `renderingEpochRef`, used as the synchronous single-flight lock; and
- `renderTailRef`, initialized to a resolved promise and used to serialize fetch execution across close/reopen sessions; and
- `modalSessionRef`, a monotonic integer that is never reset.

In the existing `isOpen` effect at `:324-333`, increment `modalSessionRef.current` on **every** `isOpen` transition, open and close. On open, retain the current compose reset and also clear `previewFailed`/`rendering`. A stale request’s `finally` must not clear a newer session’s lock or state: key the lock to the captured epoch and clear it only when both the current modal epoch and lock epoch still equal the captured value.

Rewrite `handlePreview` at `:549-590` as follows:

- capture `const epoch = modalSessionRef.current` at entry;
- return immediately when `renderingEpochRef.current === epoch`;
- synchronously set the ref lock before `setRendering(true)` so two same-tick clicks cannot race;
- snapshot the request inputs, append the async fetch/parse run to `renderTailRef.current`, and return that scheduled promise; the queued run must skip before fetching if its epoch is already stale, while a current reopened session waits for the prior tail rather than starting a second fetch;
- set `previewFailed(false)`, clear the prior error/drafts, and keep the current request/copy;
- after each `await` (`fetch`, then tolerant `response.json`) and in `catch`, return unless `modalSessionRef.current === epoch` before any setter;
- on a current-session failure, set the existing owner-approved failure message and `previewFailed(true)`;
- in `finally`, clear the ref lock and `rendering` only for the still-current epoch/lock.

Rewrite `handleSend` at `:598-700` to capture the epoch immediately before its first async work. Guard **every** post-`await` effect:

- after the `send-emails` fetch;
- after every `reader.read()`;
- before each streamed `setProgress`, `setSentResults`, `setStep`, or `setError` at `:672-689`;
- before `onEmailsSent()` at `:686`; and
- before both catch-tail setters at `:696-699`.

If the epoch is stale, cancel the reader when available and return without touching state or calling `onEmailsSent`. Pre-`await` validation/confirm writes remain unchanged.

Replace the compose error banner at `:719-721` with the same flex layout/palette pattern as the invite banner and render **↻ Retry** only when `previewFailed`. Its `onClick` is `handlePreview` and it is `disabled={rendering}`. Preserve the owner-verbatim 503 server text and the shared “No emails have been sent” suffix.

Disable the footer Preview button at `:1103-1114` while `rendering`. Do not add Retry to preview/sending/sent banners, and do not set `previewFailed` anywhere in `handleSend`.

### 5. InviteEmailModal serialized single-flight

**File:** `shared/components/reviewers/InviteEmailModal.js`

The existing `renderGenRef` at `:257-307` prevents stale state application but currently permits overlapping fetches. Add `rendering` state beside `previewFailed` at `:161-165` and serialize render requests with a `renderTailRef` promise chain:

- each eligible `renderPreviews` call increments `renderGenRef` immediately and snapshots its `suggestionIds`, `template`, and settings;
- append its async run to `renderTailRef.current` instead of starting a fetch immediately;
- at queued-run start, skip without fetching if its generation is no longer latest; therefore multiple queued requests collapse to the latest request;
- an already-running older request may finish, but its existing generation checks suppress all post-await writes; only then may the latest queued fetch start;
- set `rendering(true)` when work is queued and set it false only when the settled promise is still the tail, the component is mounted, and no newer generation is queued.

This preserves the existing template-load supersede behavior without overlapping durable render calls. Keep the cleanup generation bump at `:301-307`. Add `disabled={rendering}` and disabled styling to the banner Retry at `:643-654`. No Retry is added to send-path error state.

### 6. Honesty reconciliation

**File:** `shared/components/reviewers/render-preview-failure.js`

Reword only the header comment at `:1-10`. The accurate claim is: a failed preview request has sent no email and may be retried; a successful render containing `{{externalLink}}` rotates durable token state, so render calls are serialized and send-time verification rejects superseded drafts. Leave both exported user-visible strings at `:13-19` byte-for-byte unchanged.

**File:** `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`

Rewrite the S404 invite-preview entry at `:286-313` structurally, rather than appending a correction. Preserve the owner-verbatim 503 paragraph; add the manage-panel Retry, `previewFailed` no-send-error gate, serialized/single-flight behavior, modal-session epoch, and per-recipient send-time JWT/hash check. In the Email templates/send-safety section, reconcile the existing invitation-only body-integrity wording with the all-template token-authority rule. Update `last_verified` and the relevant `source_files` list if needed.

**File:** `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`

At the current render/send caller bullets `:223-224`, retain render as the token-hash writer and add `send-emails-service.js` as a send-time reader/authority consumer of `wmkf_externaltokenhash`, revocation, and expiry. No schema, migration, API-route-security classification, or canonical count changes occur.

## Whole-flow contract

1. **Caller/UI:** both modals request render; manage Retry is preview-failure-only.
2. **Client state:** drafts retain `externalLinkExpected`; manage session epoch rejects closed/reopened writes; invite generation queue rejects superseded writes.
3. **Request:** both `send-emails` payloads carry `suggestionId`, edited `subject`/`body`, and `externalLinkExpected`.
4. **Route:** existing auth, rate limit, SSE framing, and `withDalContext('review-manager-send')` remain unchanged [VERIFIED at `pages/api/review-manager/send-emails.js:55-106`].
5. **Service:** final body extraction + `verifySuggestionToken` runs per recipient immediately before dispatch.
6. **Persistence:** `wmkf_externaltokenhash`/revocation/expiry on the suggestion row remain authoritative; no new durable field.
7. **Response:** stale-link rows use existing `email_failed` and `failed[]`; successful siblings use existing `email_sent` and `sent[]`.
8. **Consumer:** both modals already display `failed[].error`; manage epoch suppresses stale stream writes/callbacks.
9. **Docs/tests/gates:** service headers, preview comment, wiki, Atlas, UI tests, service tests, concurrency contract tests, scoped gates.

## Test matrix

### UI pins 1–6 (retain v2 numbering)

**New file:** `tests/unit/manage-panel-preview-error-retry.test.js`

**Extend:** `tests/unit/invite-preview-error-retry.test.js`

Reuse the `ReviewerManagePanel` fixture/fetch-driving pattern from `tests/unit/reviewer-manage-proposal-attachment.test.js`.

1. **Retry banner:** manage preview 503 shows the exact owner-verbatim server copy, “No emails have been sent — retrying is safe.”, and **↻ Retry**.
2. **Retry recovery:** Retry causes one new `render-emails` request; a healthy response clears the banner and advances to preview.
3. **No Retry on send errors:** after a successful preview, a terminal send stream error displays its error without a Retry button; `previewFailed` remains false.
4. **Deferred-response reopen:** start a deferred preview, close, reopen with a different selection, resolve the old response, and prove old drafts do not render and `handleSend` posts only the new session’s suggestion IDs. Keep this test even after the epoch guard ships; it is the regression pin for the second v1 HIGH.
5. **Single-flight:** a pending manage render disables Preview and Retry and cannot produce a second fetch; invite render requests are serialized, a superseding request waits, the old result does not apply, and at no point are two render fetch promises active.
6. **InviteEmailModal Retry disable:** its Retry is disabled while the serialized render tail is pending and re-enabled after the current/latest render settles.

Stash evidence status:

- [VERIFIED] The three existing tests in `tests/unit/invite-preview-error-retry.test.js` were stash-verified pre-fix in commit `b0948437`; they cover the invite variants of pins 1–2 plus non-JSON/network failure copy.
- [PLANNED] The manage-panel variants and pins 4–6 do not exist in the current tree. The implementer must keep the new tests while stashing production changes and record that pins 1–2, 4–6 fail for the intended reason. Pin 3 is a negative regression assertion and may pass before the Retry exists; its setup must first produce a real send-path error so it proves gating, not absence.

### Server contract pins

**Extend:** `tests/unit/render-emails-service.test.js`

**Extend:** `tests/unit/send-emails-service.test.js`

**Extend:** `tests/integration/send-emails-route.test.js`

**New file:** `tests/unit/reviewer-email-token-authority.test.js`

S1. **Render expectation metadata:** placeholder in body or subject yields `externalLinkExpected:true`; no placeholder yields `false`; mint failure still yields `true` plus no link.

S2. **Extraction and verifier contract:** one embedded three-segment JWT (including a URL with `?action=`) is passed verbatim to `verifySuggestionToken`; repeated identical URLs verify once; two distinct JWTs fail the row. Pin recipient/request claim mismatches too. (Claude review amendment) Also pin: a JWT located in the SUBJECT with none in the body is extracted and verified — the subject+body extraction domain must match the expectation-stamp domain.

S3. **No-link template:** `externalLinkExpected:false` plus no reviewer URL does not call `verifySuggestionToken` and dispatches normally. `false` plus a manually introduced reviewer URL does call it.

S4. **Per-row fail-closed streaming shape:** missing marker, expected-but-missing link, `hash_mismatch`, revoked/expired/invalid, and verifier exception each emit `email_failed { suggestionId, candidateName, candidateEmail, code, error }`, do not call `createAndSendEmail` for that row, continue to a healthy sibling, and appear in final `result.failed`. The route integration test pins the SSE wire shape and `result` → `complete` terminal order.

S5. **Overlapped superseding render:** use a controlled in-memory hash store. Render A produces drafts for at least two recipients; an overlapping Render B supersedes one recipient before A sends. Sending A must dispatch only recipients whose embedded JWT hash still equals the store and must fail the superseded row closed. The dispatch mock itself extracts every dispatched JWT and asserts `hashToken(jwt) === durableHashBySuggestion.get(id)`.

S6. **Two-client interleaving:** Client A renders token A; Client B renders token B for the same suggestion; A’s send fails `external_link_superseded` with zero dispatches; B’s send dispatches once, and the dispatch-time hash assertion passes.

S7. **Timed-out first request:** first render is withheld until its client times out; a retry render returns/stores token B; the late first render then lands token A and supersedes B. Sending B fails closed with zero dispatches. A fresh render C followed by send dispatches C and satisfies the dispatch-time hash assertion. This proves a timeout is not assumed to mean “no durable write.”

The concurrency test harness may mock Dataverse transport, but it must use the real `hashToken` and make the mocked `verifySuggestionToken` consult the same mutable durable-hash map used by the dispatch assertion. Existing `tests/unit/verify-suggestion-token.test.js` remains the separate pin that the real verifier performs signature, stored-hash, revocation, and expiry checks.

Stash-verify S1, S2, S4, S5, S6, and S7 against the pre-v3 service/client implementation and record the failures. S3 is a preserved no-token control; it is expected to remain green and prevents the new gate from overreaching.

## Gates and build order

Implement server metadata/authority first, then client transport/guards, then documentation. Run:

```bash
npx jest --runInBand --testPathPatterns "manage-panel-preview-error-retry|invite-preview-error-retry|render-emails-service|send-emails-service|send-emails-route|reviewer-email-token-authority"
npm run check:types
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:atlas
npm run check:atlas:self-test
npm run check:route-service-boundary
npm run check:route-service-boundary:self-test
npx jest --runInBand
```

Gate/self-test pairs run sequentially as shown. Inspect the entire diff before committing; this is one shipping increment and one review unit.

## Explicit non-goals and residual semantics

- No Retry on send-path errors; a blind resend can duplicate a real email.
- No change to the owner-verbatim 503 copy in `lib/utils/auth.js`: `I'm having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn't resolve, contact an administrator.`
- No re-mint or body rewrite at send time; PD edits around the URL remain byte-preserved.
- No token schema change, new table, migration, route, status, or background job.
- No client guard is cited as durable authority. The server verifier is the dispatch gate.
- A successful later preview may still intentionally supersede an already-sent link under the existing latest-link-wins token lifecycle. v3’s guarantee is narrower and testable: when this send attempts a recipient, a draft already superseded in durable state is not dispatched. Changing post-send supersession semantics requires a separate token-lifecycle design. (Claude review note) This residual explicitly INCLUDES the verify→dispatch TOCTOU window: a superseding render landing between a successful `verifySuggestionToken` and dispatch completion is the same latest-link-wins outcome, not a missed race — do not re-report it.
- (Claude review note — deploy transition) Drafts rendered before this ships lack `externalLinkExpected`; an in-flight session's send fails those rows `external_link_expectation_missing` until the PD re-renders. Fail-closed and actionable by design; the wiki entry gains one line saying so.

## Process record

- **v1:** Claude-authored; Codex adversarial review returned needs-attention with two HIGH findings: durable token-rotation race and stale-recipient repopulation after close/reopen. Both were author-confirmed against source.
- **v2:** Claude-authored revision added the session-epoch guard and client single-flight intent. Codex re-review verdict: **NO-SHIP**. The epoch closes stale-recipient repopulation, but client generation/epoch guards cannot order durable server writes; deferring send-time authority left the token-rotation HIGH open.
- **v3:** Codex-authored implementation plan applying its own verdict: one shipping increment, retaining the epoch/reopen test, moving send-time JWT/hash verification into the increment, and adding overlapped-render, two-client, and timed-out-request contract tests.
- **v3 + Claude review amendments (2026-08-06):** Claude verified all cited anchors against source and amended: (1) extraction domain widened to subject+body to match the expectation-stamp domain (fail-closed dead-end otherwise) + S2 pin; (2) failure mapping now enumerates the verifier's actual reason vocabulary (`hash_mismatch`/`revoked`-collapsed/`token_expires_passed`/`not_found`); (3) verify→dispatch TOCTOU named as part of the accepted latest-link-wins residual; (4) deploy-transition `external_link_expectation_missing` friction documented. Owner authorized build 2026-08-06; built by a Sonnet agent; Codex post-build review to follow.
