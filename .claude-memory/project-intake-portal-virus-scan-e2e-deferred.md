---
name: project-intake-portal-virus-scan-e2e-deferred
description: When intake portal goes live, run an EICAR-style e2e through /apply to verify the virus-scan rejection path. Reviewer path was verified in S193; intake path was deferred since the portal isn't user-ready yet.
metadata:
  type: project
---

S193 verified the virus-scan reject + system_alerts row + email path end-to-end through the **reviewer upload** flow (`/api/review-manager/upload-review` → `lib/services/review-upload.js` → Cloudmersive `/advanced`). The **intake portal upload** path (`/api/intake/draft/attach`) was NOT exercised live because Entra External ID sign-up was rough (per [[project-intake-portal-ui-todo]]) and the test would have required navigating a fake-applicant flow that isn't user-ready.

**S203 verification (everything verifiable without the live flow is green):**
- Intake infected-branch CODE intact + matches this note: `attach.js:430` `scan_result==='infected'` → blob `delBlobSilent` → `virus_detection_intake` alert (line 486, routed via `category: 'virus-detection'`, S190-awaited so it's durable before the response) → `jsonError(res, 422, 'infected')` (line 526). S193's `detectedThreats`/`verifiedFileFormat` metadata present.
- Intake plumbing UNIT-TESTED: `tests/unit/intake-attach-endpoint.test.js:523` (infected → 422 + del + removePending + `draft.attach_infected` audit + `virus_detection_intake` notify) and `:565` (infected + del() throws → `attach_infected_del_failed`, Q3). Green.
- Scanner-half (does `/advanced` flag a wrapped executable) already PROVEN S193 — the scanner is shared between both paths.
- Fixture is now turnkey: `scripts/build-intake-eicar-fixture.py` writes `/tmp/eicar-test-exe.docx` (valid OOXML/ZIP container embedding a native exe under `word/embedded/payload.bin`; trips `ContainsExecutable`).

**Why:** Both paths share `lib/services/cloudmersive-scan.js`'s `scanBytes()`. So the ONLY residual is the live deployed-env integration: real Entra-authed applicant session + three-call upload dance + real Blob + real `/advanced` scan, all wired together. That's an integration-confidence check, not a logic check — but it must still be run before real applicants.

**How to apply (the irreducible manual gate):** When intake portal work resumes (the next cycle's Phase I intake; the June 2026 Phase II Research pilot is superseded — see [[project-system-model]]), before going live to real applicants, on a deployed env with `VIRUS_SCAN_ENABLED=true` + `CLOUDMERSIVE_API_KEY`:
- `python3 scripts/build-intake-eicar-fixture.py` to stage the fixture.
- Sign in via Entra External as a fake applicant (or a test contact already in the External ID tenant).
- Create a draft, get to the file-upload step, upload `/tmp/eicar-test-exe.docx`.
- Confirm: HTTP 422 with `infected` reason, blob deleted, `system_alerts` row `type='virus_detection_intake'`, email to the `virus-detection` category recipients (configure at /admin → Alert Recipients).
- Per [[project-cloudmersive-advanced-endpoint]], expect `ContainsExecutable` to fire and surface as `virusName='embedded executable'`.

If the test fails (no rejection, no alert), the most likely diagnostic step is checking `attach.js:430` — that's where the `scan_result === 'infected'` branch fires.

Related: [[project-cloudmersive-advanced-endpoint]] (the scanner change S193 made), [[project-virus-scanning-it-context]] (threat-model context).
