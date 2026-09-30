# Session 559 Prompt: transcript upload incident closed

## Session 558 Summary — 2026-09-30 PT (Codex; DOCX/VTT Production acceptance)

**DONE:** the Site Visit transcript uploader fix is merged, deployed and accepted.
[VERIFIED via GitHub/Vercel release checks and owner report] The owner confirmed
both original DOCX and VTT uploads worked on request 1002903 after PR #379.
PDF was also confirmed working. No remaining implementation or acceptance item
is open for this incident.

### What Was Completed

1. **Diagnosed the transcript failures.** Initial screenshot/filename evidence
   resolved to request 1002860; the owner's later explicit probe target was
   1002903. Read-only probes established DOCX package mismatch and VTT empty-file
   failures. Deleted sources limit forensic attribution; that uncertainty is
   historical and does not reopen the successful acceptance test.
2. **Released two fixes.** PR #375 added strict source/stored DOCX attestation,
   stable candidate receipts and retry handling. PR #379 added the exact newly
   promoted custom-properties OPC links and bounded decoded Blob stream sizing.
   Actor/path/privacy, lease fences and exact cleanup receipts remain enforced.
3. **Reviewed and validated.** Claude Opus reviewed through verified Max OAuth
   outside the sandbox, with API-key source none. Its compressed-length blocker
   and small safeguards were fixed; closure approved. Follow-up validation:
   589 tests / 19 suites, canonical build and scoped gate/self-test checks passed.
4. **Production release and acceptance.** PR #379 merged at 23:17:05 UTC;
   deployment `dpl_D9bz5jCdvAYuf2iPqmUxseT3mcTC` reached Ready on branded domains.
   GitHub deployment `6772260367` confirms the exact merge SHA and success at
   23:17:46 UTC (4:17 PM Pacific). Basic read-only app smoke passed. The owner's
   “They both worked” confirms DOCX/VTT acceptance; no additional agent upload
   or registry probe was performed. No migration or flag change was needed.
5. **Saved the closeout on main.** Owner explicitly selected `main` for session
   docs. An isolated documentation branch preserves concurrent Factory and
   Claude checkouts; its PR lands this handoff on main. The milestone entry is
   “DOCX and VTT transcript upload incident resolved.” CLAUDE.md needs no change.

### Commits

- `d4a83fee1` — Fix DOCX transcript uploads after SharePoint property promotion.
- `5c41f26e8` — Address Opus review of DOCX transcript recovery.
- `2eaa07670` — PR #375 merge.
- `90ea3f0a5` — Fix transcript metadata promotion and private Blob stream sizing.
- `ebbbc1307` — PR #379 merge and owner-authorized Production release.
- Session closeout documentation commit: see the latest documentation PR/history.

## Next Items

### Verified Open

None for this transcript incident. The owner accepted both formats in Production.

### Verify Before Acting

Other workstreams are not this session's worklist. The previous mainline prompt
is retained in Git history at `9d0119d4d:SESSION_PROMPT.md`; it contains dated
Factory/scheduled-email and older carryovers, including superseded release
claims. Read the current owning branch, source/Atlas and owner decisions before
acting on any of them. The Factory checkout was clean at `b7abdac6a` when this
handoff began and was left untouched.

### Do Not Reopen Without New Evidence

1. DOCX/VTT upload acceptance on request 1002903 is complete. Evidence: owner
   report and PR #379. Do not ask for the deleted originals as unfinished work.
2. Rejected old staging rows cannot be reused. Future uploads select the source
   anew; no cleanup/deletion or repair is queued. Recheck current Production
   state before a future rollback; its release baseline is in the incident receipt.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/post-presentation-materials/material-service.js` | Finalize, source/stored attestation and candidate receipt behavior |
| `lib/services/test-requests/docx-package-attestation.js` | Strict DOCX source and render package comparison |
| `lib/services/portal-upload-staging.js` | Private stream read, cap, actual size/hash and lease fence |
| `docs/plans/evidence/post-presentation/transcript-package-and-blob-read-2026-09-30.md` | Current incident release/acceptance and bounded reconciliation |
| `docs/plans/evidence/post-presentation/docx-transcript-fix-2026-09-30.md` | Initial incident and PR #375 history |
| `DEVELOPMENT_LOG.md` | Production incident milestone |

## Testing and handoff limits

Runtime validation is recorded in the incident receipts; this closeout changes
only documentation and runs relevant documentation/invariant gates. The optional
claim-evidence pilot report returned unavailable local state; no advisory row
was fabricated. No memory-router changes or growth advisory occurred. Owner
acceptance is separate from the implementer's automated tests and the reviewer's
read-only source inspection. No agent-created Production upload or repair ran.
