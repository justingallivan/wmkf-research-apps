---
name: project-cloudmersive-advanced-endpoint
description: Source-backed /advanced endpoint recommendation and dated S193 Cloudmersive behavior observations; live vendor results have not been re-probed
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-10-22 source review only; the S193 endpoint results, vendor behavior, and pricing have not been re-probed
---

## Recall Rule

Read this when: touching Cloudmersive virus-scan callers, tests, or design docs, or building any end-to-end scan test.

Do:
- Before any diagnostic scan that calls Cloudmersive, obtain explicit authorization naming Cloudmersive and acknowledging possible money or credit use. General memory/audit authorization does not grant this authorization.
- Keep the implemented `/virus/scan/file/advanced` endpoint unless a reviewed, evidence-backed change justifies another endpoint; S193 selected it after tests at that time.
- Read synthesized `foundViruses[0].virusName` when `CleanResult: false` with no `FoundViruses`; the `detectedThreats` / `verifiedFileFormat` envelope fields exist as of S193.
- For a future scan test, use a documented threat fixture and authorize the live vendor call explicitly; the DOCX-with-embedded-executable fixture used at S193 is the historical regression example.

Do not:
- Switch back to `/basic` solely on the prior design assumption; the S193 comparison favored `/advanced` for the tested embedded-content cases.
- Treat S193's EICAR-in-PDF/DOCX fixtures as proof that the current endpoint detects embedded threats.

Ground truth: `lib/services/cloudmersive-scan.js`; review-upload + intake/attach alert paths; [[project-virus-scanning-it-context]] (why Cloudmersive is primary defense).

`lib/services/cloudmersive-scan.js` was changed in S193 (2026-05-27) to POST to `https://api.cloudmersive.com/virus/scan/file/advanced`. The results below record tests performed then; they are not fresh verification of the vendor's current behavior.

**S193 endpoint comparison (2026-05-27; historical vendor results):** S190 designed against `/basic` on the assumption that magic-byte-restricted file types (PDF/DOCX/DOC/XLSX/TXT) made the basic signature scan sufficient. S193 EICAR upload through prod returned HTTP 200 (file accepted). Direct local scans against the production API key at that time reported:
- Bare EICAR bytes (`eicar.com` file) → `infected` ✓
- EICAR in a PDF `%` comment (uncompressed, raw contiguous bytes) → `clean` ✗
- EICAR inside DOCX `word/document.xml` → `clean` ✗
- EICAR inside a plain ZIP archive → `infected` ✓ (only on /advanced — /basic missed even this)
- Real executable bytes via `/advanced` → `infected` with `ContainsExecutable` ✓
- Non-conformant DOCX wrapper via `/advanced` → `infected` with `ContainsInvalidFile` ✓

Those S193 results favored `/advanced` for the tested embedded-content cases and motivated the current source choice. They are not a fresh or universal claim about the vendor's current endpoint behavior.

**How to apply:**
- Any future scanner work, callers, tests, or design docs reference `/advanced`. Don't revert to `/basic`.
- `scanBytes()` return envelope grew two fields in S193: `detectedThreats: string[]` (which `Contains*` flags fired) and `verifiedFileFormat: string|null` (Cloudmersive's own format ID). Existing `scan_result` + `foundViruses` callers are unchanged.
- When `CleanResult: false` with no `FoundViruses`, we synthesize `foundViruses[0] = { fileName, virusName: <Contains*-flag-label> }` so the review-upload + intake/attach alert message paths (which read `foundViruses[0].virusName`) keep working.
- `allow*` flag defaults: ALL false except `allowHtml: true`. HTML allowed because legitimate PDF/Office text frequently embeds HTML-like strings — the magic-byte gate already prevents `.html` file uploads at the file-type level.
- The S193 EICAR-in-document examples did not exercise the intended embedded-threat rejection. A DOCX embedding native executable bytes was the historical regression fixture and produced `ContainsExecutable`/`ContainsInvalidFile` then. For a future authorized diagnostic, record the actual response; neither the fixture nor these old results guarantee present vendor behavior.
- Memory pair: [[project-virus-scanning-it-context]] establishes Cloudmersive as primary defense (no MDO); this entry documents how that defense was correctly wired.
