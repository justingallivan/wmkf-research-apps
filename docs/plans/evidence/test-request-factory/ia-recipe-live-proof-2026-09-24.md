# Initial Assessment recipe live proof (slice 6b) — 2026-09-24 PT, Session 542

Owner-authorized (re-confirmed 2026-09-24): one production read (bundle export of Request 1003222, run by the owner's shell because the agent classifier blocks production reads), one sandbox Request create, advance through `ready`. Factory branch `codex/test-request-preview-integration`; runtime head for the successful verify: `9f061fe92`.

## Result

Sandbox Request **1000342** (destination `20950da5-ec2f-4aa5-be7a-2e5fba3b53ad`, run `f8aae6aa-5921-4281-8a74-7bb8ccebe9a9`, idempotency key `s542-ia-proof-2`) reached **`ready`**: eleven bounded steps, every resource journaled before dispatch, verify_initial_assessment marked ready after the fix below. Receipts: `ia-recipe-live-proof-run-inspect-2026-09-24.json`; CLI output: `ia-recipe-live-proof-advance-log-2026-09-24.txt`.

## What only the live run could show

1. **GoVerify bypass timeout (run 1, `81800b62-3b95-459f-9652-d3bfde13c651`, key `s542-ia-proof-1`).** The deactivation PATCH committed server-side ~8 s in but had not responded by the 15 s bypass bound; the client aborted, the fail-closed rule refused to restore, and the run stopped at `create_request` with no Request created. The sandbox workflow was left inactive; it was re-activated by hand (read-only probe, then one PATCH with a 180 s timeout, activation measured at 9.0 s; definition active, exactly one active activation child, two inactive leftovers tolerated by the assertion). `BYPASS_REQUEST_TIMEOUT_MS` raised to 60 s (`53960b008`). Run 1 stays `needs_attention` in the throwaway ledger. Side note for the Basic path: the run's `needsAttentionReason` was reduced to `unknown_error` although the resource error was `goverify_deactivation_uncertain`.
2. **SharePoint property promotion (run 2, first verify attempt).** The raw `bytesSha256` anchor built earlier the same day for Codex round-2 F6 stopped verify: SharePoint rewrites every uploaded DOCX (adds `customXml/item1-3.xml`, `itemProps1-3.xml` and their rels; rewrites `docProps/core.xml`, `docProps/custom.xml`, `[Content_Types].xml`, `word/_rels/document.xml.rels`; leaves `[trash]/0000.dat`, `[trash]/0001.dat`) while every `word/` part stays byte-identical (governed hash equal; 9,478 bytes rendered, 16,897 downloaded). Replaced by `docx-package-attestation.js` (`9f061fe92`): part-by-part equality with the fresh render, normalizing only those characterized mutations and validating each as SharePoint's. The run was re-advanced from `needs_attention` and reached `ready`.
3. Confirmed live: `requestDocumentSelect()`'s optional columns against the sandbox schema, the census `+2`, `enterDynamicsBypassForScript` in `--advance`, the 900 s IA lease, real Graph behavior for upload, metadata reads and downloads.

## Residue

One sandbox Request (1000342) with its Initial Assessment and Board snapshot files; no production write; the GoVerify workflow restored (verified active with one active activation child). The bundle file and manifests live outside the repo and expire with the six-hour window.
