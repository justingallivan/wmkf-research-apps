---
name: project-sharepoint-property-promotion-rewrites-docx
description: "SharePoint property promotion rewrites every DOCX uploaded to the akoyaGO library (adds customXml items/props/rels, rewrites core.xml, custom.xml, [Content_Types].xml, document.xml.rels, leaves [trash] entries) while every word/ part stays byte-identical; raw package digests never survive an upload round-trip. Verified live 2026-09-24."
metadata:
  node_type: memory
  status: active
  type: project
  originSessionId: 0e6440df-6b18-41ae-9f22-49d30a1ed82f
  modified: 2026-09-25T03:51:59.723Z
---

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
`lib/services/test-requests/docx-package-attestation.js` (lands on `main` with PR #336), which normalizes only <!-- doc-symbol-refs:ignore reason=lands-with-pr-336 -->
these characterized mutations. Earlier memory notes that Word Online re-saves
re-serialize the package too; this is the upload-time counterpart.

**How to apply:** never assert byte identity across a SharePoint upload
round-trip; compare `word/` parts (governed hash) plus a characterized allowlist
for everything else. If SharePoint's promotion shape changes, the attestation
fails closed and the allowlist in that module is the place to extend, as a
reviewed commit. See [[project-test-request-factory]].
