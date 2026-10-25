---
title: Claude review of distribution-defaults implementation
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth review of a5f3b6548 returned NEEDS CHANGES: GUID case mismatch, plus retention tests and smaller UX/error-handling findings. Revised implementation awaits re-review."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
---

# Independent implementation review — 2026-10-25

[VERIFIED via host Claude CLI, ordinary Claude.ai subscription/OAuth.]
Runtime target: `a5f3b6548432781d52c6cd535488333801cb0c21`.
The report is preserved verbatim below. The report's shortened plan path omits
`plans/`; the actual contract is linked above. Runtime stayed at the reviewed
fingerprint during review; root added further test cases and inventory comments
while it ran. No live operations, other checkout changes or metered review product.
Root verification is recorded separately from the reviewer's reported tests.

## Disposition for revised review

| Finding | Revised implementation / discriminating evidence |
| --- | --- |
| F1 — uppercase request GUID | Case-insensitive exact request/operation comparison for acceptance and proof. Tests use alphabetic uppercase GUID input with lowercase stored rows; foreign IDs still fail closed. |
| L1 — retention coverage | Parent callback tests cover dirty/recovery/mutation retention with composer hidden and source ineligible, then clean release. Panel tests cover teardown callback and exact-envelope reopen. |
| L2 — old preview after late acceptance | Clear the old-source preview, resolve recovery and show a sent receipt plus explicit current-brief preview instruction; no current-source history mutation. |
| L3 — pending preference warning | Navigation names pending/unconfirmed default changes, possible committed state and strict reload; uncertain results also retain the parent scope. |
| L4 — broad success fallback | Unexpected mutation exceptions return unconfirmed 503. Only the independent refresh may return confirmed-write success with a refresh warning. PUT and DELETE throw regressions added. |
| L5 — editor repair UX | Confirmed mutation with refresh failure includes Reload instruction. Reload discard is inline with Keep editing/Escape. Known validation/duplicate refusal is distinct from uncertainty; duplicates allow Clear. |

All dispositions require the revised independent review; this receipt does not
mark the implementation ready or authorize release.

## Verbatim first report

# Review of `a5f3b6548`: NEEDS CHANGES

I reviewed the runtime delta `0e3c6f7d7..a5f3b6548` (HEAD `a5f3b6548432781d52c6cd535488333801cb0c21`) against §3–§4D of `docs/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md`. There is one blocking finding; the rest of the contract holds. I edited nothing and ran no live operations. This review does not authorize a release.

## Blocking finding

**F1 (Medium): a successful send is permanently shown as unconfirmed when the URL's request ID is uppercase.**
- **Where:** `shared/components/workbench/PreSiteDistributionPanel.js:752` (`attempt?.requestId === id`) and `:774` (`item.requestId === id`).
- **Cause:**
  - `id` is the raw `router.query.requestId`, passed down unchanged (`pages/workbench/[requestId].js:285`).
  - The page itself compares request IDs case-insensitively (`:94`, `:105`, `:136`), so an uppercase-GUID URL is supported.
  - `isGuid` accepts uppercase (`lib/utils/guid.js:20`, `/i`).
  - The server's `request_id` is a Postgres `UUID` column (`034_pre_site_distribution_attempts.sql:8`), so every projected `attempt.requestId` comes back lowercase.
- **Reproduction:**
  1. Open `/workbench/<UPPERCASE-GUID>?tab=…`, prepare and confirm a preview, then Send.
  2. The server returns `{attempt:{requestId:'<lowercase>', transportAccepted:true,…}}`.
  3. `complete` is false, so `envelope.uncertain = true` and the latch is permanent. Staff see "outcome is unconfirmed" for an email that was actually sent.
  4. Retrying returns the reused sent attempt, which still mismatches. The no-transport proof at `:774` can never match either.
  5. The composer stays locked for the rest of the page session.
- **Risk:** this fails safe (no duplicate send), but it puts the main success path into a false permanent recovery state.
- **Reachability:** `[ASSUMED]`. I found no internal link producer that emits uppercase GUIDs. The page's explicit case handling shows that pasted or typed uppercase URLs are an expected input.
- **Required fix:** compare these IDs case-insensitively at both sites, using the existing `sameId`-style comparison or lowercasing both sides. Alternatively, normalize `requestId` once at the page boundary. Keep rejecting genuinely foreign IDs.
- **Missing test:** in `tests/unit/distribution-defaults-panel.test.js`, render with an uppercase `requestId` prop and return a lowercase `attempt.requestId` and history row. Assert both that acceptance releases the envelope and that the no-transport proof releases it. The current fixtures use the same lowercase `ID` everywhere, so they can't detect this.

## Non-blocking findings

- **L1 (Low, missing tests): the tab's retention branch is untested.**
  - Nothing tests `StaffDeliberationsTab.js:1820-1824`, i.e. the `distributionRetention` / `onRetentionChange` path.
  - Needed: (a) a dirty draft, then `showDistributionPanel` turns false → panel stays mounted; (b) recovery pending with the composer closed → stays mounted; (c) Resend with an envelope → shows the envelope, not a new compose; (d) teardown resets retention.
  - The tab tests mock `DistributionSenderPanel`, so none of this is exercised.
- **L2 (Low): a late acceptance after a source change still sets the old attempt as `preview`** (`:761-762`).
  - The history reload is correctly gated by `sourceKey`, and the parent's sent flag only comes from server history, so the "cannot set the current-source sent flag" invariant holds.
  - However, the sent card for the old source's attempt renders under the new source (`:1004`). It is labeled with its own Word version. The same `setPreview(body.attempt)` behavior existed before this commit.
  - The test at `:90` only checks that busy is cleared and the `onHistory` count is unchanged. It should also assert that the envelope is released and what is displayed.
- **L3 (Low): navigation prompt wording when only a preference save/clear is pending** (`:445`).
  - That state shows "Discard your unsaved email changes?" rather than wording about the pending default change. §4D asks for the pending-mutation wording to be covered in unit tests, and it isn't.
- **L4 (Low, latent): the PUT/DELETE fallback can report success for an unexpected mutation exception.**
  - At `email-preferences.js:27`, the PUT/DELETE fallback `{ok:true, refreshUnavailable:true}` would also catch an exception thrown by the mutation itself.
  - It isn't reachable today, because `saveDistributionPreference` and `clearDistributionPreference` catch everything internally.
  - Fix: scope the `try` to the refresh only, so a future refactor can't report a write as confirmed when it wasn't.
- **L5 (Low, UX):**
  - After a confirmed Save with `refreshUnavailable`, Save/Clear are disabled and no Reload hint is shown.
  - Reload uses `window.confirm` while the other discard paths use the inline prompt.
  - 409 duplicates and 400 validation are treated as uncertain (Reload required). That's conservative but not accurate.

## Contract checks that held

- **Owner and key guards:**
  - The owner comes only from `actorRefFromSession` (`dynamicsSystemuserId`), behind the `reviewers` app gate, inside `withDalContext`, with `no-store`.
  - Query and body shapes are validated exactly, and the parser is capped at 256 KB.
  - The key was added to both `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS`.
  - `listByOwnerAndKey` throws on capped enumeration, so a capped list is never treated as absence.
- **Validation:** subject and message must be nonblank. Limits are 500 / 20,000 characters, and CR/LF is rejected in the subject. Only a raw `{{requestNumber}}` is allowed, and only in the subject; any other brace is rejected. The rendered subject is re-checked client-side at compose time.
- **Read states and fallback:**
  - Absent, duplicates, encrypted, invalid, unavailable and missing identity are all distinct states.
  - Shared wording falls back to the built-in text per field.
  - The source label is honest, including "built-in fallback where needed".
- **Save/Clear:**
  - Save requires an exact readback; Clear verifies that no rows remain.
  - A lost response sets a latch that requires a reload, and Save/Clear are future-only (no prepare, lock or send). The tests check this with a `beforePrepare` spy and a URL audit.
- **Lifecycle:**
  - Each ordinary open (version-driven) reseeds the recipients regardless of their values.
  - Header Close, footer Close and Escape all go through one guarded handler, and Escape on the discard prompt means Keep editing.
  - The panel is now keyed by request + confirmed actor. Loading hides it without remounting, and an actor change or sign-out unmounts it.
- **Request lanes:** history, defaults, preferences, prepare, send and reissue each have their own lane.
- **Send recovery:**
  - Send uses no abort signal and gates by envelope and call, not source.
  - Completeness requires a properly shaped 2xx or a non-2xx with a string code.
  - The uncertainty latch is permanent, there is no error-code allowlist, and release requires a fresh `no-cache` history row with all of `false`, `null`, `null`.
- **The no-transport proof can actually succeed in production:**
  - `listDistributionAttempts` has no state filter (newest 25).
  - `recordDistributionFailure` doesn't touch `send_requested_at` or `dynamics_email_id`.
  - `send.js` persists send intent only after its final freshness checks.
- **Navigation guard:** `useDistributionUnsavedChanges` is the Board hook with only the wording changed. There is no competing `beforePopState` registrant on this page, and `selectTab` swallows only `cancelled`.

## Residual limits (accepted by the plan, not defects)

- A refusal after the Dynamics activity was created (activity ID set, no send intent) keeps the envelope until page reload, by design.
- After a reload, the cross-page duplicate-send gap is unchanged.

## Tests run

- I ran 9 focused Jest suites (the 5 new ones, both pre-site panel suites, staff-deliberations-tab and user-preferences-reserved-keys): **272/272 passed**.
- I did not run Playwright, the browser spec, a build, or any gates, and I make no claim of browser proof.
