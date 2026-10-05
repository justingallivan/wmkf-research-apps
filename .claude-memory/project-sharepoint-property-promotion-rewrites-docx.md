---
name: project-sharepoint-property-promotion-rewrites-docx
description: "SharePoint property promotion rewrites every DOCX uploaded to the akoyaGO library (adds customXml items/props/rels, rewrites core.xml, custom.xml, [Content_Types].xml, document.xml.rels, leaves [trash] entries) while every word/ part stays byte-identical; a template carrying another library's customXml has those items rewritten in place; raw package digests never survive an upload round-trip. Verified live 2026-09-24 and 2026-09-27."
metadata:
  node_type: memory
  status: active
  type: project
  originSessionId: 0e6440df-6b18-41ae-9f22-49d30a1ed82f
  modified: 2026-09-27T17:40:00.000Z
---

## Recall Rule
Read before asserting or journaling byte identity for a DOCX, XLSX, or other Office file across a SharePoint upload, copy, or download.

Do: compare the governed `word/` parts (`hashGovernedDocxContent`) plus the characterized allowlist in the attestation module; settle-check `size`/`eTag`/`cTag`/`versionId` before journaling a copy.
Do not: compare whole-package SHA-256 or file size across a round-trip; widen the allowlist outside a reviewed commit.
Ground truth: `lib/services/test-requests/docx-package-attestation.js`, `scripts/probe-sharepoint-download-stability.mjs`. Plain text (`.txt`) uploads are not covered here.

**Fact (verified 2026-09-24, Session 542, live sandbox Request 1000342):** a DOCX
uploaded through Graph to the akoyaGO `akoya_request` library and downloaded back
is not byte-identical. SharePoint property promotion adds `customXml/item1-3.xml`
(content-type schema, form templates, document-management properties),
`customXml/itemProps1-3.xml` and their rels, rewrites `docProps/core.xml`,
`docProps/custom.xml` (ContentTypeId), `[Content_Types].xml` and
`word/_rels/document.xml.rels`, and leaves `[trash]/*.dat` entries. Every `word/`
part is byte-identical, so `hashGovernedDocxContent` matches (9,478 bytes
rendered, 16,897 downloaded, same governed hash). `docProps/app.xml` was untouched.

**Why:** a raw whole-package SHA-256 journaled at upload can never equal a
download; the Test Request Factory's first byte-digest verify anchor failed on
exactly this and was replaced by
`lib/services/test-requests/docx-package-attestation.js` (on `main` since PR #336), which normalizes only
these characterized mutations. Earlier memory notes that Word Online re-saves
re-serialize the package too; this is the upload-time counterpart.

**Extension (verified 2026-09-27, Session 544, sandbox Request 1000348):** a
package that already carries SharePoint customXml from ANOTHER library (the
Pre-Site v6 template) has its `item1` contentTypeSchema, `item3` properties and
`itemProps1` rewritten in place to the destination library's content type; the
other customXml and rels parts stay byte-identical, and five `[trash]` entries
appeared. The attestation accepts this for renders only
(`validateSharePointRewrite`); an uploader-supplied source keeps byte identity.

**Extension to XLSX (verified 2026-10-02, production run `20407283`, test Request
1003308, and the owner-run `scripts/probe-sharepoint-download-stability.mjs`):**
an XLSX copied within the `akoya_request` library is rewritten too. On the
probed pair only `docProps/custom.xml` differed (402 to 519 bytes; a `TaxKeyword`
property added beside `ContentTypeId`); the other 28 parts were byte-identical and
the package size did not change, so a same-size readback is not evidence of
identical bytes. The copy's eTag stayed at revision 1 while its cTag reached
revision 3: content was revised after upload without an eTag change. Repeated
downloads of the source, and of the copy, were each byte-stable. The existing
source-baseline attestation accepts this pair unchanged; XLSX is routed to it
since PR #406 (`06797abd0`), with a settle check on `size`/`eTag`/`cTag`/`versionId`
before the copy is journaled. Not characterized: an XLSX that had never been
promoted (its `xl/_rels/workbook.xml.rels` would change; the attestation fails
closed), and PPTX.

**How to apply:** never assert byte identity across a SharePoint upload
round-trip; compare `word/` parts (governed hash) plus a characterized allowlist
for everything else. If SharePoint's promotion shape changes, the attestation
fails closed and the allowlist in that module is the place to extend, as a
reviewed commit. See [[project-test-request-factory]].
