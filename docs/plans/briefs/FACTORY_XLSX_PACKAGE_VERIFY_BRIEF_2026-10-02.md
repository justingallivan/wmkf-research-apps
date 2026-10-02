# Build brief: verify copied XLSX files by package comparison (2026-10-02)

Snapshot for the builder and reviewers. The built state is recorded in `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md`, not here.

## Problem

The Basic recipe copies a source Request's PDF and XLSX documents to the new test Request's SharePoint folder and verifies each copy. Verification mode is chosen from the MIME type alone: DOCX gets a package-part comparison, everything else an exact SHA-256 match (`integrityModeForMime`, `lib/services/test-requests/bundle-file-copy.js:43-45`).

SharePoint rewrites an uploaded XLSX. The first production run through the admin form (run `20407283-c279-5e0c-b396-210ad6842482`, test Request 1003308) stopped at `copy_file` on `Project Budget spreadsheet.xlsx`: uploaded, then "SHA-256 does not match the bundle" on the destination readback.

## Evidence (owner-run, read-only, 2026-10-02)

`scripts/probe-sharepoint-download-stability.mjs` against the source item and the uploaded copy:

- Three downloads of the source are byte-identical and hash to the bundle's `contentHash`. Three downloads of the copy are byte-identical to each other.
- Source and copy have 29 parts each. Exactly one differs: `docProps/custom.xml` (402 to 519 bytes uncompressed). Custom property names: source `ContentTypeId`; copy `ContentTypeId`, `TaxKeyword`. The package stayed 36,516 bytes. Copy eTag revision 1, cTag revision 3.
- `attestDocxPackageAgainstSource(copyBytes, sourceBytes)` **passes** on this pair, unchanged.

The source already carried SharePoint's `customXml/*` parts and `[trash]/0000.dat` (it lives in the same library), so this round trip exercised only the `docProps/custom.xml` rewrite.

## What to build

1. **Route XLSX to the package comparison at the destination.** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` gets the same destination treatment DOCX gets today, at every site that branches on the mode. The source-side check in `copyOne` (`bundle-file-copy.js:295-303`) stays an exact SHA-256 match against the bundle; the probe shows the source is byte-stable and that comment is correct.
2. **Make the Basic recipe's journal carry what package mode needs.** `flattenFileCopyEntry` (`run-runner.js:331-385`) writes `mimeType` and the freshly resolved `sourceDriveId` only for `kind === 'reviewerUpload'`; for Basic files `mimeType` is dropped and `sourceDriveId` is the bundle's snapshot. `inflateFileCopyEntry` (`:388`) then feeds `reverifyCopiedItems` and `verifyCopiedFiles`, which re-derive the mode from `entry.source.mimeType`. With the mode routed but the journal unchanged, the Basic `verify` step would treat a copied XLSX as exact-hash and fail. Trace every caller of `inflateFileCopyEntry` (`:1035`, `:2133`, `:3175`, `:3231`) and the Basic `verify` step, and make a package-mode Basic file verify end to end: `mimeType`, a source drive id that `reverifyCopiedItems` can download from, `attestedDigest`, `itemSize`. Check that the ledger's readback key allowlist accepts these keys on a `copy_file` row; if a key is not allowlisted, say so before adding one.
3. **Labels.** A spreadsheet must not fail with "DOCX package differs". Give the mode a format-neutral name and make the attestation's error text name the format or say "package". Before renaming the mode string, grep that it is never persisted (ledger, manifest, receipt). Keep `attestDocxPackageAgainstSource` exported under its current name for its other caller (`lib/services/post-presentation-materials/material-service.js:37`) unless a rename is trivial and complete.
4. **Rewrite the comment** at `bundle-file-copy.js:32-41`, which states the Basic recipe's XLSX files never resolve to package mode. That statement predates any live XLSX copy.
5. **Tests** (unit; no live systems):
   - Build a minimal XLSX-shaped zip in the test with JSZip. Do not commit bytes from a production file. A copy whose only difference is one added property in `docProps/custom.xml` verifies under package mode, through `copyBundleFiles`, `reverifyCopiedItems` and `verifyCopiedFiles`.
   - The same copy with a changed `xl/worksheets/sheet1.xml` fails.
   - A Basic-recipe runner test: an XLSX file reaches `verified` at `copy_file`, its ledger row carries the keys from item 2, and the `verify` step passes after a resume (entries rebuilt from ledger rows only).
   - PDF behaviour is unchanged (exact hash, same receipts).
   - Mutation check, reported in the hand-off: route XLSX back to exact-hash and the passing tests above must fail.

## Stated limits (do not widen)

- **Characterized for XLSX: the `docProps/custom.xml` rewrite only.** The attestation's tolerance for *added* customXml is Word-shaped (`DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels'`, `docx-package-attestation.js:42`). An XLSX that had never been promoted would get `xl/_rels/workbook.xml.rels` rewritten, which falls to the byte-identical branch (`:954-956`) and fails closed. That is the intended v1 behaviour. Do not generalize `DOCUMENT_RELS_PART` without a live case.
- **No resume path for a run stopped at `file_journal_unverified`** (`run-runner.js:945-949`). Run `20407283` stays parked; its bundle passes the 6-hour bound (`BUNDLE_MAX_AGE_MS`, `bundle-file-copy.js:87`) at 2026-10-03T00:20Z. Leave that refusal and its sibling at `:2698` as they are.
- The package budget and part ceilings written for DOCX now apply to XLSX unchanged: `DOCX_PACKAGE_BUDGET` (`docx-package-attestation.js:242`) allows at most 2,000 entries, 100 MiB per uncompressed part and 200 MiB total uncompressed; `NORMALIZED_PART_CEILINGS` (`:505`) caps `[Content_Types].xml`, `word/_rels/document.xml.rels`, `_rels/.rels` at 32 KiB and `docProps/core.xml`, `docProps/custom.xml` at 8 KiB each. `CUSTOMXML_LIMITS` (`:105`) bounds SharePoint-added customXml items.
- The custom-properties validator (`validateCustomProperties`, `:686`) accepts at most 64 properties, each holding exactly one scalar `vt:*` value from `VT_VALUE_TYPES` (`:520`) of at most 1,024 characters. A spreadsheet outside those bounds (a larger or non-scalar `docProps/custom.xml`, an oversized package) stops at `copy_file` and fails closed; nothing is relaxed for it.
- The first-lookup "changed while its bytes were being verified" refusal is not part of this work.
- No change to `validateCustomProperties` or any attestation rule. No new mechanism.

## Not verified

- A SharePoint rewrite that happens after the settle check passes. For package-mode files (DOCX and XLSX), `verifyCreatedItem` now reads metadata, downloads and attests, then reads metadata again, and journals only when size, eTag, cTag and versionId agree, trying at most 3 times about 2 seconds apart (the first live XLSX had eTag revision 1 but cTag revision 3). A later revision after that point would still fail the `verify` step on a good copy. The next production run is the test.
- XLSX sources outside the `akoya_request` library family.

## Rules for the build

- Work only in this worktree and branch (`claude/factory-xlsx-package-verify`). Never read `.env*` files. Never run `npm run check:factory-ledger`. No live systems.
- Do not touch files outside the Test Request Factory modules, their tests, and the docs named here.
- Run a gate and its self-test sequentially, never in parallel.
- Hand-off: files changed, each site that branches on the integrity mode and what you did there, test names, the mutation result, the exact commands run with their summary lines, and anything you could not verify.
