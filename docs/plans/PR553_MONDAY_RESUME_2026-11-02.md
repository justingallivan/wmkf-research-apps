---
title: Parked Prompt Publication Work — Monday with Connor
kind: handoff
domain: ai-platform
status: parked
summary: Resume Monday November 2 with Connor's Windows09 offline checks; local implementation and Fable review complete, no live registration or enablement authorized.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
---

# Parked until Monday, November 2, 2026

Owner: Justin with Connor. Codex owns the later evidence validation and guided
rehearsal. Local expansion is paused until Windows results arrive or Justin gives
new direction. This is a task archive, not authorization for registration,
activation, deployment, further implementation or production changes.

## Resume in one message

> Resume the parked shared prompt publication task for Monday with Connor. Read
> docs/plans/PR553_MONDAY_RESUME_2026-11-02.md first. Start with Windows09 offline
> checks only. If we have the result JSON and full console output, validate them
> against the recorded hashes before proposing any live step. Keep registration
> and enablement gated; preserve all existing data and original request IDs.

## Verified implementation boundary

[VERIFIED via local Git and the feature milestone record, 2026-10-30 Pacific]
- Branch: `codex/shared-prompt-library-plan`.
- Recorded local head: `9d838c4c8` (Windows09 handoff and pause).
- Implementation commit: `bac77ba984318badbacb0c560d7ce0c7d129cbfe`.
- Existing worktree: `/private/tmp/wmkf-pr553`. Confirm it still exists and verify
  branch/status before using it; a historical checkout path is not authority.
- Local registration, recovery, guard activation and enabled-package tooling are
  implemented. Fable reviewed and confirmed corrections. The recorded checks are
  18 suites / 697 tests, 25 packaging checks and 1,484 portable checks.
- No actual enabled package was built. No live registration, guard activation,
  enablement or prompt publication occurred. No feature merge, push or deployment
  was performed. Existing schema and settings preparations remain test-only.
- The branch is ahead of its remote by 15 commits at this snapshot; do not mistake
  the older remote PR head for the completed local work. Do not push/promote the
  feature merely to carry this handoff: Preview/production deployment remains
  outside the authorized task. Account for this explicitly at actual session stop.

The feature's detailed source-bound milestone is retrievable from local Git:

```bash
git show 9d838c4c8:docs/plans/PR553_ACTIVATION_AND_ENABLED_PACKAGE_2026-10-30.md
git show 9d838c4c8:docs/plans/PR553_OPERATOR_CHECKLIST_2026-10-30.md
```

## Sendable archive and integrity

[VERIFIED via ZIP entry checks and SHA256]
- Sendable archive: `output/connor-windows09-offline-checks/Connor-Windows09-Offline-Checks.zip`.
- It contains exactly `CLAUDE-PROMPT.txt` and the original `windows-handoff-09.zip`.
- Loose prompt: `output/connor-windows09-offline-checks/CLAUDE-PROMPT.txt`.
- Original Windows09 ZIP remains byte-identical inside the sendable archive.
- The binary and loose prompt are local/untracked. Preserve this output folder;
  they do not travel through Git automatically. Transfer the sendable archive
  explicitly if changing machines. The full prompt is preserved in this tracked
  document below; the embedded ZIP can be recovered from the sendable archive
  if the temporary feature worktree disappears. Verify its hash before use.

Sendable archive SHA256: `f2681aa560ae1eeb8f45fdfae3527911c6fed13cbc02dccd7af8753efcfdb897`.

Windows09 ZIP SHA256: `5d0defb6657f4828079e9db6439c2442960c3d05c662cf06f131a2755b8ea804`.

Package SHA256: `122399107922a0f993a83a57b04e188f7c563d44a0fb1db8cebc72475f249982`.

Source packet SHA256: `fa7e970b6744cce51ec8e5f7776ecf0729fc893dbd366d97c3c4d8eb6c3375cd`.

## Monday's stop point

Connor runs the offline prompt below on Windows, preserving
`windows-check-result.json` and complete console output. The transcript must be
outside the extracted bundle because the checker rejects unexpected files.
Only bundle09 is current; earlier bundles are superseded.

Return those files here for validation. A passing offline result does not itself
authorize package upload, registration, guard activation or publication. Later
work needs actual Connor sign-in/identity, a key-custody destination, actual
runtime bindings and separately approved quiet-window/protection evidence.
These remain inputs to verify, not completed facts. No credentials or private
signing key belong in chat or the archive.

## Session-stop preservation

At the eventual session closeout, keep the parked-task pointer in the concurrent
workstream index and retain this document, the local feature commits and the
sendable output archive. Preserve other agents' current handoffs and unrelated
working changes. This parking operation is not a full session stop and does not
approve pushing the feature. No milestone-log entry is required for this
archival-only update: nothing new was shipped.

Bounded Sweep Mode A: the material change is that this workstream is parked for
Monday. The current session index and this archive are reconciled; feature
implementation/review history remains at the exact Git references above.

## Claude prompt for Connor

Copy the complete text below into Claude on the Windows machine. Supply the
sendable archive and have it extract the outer archive first; the ZIP hash in
the prompt applies to the inner Windows09 ZIP, not the outer sendable archive.

```text
Help me run the WMKF Windows09 offline checks on this Windows machine. Execute the checks and preserve the evidence. This task ends before any Dataverse registration or enablement.

AUTHORIZED SCOPE
- Locate the supplied windows-handoff-09.zip, included alongside this prompt.
- Check prerequisites, verify the ZIP, extract it into a new folder, run the supplied offline checker, and preserve its results.
- Do not modify the supplied scripts or package.

HARD STOP BOUNDARIES
- Do not sign into Dataverse, request credentials or access private signing keys.
- Do not upload or register packages, assemblies, APIs or plug-in steps.
- Do not activate guards, enable publication, change roles, modify data or deploy anything.
- Do not change execution policies, unblock files or weaken security controls. If a security restriction prevents execution, report it and stop.
- If this Claude session cannot execute Windows commands, stop and explain that limitation.

1. LOCATE THE BUNDLE AND CHECK PREREQUISITES

Use bundle09 only. Ask me for its location if you cannot locate the supplied file without a broad search.

Confirm:
- Windows with .NET Framework 4.8 or later.
- Windows PowerShell.
- Microsoft Strong Name Tool, sn.exe, preferably available through Visual Studio Developer PowerShell.

You may inspect installed tools and locate sn.exe. Do not install software or change machine configuration. If a prerequisite is missing, report exactly what is missing and stop.

2. VERIFY THE ZIP BEFORE EXTRACTION

Calculate its SHA256. It must equal:

5d0defb6657f4828079e9db6439c2442960c3d05c662cf06f131a2755b8ea804

Comparison is case-insensitive. If it differs, stop without executing anything from the archive.

Extract it into a new, uniquely named folder. Do not overwrite an existing extraction or alter its directory structure.

3. RUN THE SUPPLIED CHECKER AND CAPTURE OUTPUT

Run Run-WindowsChecks.ps1 from the extracted folder using Windows PowerShell.

Capture a complete console transcript in a separate evidence folder OUTSIDE the extraction. The checker rejects unexpected files inside its extracted directory, so do not place your transcript or notes there.

Use:

Start-Transcript -Path "<absolute evidence path>\Windows09-console.txt"
try {
    & "<absolute extraction path>\Run-WindowsChecks.ps1"
}
finally {
    Stop-Transcript
}

Replace the placeholders with actual paths. If necessary, pass the actual installed tool path using:

-StrongNameTool "<absolute path>\sn.exe"

Do not modify the checker to bypass a failure.

4. PRESERVE RESULTS

If successful, the checker creates windows-check-result.json in the extraction.

- Retain that original file.
- Copy it into the separate evidence folder.
- Retain the full console transcript.
- Record the ZIP's actual SHA256 and the extraction/evidence paths in a short summary.
- Confirm the result JSON says OFFLINE_WINDOWS_CHECKS_PASSED and its package/source hashes agree with handoff-manifest.json.

Do not describe a partial run as successful. If execution fails, preserve the complete error and transcript, identify the failing step, and stop. Do not automatically rerun or overwrite evidence.

5. REPORT AND STOP

Give me:
1. PASS, FAIL or BLOCKED, with a brief explanation.
2. Exact paths to the evidence folder, console transcript and result JSON, if produced.
3. The verified ZIP SHA256.
4. Any missing prerequisite or unresolved error.

Tell me to return windows-check-result.json and the complete console output to the existing Codex chat for validation.

Explicitly confirm that no Dataverse registration, upload, activation, enablement, data change or deployment occurred.

Stop after this report. A passing offline check does not authorize installation or any next phase.
```
