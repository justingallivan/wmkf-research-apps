---
title: Email interface consistency — branch build and review
kind: audit
domain: platform
status: branch-built
summary: Desktop-first email consistency implementation, independent source review and local verification; no Production promotion or live writes.
related:
  - docs/plans/EMAIL_INTERFACE_CONSISTENCY_IMPLEMENTATION_PLAN_2026-10-24.md
  - docs/audits/EMAIL_INTERFACE_CONSISTENCY_AUDIT_2026-10-24.md
---

# Email consistency branch build

[VERIFIED via source and local tests, 2026-10-24.] Built on
`codex/email-interface-consistency-build`, based on plan commit `c93956a82`.
The original Impeccable audit remains a dated baseline, not a current defect list.

## Changes and contracts

- Native `EmailDialog` preserves desktop widths/scroll layout while providing a
  named modal, inert background, focus containment/return and busy cancellation.
  Nested recipient picker cancellation stops propagation. Grantee confirmation
  preserves confirm-only backdrop dismissal and explicit receipt Done.
- Current and reusable default wording are independent. Save/Clear changes future
  email only; raw default fields use consistent labels and controls. Materials
  reloads defaults on ordinary reopen, with session/edit guards on late reads.
- Legacy family Save/Clear re-reads strict own raw overrides and shared settings,
  patches only edited fields, preserves sibling families and inherited fields,
  and refuses unavailable/invalid/duplicate own reads. No new storage or route.
- Review displays server-derived From with To/Cc. Invitation sender is the enabled
  assigned PD; materials sender is the authenticated actor; agenda/scheduled use
  persisted sender columns. Grantee recipients GET exposes authenticated sender.
  Metadata supplies no client-side identity authority and changes no send proof.
- Legacy follow-up/thank-you remain retained and explicitly explained. Browser-
  local materials scratch settings have their own Save action and truthful failure.
  Helper contrast/type and shared buttons improved without a phone-driven redesign.

## Independent review

Native independent `email_plan_review` source review returned READY for final
verification after fixes for materials reopen loading, conflicting preview locks
and grantee dialog coverage. Final recheck found no outstanding source blockers.
This was an ordinary independent agent review; no metered review product or
provider API-key agent authentication was used.

## Verification

- Production build and type check passed. Changed-source lint has zero errors;
  hook warnings remain and are not represented as a clean warning-free lint run.
- Strict owner/key absence, raw value, duplicate/encrypted/capped/identity/read
  failure tests pass. Sender tests distinguish assigned PD from acting mailbox
  and reject a disabled PD as invitation sender metadata.
- Future-only Save/Clear, sibling/inheritance preservation, late actor response,
  required invitation link and existing send/uncertain-result tests are covered.
- Local real-component browser rehearsal confirmed desktop density/scrolling,
  forward/reverse Tab wrapping and named fields/address summaries. Nested picker
  receives search focus; Escape closes only that layer and restores its trigger.
  External calls and actual preference/send mutations were fenced out. Fixture
  failures are not live service outages.
- Full Jest run passed: 1,466 suites, 25,254 tests and all five snapshots;
  21 suites / 247 tests skipped under existing configuration. Final scoped
  invitation/materials checks, including two added reopen/loading regressions,
  passed 56 tests in three suites. Build and type checks passed.
- All 18 selected repository gates and their available self-tests passed.
  Gate/self-test receipts and source hashes are retained in
  `docs/audits/email-interface-consistency-build-2026-10-24/`.
  Gate/self-test pairs ran sequentially after the full suite; no fixture-writing
  self-test overlapped it.

## Limits

No deployment, live setting/preference write, business-record edit, real send or
calendar mutation occurred. Live end-to-end delivery was not repeated for this UI
build. No screen-reader certification or physical-phone testing is claimed.
The formerly outstanding zoom/narrow checks are now complete; see below.

Legacy updates retain existing read/modify/write concurrency behavior; the fresh
reads do not create an atomic compare-and-swap guarantee. Future calendar-event
integration and other personal-default slices remain separately queued.


## Release UI checks completed — 2026-10-25

[VERIFIED via Chrome native zoom readback, browser DOM measurements, screenshots
and keyboard actions against runtime commit `6da55d924`.] Chrome reported
**Zoom: 200%**; the 1200 × 736 desktop content area became 600 × 368 CSS pixels
(devicePixelRatio 4). This is actual browser zoom, not CSS scaling. A separate
390 × 844 CSS-pixel viewport override at normal zoom covered narrow-window
regression. Temporary zoom and viewport overrides were reset afterward.

Checked invitation/materials invitation/materials reminder, reviewer materials,
reminder, deadline, pending/accepted release, agenda, distribution, legacy
personal templates, grantee invitation/confirmation, Profile Settings, scheduled
messages and shared Admin defaults. Captured 20 zoom states and 18 narrow states,
including expanded defaults/Admin cards and lower-action views. All measured
document/open-dialog widths stayed within their viewport; no page-level horizontal
overflow or inaccessible main action was found. Keyboard focusing lower actions
scrolled them into view in the long dialogs. Narrow footer labels may wrap;
desktop dimensions and density were unchanged. No source fix was needed.

Evidence: `email-interface-consistency-build-2026-10-24/zoom-window-checks/`.
`chrome-zoom-proof.txt` records the native readback; `measurements.json`,
`narrow-measurements.json` and footer files record geometry and reachability.
Screenshots include actual narrow layouts using full-page capture (the ordinary
Chrome screenshot preview scales the emulated viewport into the physical window).
Synthetic fixture notices and intentionally blocked unavailable services are not
live-service findings. Historical walkthrough instructions in the release fixture
are not the current default-saving behavior; no Save/Send/Release was invoked.

The two outstanding UI release checks are closed. Existing full-suite/build/type
and independent-review receipts remain applicable: this follow-up changed evidence
and documentation only. Production promotion still requires the separate release
step; no deployment or real message/data write was made.
