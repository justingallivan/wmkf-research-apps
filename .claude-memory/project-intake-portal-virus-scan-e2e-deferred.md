---
name: project-intake-portal-virus-scan-e2e-deferred
description: When intake portal goes live, run an EICAR-style e2e through /apply to verify the virus-scan rejection path. Reviewer path was verified in S193; intake path was deferred since the portal isn't user-ready yet.
metadata:
  type: project
---

S193 verified the virus-scan reject + system_alerts row + email path end-to-end through the **reviewer upload** flow (`/api/review-manager/upload-review` → `lib/services/review-upload.js` → Cloudmersive `/advanced`). The **intake portal upload** path (`/api/intake/draft/attach`) was NOT exercised because Entra External ID sign-up was rough (per [[project-intake-portal-ui-todo]]) and the test would have required navigating a fake-applicant flow that isn't user-ready.

**Why:** Both paths share `lib/services/cloudmersive-scan.js`'s `scanBytes()`. Unit tests cover the intake-attach consume path. Metadata propagation (detectedThreats / verifiedFileFormat) was patched into both paths in S193. So the verification gap is real but small.

**How to apply:** When intake portal work resumes (the next cycle's Phase I intake; the June 2026 Phase II Research pilot is superseded — see [[project-system-model]]), before going live to real applicants:
- Sign in via Entra External as a fake applicant (or use a test contact already in the External ID tenant).
- Create a draft, get to the file-upload step.
- Upload `/tmp/eicar-test-exe.docx` (Python recipe: zipfile.ZipFile docx-shaped with `/bin/ls` bytes as `word/embedded/payload.bin`) OR any docx with embedded executable bytes.
- Confirm: HTTP 422 with `infected` reason, blob deleted, `system_alerts` row with `alert_type='virus_detection_intake'`, email to `alerts@wmkeck.org`.
- Per [[project-cloudmersive-advanced-endpoint]], expect `ContainsExecutable` to fire and surface as `virusName='embedded executable'`.

If the test fails (no rejection, no alert), the most likely diagnostic step is checking `attach.js:430` — that's where the `scan_result === 'infected'` branch fires.

Related: [[project-cloudmersive-advanced-endpoint]] (the scanner change S193 made), [[project-virus-scanning-it-context]] (threat-model context).
