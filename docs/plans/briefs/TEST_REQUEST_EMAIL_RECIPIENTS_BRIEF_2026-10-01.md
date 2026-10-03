# Brief: test-Request email checks must pass recipients to the allowlist

Date: 2026-10-01 (Session 561). Author: Claude (main checkout). Builder: Codex.

## Where

You are in `/Users/gallivan/Code/WMKF_Apps-codex-email` on branch
`codex/test-request-email-recipients` (from `origin/main`). Run `/start`.
**Stay on this branch and directory.** Other agents are working in the main checkout
and in `../WMKF_Apps-codex` (transcription). Do not check out other branches or
touch those directories. Commit to this branch and `git push -u origin
codex/test-request-email-recipients`. **Do not push to `main`** (it auto-deploys).
This is Tier 1 runtime work: it lands by PR on the owner's go.

## The bug (owner-reported)

On marked TEST Request 1003302 the owner tried to send the site-visit materials
request. It was refused with "Not sent. Email is disabled for test requests." The
owner's allowlist (Administration → Test-request email allowlist, five addresses)
was never consulted.

## Cause [VERIFIED via source, 2026-10-01]

- `assertRequestEmailAllowed(requestId, { recipients })`
  (`lib/services/test-requests/request-test-state.js:71`) applies the owner's S546
  rule only when `recipients` is an array: a marked test Request is allowed when
  every recipient is `@wmkeck.org` or on the allowlist (`testRequestRecipientsAllowed`,
  `lib/services/test-requests/email-allowlist.js:81`, plus-tags allowed). With
  no `recipients` it throws the flat "Email is disabled for test requests."
- Every caller passes no `recipients`. The bare calls date from Stage 1b
  (`e8f0ded92`, 2026-09-23); the allowlist was wired into the delivery seam only
  (`lib/services/dynamics/email.js:104`):
  - `lib/services/site-visit-materials/collection-service.js:496`
    `createMaterialsCollection`
  - `:620` `inviteMaterialsContributors`
  - `:669` `remindMaterialsContributors`
  - `lib/services/workbench/grantee-deliverables/send-invite-service.js:85`
    `sendGranteeInvite`
- Confirm with `grep -rn "assertRequestEmailAllowed(" lib pages`. If you find another
  caller, handle it the same way and say so.

## The fix (keep it this small)

1. **Materials, all three functions.** Move the `assertRequestEmailAllowed` call to
   just after `const recipients = contactList(contacts);`. Pass
   `{ recipients: recipients.map((person) => person.email) }`. It must still run
   before any side effect: `dependencies.mint`, `insertCollection`, the reminder
   claim, or `sendInvitation`. Check each function's order. Everything before that
   point in `createMaterialsCollection` is a read: `loadContext`, `findActiveSiteVisit`,
   `getOpenCollection`, `currentContacts`. Confirm the same for invite and remind.
   Recipients come from the Request's PI/Liaison, and a `preparedEmail` whose list
   differs is refused as stale. So the list checked is the list sent. Verify this.
   If `sendInvitation` or the reminder path adds any other recipient (Cc/Bcc),
   include it in the list passed, or report it.
2. **Grantee invite.** Keep the call where it is, before `ensureDeliverableForRequest`
   (a write) and the magic-link mint. Pass the actual envelope:
   `[toEmail, ...(Array.isArray(ccEmail) ? ccEmail : ccEmail ? [ccEmail] : [])]`.
   Match whatever normalization `createAndSendEmail` applies to `cc`.
3. **Leave alone:**
   - ordinary Requests (unchanged);
   - `unknown` state (still fails closed);
   - the delivery-seam recheck in `lib/services/dynamics/email.js` (still re-reads
     the full To/CC/BCC);
   - the allowlist itself and its admin page;
   - `assertRequestEmailAllowed`'s own logic. Only the callers change.
   - No new abstraction or helper unless two callers would otherwise duplicate
     non-trivial code.

## Tests

Update and extend:
- `tests/unit/test-request-materials-email-guard.test.js`: it asserts
  `toHaveBeenCalledWith(REQUEST_ID)` and must now expect the recipients.
- `tests/unit/test-request-email-sender-census.test.js`
- `tests/unit/site-visit-materials-collection-service.test.js`
- `tests/unit/grantee-send-invite-workbench-service.test.js`

Cases each path needs:
- A marked test Request whose recipients are all allowed proceeds: mint, insert and
  send are called.
- A marked test Request with one non-allowed recipient is refused with
  `test_request_email_denied` **before** mint, insert, claim or deliverable write.
  Assert those mocks were not called.
- An ordinary Request is unchanged.
- `unknown` still refuses.

Mutation check: revert the `recipients` argument on one caller and confirm the
allowed-recipient test fails. Record which test killed it.

Run: `npx jest --testPathPatterns "test-request-email|test-request-materials|site-visit-materials|grantee-send-invite"`,
then the full relevant gates: `npm run check:api-routes`, `npm run check:types`,
`npm run check:status-enum-parity`. Run each gate and its `:self-test`
sequentially. Report pass counts and any red output verbatim.

## Docs

If any doc says the early check consults the allowlist, or that test-Request email is
"disabled" without the allowlist exception, correct it. Search with
`grep -rn "disabled for test requests\|assertRequestEmailAllowed" docs .claude-memory`.
Include `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md`
(the "Test-Request email recipient allowlist" MVP item 4).

## Not in scope

- The admin form (`docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md`).
- Any change to Request 1003302's contacts. That Request is not bound to the test
  cast (owner decision S548 #4). After the fix it will still be refused if its PI or
  Liaison is not allowed. That is correct behavior: say so in the PR, and note that
  1003303 (cast-bound) is the Request to test on.
- No Production reads or writes. The owner tests in the browser after merge.

## Hand-back

Commits pushed on the branch, a draft PR against `main`, and a short report:
- files changed;
- test and gate results;
- the mutation check;
- any caller or recipient you found beyond the four above.
