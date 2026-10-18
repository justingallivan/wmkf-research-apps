# Bounded Board DOCX rehearsal — 2026-10-17 PT

Status: live transport rehearsal passed; not full workflow acceptance or deployment approval.
Runtime reviewed: `4e1923595`. Owner authorized one fictional document round trip,
with a strict boundary against infrastructure expansion.

## Evidence

- Application Graph identity resolved the registered Research Board Materials root
  and the akoyaGO `akoya_request` archive library before writes.
- Created exactly one uniquely named rehearsal folder in each location; parent
  identities and created IDs are in the adjacent JSON receipt.
- Generated one fictional DOCX with a title, paragraphs and two-row table; rendered
  and inspected it. No proposal or applicant data was used.
- Outgoing upload used the Board path's create-upload-session request with
  `conflictBehavior: fail`, then the shared `GraphService.putUploadSessionChunk`.
  Metadata-fenced readback through the shared downloader matched
  `hashGovernedDocxContent` of the original.
- Opened the copy in Word for the web as Justin and appended
  `EDIT VERIFIED 2026-10-17.` to the original-text paragraph. Word reported saved.
- Archive used `GraphService.createBrowserUploadSession` with explicit site/drive
  and `conflictBehavior: fail`, shared chunk transport/download and governed hash.
  Readback matched the edited source and differed from the original.
- Opened the archived copy in Word for the web and verified the exact edit marker
  and original table were present; then closed it.
- Duplicate-name attempts in both destinations returned HTTP 409 during session
  creation; readback confirmed the prior content remained unchanged.
- The outgoing folder listing contained only the fictional DOCX while Word for the
  web was open and after it closed; no `~$` item was observed. This is a bounded
  observation, not desktop-Word or D26 lock-file certification.

## Scope and retained artifacts

The probe is an operator-only transport exercise, not a bypass of the production
Board service guard. No production flags, roles, settings, schema, request records,
ledger rows, Dataverse references, cron schedules, or emails were changed. No files
were deleted. Both rehearsal folders and their one DOCX each are retained.

It does not exercise request-folder resolution, the authenticated staff dashboard,
CSO approval, durable release/archive receipts, registry writes, or notifications.
The full workflow still rejects test requests and nonproduction file writes.
Live staff acceptance and activation prerequisites in the Board-run Atlas remain open.

## Reproduction and safety

`scripts/probe-board-docx-roundtrip.mjs` is the bounded operator probe. It reads
only application Graph credentials from the original checkout, never agent keys.
Phases: `prepare` (read-only target resolution), `upload`, `inspect-open`, `archive`.
Run from this feature checkout. It uses `/tmp/wmkf-board-rehearsal/source.docx` and
an exact local receipt; repeated upload/archive phases refuse after their first
attempt. Do not clear its receipts to retry an uncertain write. A future run needs
new explicit authorization and a new isolated receipt directory/run name.
The source fixture was generated with bundled python-docx: a title, a TEST ONLY
paragraph, `Original text for the SharePoint round trip.`, and a Check/Value table
containing Fictional amount / $123. No model call was used.

Sanitized receipt: `research-board-docx-rehearsal-2026-10-17.json`.

Validation: 30 Graph boundary tests passed; document-currency, Atlas, and secret-scan gates and their sequential self-tests passed. Source syntax and diff whitespace checks passed.
