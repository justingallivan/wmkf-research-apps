# Ranking reduced-motion drop fix

October 14, 2026; follow-up to the private-save responsiveness rollout.

## Finding and change

[VERIFIED via local preference and source] This Mac has Reduce Motion enabled. `AssessmentWorkflow.js` previously set `transition: none` for every reduced-motion draggable state. The installed drag library waits for a transform `transitionend` before completing animated drops and invoking `onDragEnd`. Suppressing that transition can stall the rank update and confidence controls. A local WebKit reduced-motion pointer-drop probe timed out after 10 seconds before the fix.

The fix retains `transition: none` outside drop animation and uses a 1 ms duration during drop completion. Caller/consumer trace: pointer drop → library transform transition completion → `onDragEnd` → existing local assessment update → existing private save queue. No persistence, API, receipt, identity or queue contract changes.

## Verification and limitations

[VERIFIED via local fictional-data browser probes] `scripts/probe-ranking-reduced-motion-browser.js` uses the existing loopback rehearsal, 23 proposals / 4 identities, one active identity and a synthetic two-second save delay. It alternates four actual pointer drops and selects confidence while saving. It waits two animation frames before releasing the pointer so the sensor consumes the final movement. An earlier repeat that timed out was diagnosed as a no-op drop (library announcement: position 2 to position 2; All changes saved), and the target geometry and frame wait were corrected.

Final repeat samples, milliseconds from mouseup to rank DOM mutation:
- WebKit reduced motion: 23, 38, 52, 37. Confidence clicks: 31, 23, 20, 22.
- Chrome reduced motion: 36.2, 38.3, 39.3, 24.2. Confidence clicks: 36, 47, 41, 50.
- WebKit normal motion: 364, 369, 375, 373. Confidence clicks: 43, 26, 28, 24.

All selections succeeded during saving; no page errors. Another corrected WebKit run had rank timings 24, 38, 356, 36 ms, so these samples are not a latency guarantee. All 237 ranking tests, changed-file ESLint and production build passed.

Native Safari 27.0.1 was inspected read-only, but automated interaction was unavailable because remote automation is disabled. Automated WebKit is version 26.6; it is supporting evidence, not native Safari acceptance. No live PD records were changed.

## OAuth review

Claude Opus reviewed the component change, installed drag-library completion paths and regression probe through the existing Team OAuth session: **no blocking defects**. It confirmed transform completion, no-animation drops, unchanged normal-motion behavior and style reset. Nonblocking notes: potential development-only shorthand/longhand style warning; probe does not visually prove imperceptibility; local-server/browser prerequisites should be documented (now in script header). The reviewer did not execute browsers. No metered review product or provider API authentication was used.

## Scoped reconciliation

This is a bounded follow-up to the responsiveness implementation receipt. Earlier Chrome timing results used the position dialog and a programmatic radio click; they did not establish pointer-drag or Safari performance. The historical plan and reviews remain historical. Native Safari user acceptance remains open.

## Preview rollout

[VERIFIED via Vercel CLI] Runtime commit `56305b159` is Ready as Preview deployment `dpl_9eqKrmPDQDbY4mXHQFhFQdEKfRBN`. The shared `https://wmkf-meeting-transcription-test.vercel.app` alias points to `https://wmkf-meeting-transcription-test-89zquohkj.vercel.app`. Read-only smoke checks: `/proposal-ranking` 307, `/api/proposal-ranking` 401, `/auth/signin` 200. Production was not promoted. Immediate rollback candidate is the prior preview `dpl_34BbqkNXbayt1QjGHH3DMejjDRAm`.

Doc-currency and doc-symbol-reference gates and their self-tests pass; self-tests ran on the host to permit temporary worktree fixtures. The earlier responsiveness receipt's deployment paragraph is the historical queue rollout; this paragraph records its superseding preview deployment.
