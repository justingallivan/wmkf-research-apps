# Session 260 Prompt: Trust-boundary GUID hardening + blocking gate — SHIPPED

> **GIT.** All S259 work is on `main` (`58d5fd35..0b63b145`, 8 commits). Working tree clean,
> build/lint/gates green. **NEW BLOCKING commit guard this session:** `check:trust-boundary-guid`
> now blocks any commit where a client-supplied id reaches a Dataverse selector without a GUID
> guard (wired in `.claude/settings.json`, alongside the enum-parity guard). All three commit
> hooks share one trigger `.claude/hooks/lib/git-commit-detect.js`.

## Session 259 — what happened

Acted on the queued S258 Codex review of the pre-commit self-review hook. Codex found the S258
trust-boundary fan-out was **incomplete** — many reviewer-surface routes passed a client id into a
Dataverse selector with only a presence check. Closed the exposure, then turned the failure mode
into a BLOCKING gate, then hardened + (two Codex rounds) the commit-hook trigger that enforces it.

1. **Trust-boundary security fix** (`58d5fd35`) — new shared validator `lib/utils/guid.js`
   (`isGuid`/`allGuids`). GUID-validated client ids at the edge across **12 routes**: reviewer-finder
   (load-proposal, my-candidates, contact-history, cycle-material, generate-emails), review-manager
   (reviewers, regenerate-token, download-review, mark-received-no-file, render-emails, send-emails),
   and **`phase-i-dynamics/summarize`** — the one Codex missed, found by an independent fan-out across
   all 21 sink-bearing routes. `getRecord`/`updateRecord` interpolate the id raw into the request URL;
   `findByRequest` into an OData `$filter` → over-fetch / IDOR / filter-injection. Defense-in-depth:
   `reviewer-suggestion.findByRequest` throws on a non-GUID. Audited + confirmed already-safe: workbench
   routes, field-primer/generate, admin policies/prompts (server ids), external context (token ids),
   dynamics-explorer (admin-only, GUID-checked at entry).
2. **Blocking `check:trust-boundary-guid` gate** (`ae016131`, activated `fd94267d`) — AST taint
   analysis (`scripts/check-trust-boundary-guid.js`) flags any `req.query`/`req.body` id reaching a
   Dataverse selector without a recognized GUID guard. 16-case self-test (every FAIL fixture proves it
   catches violations); startup gate + blocking commit guard.
3. **Commit-hook trigger hardened** (`692a82a4`, Codex rounds `5a78c855` + `2dc40917`) — extracted ONE
   shared `git-commit-detect.js` (`isGitCommit`/`isAmend`) for all three commit hooks (no trigger drift).
   Catches global-option forms the old `/\bgit\s+commit\b/` missed (`git -c x=y commit`, `git -C p commit`),
   ignores `commit-tree`. Design: liberal match (never MISS a real commit — the dangerous direction for a
   blocking guard), strip-quoted-with-placeholder, fail-OPEN via require-inside-try. 46-case test incl.
   automated fail-open regressions.
4. **Wiki capture** (`0b63b145`) — `security-auth.md` → "Trust-Boundary GUID Validation";
   `dev-environment.md` → "Commit Guards & Triggers". Banner cleared from the prior prompt (`7442bd6d`).

## Potential Next Steps

1. **Field-primer expert enrichment (deferred, Justin-requested S258):** make confirmed experts
   clickable to ORCID / OpenAlex profiles; optionally a Wikipedia link (`ids.wikipedia`, not currently
   fetched) + the already-mapped h-index/citations. **Profile links only — NO contact/email enrichment**
   (OpenAlex has no emails anyway; keeps the primer orientation-only, not a candidate source). Small.
2. **J27 document-capture planning (near-term, large):** D26's SharePoint filename-match doc resolution
   is an INTERIM bridge; J27 collects docs differently and the converging target (Justin+Connor) is
   direct Dataverse-table references (`wmkf_requestdocument`-style). Needs a real planning push soon —
   `project-j27-doc-capture-evolution`.
3. **Reviewer hold-step GO-LIVE (carried from S257, untouched):** built but DORMANT. Two switches:
   (a) a staff UI trigger to send `templateType:'hold'`/`'finalize'` (`InviteEmailModal.js` hardcodes
   `'invitation'`); (b) flip `isProposalReadyForReviewers` (returns `true` today) to the real post-QA
   release signal — **[OPEN — Justin/Connor]** identify that signal. Sequence: UI trigger → predicate.
   `project-reviewer-hold-step-decouple`.
4. **Proposal-tab / Field-Primer tests (clean follow-up, carried from S258):** no automated tests for the
   Proposal-tab routes or Field Primer yet (verified manually). `tests/unit/workbench-proposal-documents.test.js`
   + `field-primer-request-mode.test.js` are listed in the build plan.

### Housekeeping (verify before acting)
- **wave2 schema drift (open hazard):** a prod dry-run showed `--wave=2 --execute` would CREATE a
  duplicate `wmkf_appreviewersuggestion_honorariumrequest` relationship (prod has it under a different
  SchemaName). Do NOT run full `--wave=2 --execute` until reconciled. Single fields → isolated followup
  waves. `project-dataverse-schema-deploy-gotchas` #6.
- **Hold-step Atlas/UI** (carried): add `held` to the reviewer `wmkf_responsetype` Atlas page; confirm
  whether `held` deserves its own workbench column.
- **Field-primer latency:** generation runs "several minutes" — slowest part is likely the SEQUENTIAL
  OpenAlex expert grounding. If it annoys, parallelize the grounding lookups (or background-job it).

### Deferred / externally-blocked (do NOT lead with these; verify before acting)
- Recall padding-ceiling live check before raising count >15 (needs API key + a real proposal).
- SerpAPI Hobby-tier downgrade eval (Justin, out-of-repo). `score-candidates` reseed only if you edit
  its template. `affiliationHistory` producers — COI-inert dead code (`project-deferred-code-cleanup`).
- **Vercel CLI** on this machine is behind (`54.12.2 → 54.14.0`); optional `npm i -g vercel@latest`.

## Parked — do NOT surface in startup summaries
> User-recall-only; act only when the named un-park trigger fires (`feedback-dont-resurface-parked-items`).
- **PubPeer migration off SerpAPI** — contingent on a sanctioned-API reply from PubPeer (Justin emailed
  S251). `docs/agent-wiki/topics/integrity-screener.md`; `project-serpapi-capability-erosion`.

## ⚠ Continuity guardrails (still live)
- **`check:trust-boundary-guid` BLOCKS commits** when a client id reaches a Dataverse selector without
  a GUID guard. Canonical guard: `lib/utils/guid.js` (`isGuid`/`allGuids`). Server-derived ids (read off
  a row already fetched, or a token-bound row) are trusted. Escape hatch: `// trust-boundary-guid:ignore
  reason=<id>`. Intra-file taint (interprocedural not modeled). `docs/agent-wiki/topics/security-auth.md`.
- **All three commit hooks share `.claude/hooks/lib/git-commit-detect.js`.** Editing the trigger? It is
  liberal-by-design (never miss a real commit) and fails OPEN. `docs/agent-wiki/topics/dev-environment.md`
  → "Commit Guards & Triggers". The self-review hook is ADVISORY; enum-parity + trust-boundary BLOCK.
- **`wmkf_ai_fieldprimer` holds ONE of:** a DONE envelope (`schema:'field-primer/v1'`) or a transient
  generation LEASE (`schema:'field-primer/lease'`) or null. Parse via `shared/utils/field-primer-envelope.js`
  — never hand-edit; the route owns the lease/persist contract. Primer is staff orientation only, NEVER a
  reviewer-candidate/contact source.
- **D26 Proposal-tab doc resolution is an INTERIM bridge** (filename-match under `Phase I`). J27 changes
  it — `project-j27-doc-capture-evolution`.
- **Hold step BUILT but DORMANT** (carried): `isProposalReadyForReviewers` returns `true`, nothing sends
  `hold`. `project-reviewer-hold-step-decouple`; `docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md`.
- Memory router stays **hub-link form**; `grep`/`rg` may corrupt identifiers+digits
  (`project-rtk-grep-output-corruption`) — use Read for exact content.

## Key Files Reference (S259 — trust-boundary work)

| File | Role |
|------|------|
| `lib/utils/guid.js` | shared edge validator — `isGuid` / `allGuids` (+ `GUID_RE`) |
| `scripts/check-trust-boundary-guid.js` | AST taint gate: client id → Dataverse selector must be GUID-validated |
| `scripts/check-trust-boundary-guid-self-test.js` | 16-case self-test (FAIL fixtures + live baseline) |
| `.claude/hooks/trust-boundary-guid-commit-guard.js` | blocking commit guard (exit 2) wrapping the gate |
| `.claude/hooks/lib/git-commit-detect.js` | shared `isGitCommit`/`isAmend` trigger for all 3 commit hooks |
| `.claude/hooks/lib/git-commit-detect.test.js` | 46-case trigger test (incl. fail-open regressions) |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `findByRequest` now throws on non-GUID (filter-injection chokepoint) |
| `pages/api/phase-i-dynamics/summarize.js` | the route Codex missed — now GUID-validates `requestGuid` |

## Testing
```bash
npm run build && npm run lint
node .claude/hooks/lib/git-commit-detect.test.js                 # 46-case commit-trigger matrix
npm run check:trust-boundary-guid && npm run check:trust-boundary-guid:self-test
npm run check:api-routes && npm run check:fact-consistency
```
> Trust-boundary fix is server-side validation only — verified via the gate + self-test (no live app
> run needed). The reviewer-surface routes return 400 on a malformed id before any Dataverse call.
