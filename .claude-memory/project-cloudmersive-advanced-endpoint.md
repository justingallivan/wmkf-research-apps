---
name: project-cloudmersive-advanced-endpoint
description: Cloudmersive virus scan uses /advanced endpoint as of S193. /basic was a no-op for our use case (couldn't see container contents). Why and how.
metadata:
  type: project
  status: active
  scope: security
  last_verified: S193 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: touching Cloudmersive virus-scan callers, tests, or design docs, or building any end-to-end scan test.

Do:
- Use the `/virus/scan/file/advanced` endpoint; it's required to see container/embedded contents.
- Read synthesized `foundViruses[0].virusName` when `CleanResult: false` with no `FoundViruses`; the `detectedThreats` / `verifiedFileFormat` envelope fields exist as of S193.
- To verify realistic threats, build a DOCX with embedded executable bytes (trips `ContainsExecutable`/`ContainsInvalidFile`).

Do not:
- Revert to `/basic` — it's a no-op for embedded threats (the S193 burn).
- Use EICAR as a meaningful end-to-end test — it passes clean when embedded in a PDF/DOCX.

Ground truth: `lib/services/cloudmersive-scan.js`; review-upload + intake/attach alert paths; [[project-virus-scanning-it-context]] (why Cloudmersive is primary defense).

`lib/services/cloudmersive-scan.js` POSTs to `https://api.cloudmersive.com/virus/scan/file/advanced`, NOT the basic `/virus/scan/file` endpoint. Switched in S193 (2026-05-27) after live testing proved the basic endpoint was functionally a no-op for our threat model.

**Why:** S190 designed against `/basic` on the assumption that magic-byte-restricted file types (PDF/DOCX/DOC/XLSX/TXT) made the basic signature scan sufficient. S193 EICAR upload through prod returned HTTP 200 (file accepted). Direct local scans against the production API key confirmed:
- Bare EICAR bytes (`eicar.com` file) → `infected` ✓
- EICAR in a PDF `%` comment (uncompressed, raw contiguous bytes) → `clean` ✗
- EICAR inside DOCX `word/document.xml` → `clean` ✗
- EICAR inside a plain ZIP archive → `infected` ✓ (only on /advanced — /basic missed even this)
- Real executable bytes via `/advanced` → `infected` with `ContainsExecutable` ✓
- Non-conformant DOCX wrapper via `/advanced` → `infected` with `ContainsInvalidFile` ✓

The basic endpoint's signature matcher needs the threat to BE the file, not be embedded in a document. Since our threat model is exactly "macros/executables/OLE objects embedded in reviewer-uploaded Office/PDF files," basic was the wrong tool.

**How to apply:**
- Any future scanner work, callers, tests, or design docs reference `/advanced`. Don't revert to `/basic`.
- `scanBytes()` return envelope grew two fields in S193: `detectedThreats: string[]` (which `Contains*` flags fired) and `verifiedFileFormat: string|null` (Cloudmersive's own format ID). Existing `scan_result` + `foundViruses` callers are unchanged.
- When `CleanResult: false` with no `FoundViruses`, we synthesize `foundViruses[0] = { fileName, virusName: <Contains*-flag-label> }` so the review-upload + intake/attach alert message paths (which read `foundViruses[0].virusName`) keep working.
- `allow*` flag defaults: ALL false except `allowHtml: true`. HTML allowed because legitimate PDF/Office text frequently embeds HTML-like strings — the magic-byte gate already prevents `.html` file uploads at the file-type level.
- EICAR is NOT a useful end-to-end test for our pipeline anymore. To verify the scan layer is rejecting realistic threats, build a docx with embedded executable bytes (`python3 -c 'import zipfile; ...'` wrapping `/bin/ls`) — that trips `ContainsExecutable`/`ContainsInvalidFile`.
- Memory pair: [[project-virus-scanning-it-context]] establishes Cloudmersive as primary defense (no MDO); this entry documents how that defense was correctly wired.
