# Session 259 Prompt: Workbench Proposal tab + Field Primer — SHIPPED

> **GIT.** All S258 work is on `main`, pushed (`12c77512..c79fceb8`, 19 commits). Working tree clean.
> Build/lint/gates green. **NEW commit hook (advisory):** `.claude/hooks/pre-commit-self-review.js`
> injects a staged-diff-tailored self-review checklist on every `git commit` (verify-claims / fan-out
> guards / trust boundaries / concurrency). It does NOT block — it's the forcing function for the
> failure modes below. The enum-parity guard still BLOCKS commits on parity drift.

## Session 258 — what happened

Built the **entire Workbench Proposal tab end to end** (`docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md`,
Phases 1–6) + the **Field Primer** generate/persist, each slice Codex-reviewed. Verified live in the
running app (info + documents + download/View). Also: a new prod Dataverse field, and a remediation
for the recurring review-churn.

1. **Proposal tab — 3 sections** (`shared/components/workbench/ProposalTab.js`, lit up the placeholder):
   - **Top** — Dataverse info: PI (`wmkf_projectleader`), co-PIs (junction `wmkf_role=100000001`, names
     only), abstract, Requested Amount (`akoya_request`), Total Project Budget (`akoya_expenses`).
   - **Middle** — Phase I documents: per-cycle config (`shared/config/workbenchProposalDocuments.js`),
     `GET /api/workbench/proposal-documents` (list, slot-match) + `download-proposal-document` (scoped
     proxy, request-folder GUID + Phase-I membership + safe inline View). Reuses Graph/SharePoint infra.
   - **Bottom** — AI content: `wmkf_ai_fitrationale/summary/dataextract` + the Field Primer.
   `fee545dc` (P1), `6225d9f9`/`ecc97f63` (P2), `b97bd385` (View).
2. **Field Primer generate + persist** — `/api/field-primer/generate` gains a `requestId` mode (app
   access widened to `reviewers`): pulls `ProjectDescription` from SharePoint, generates, grounds
   experts vs OpenAlex, **persists a JSON envelope to `wmkf_ai_fieldprimer`** via an **ETag-conditional
   single-flight LEASE** (idempotent; no double paid call; nonce-verified conditional final write).
   `8dc9016d` → `765def20` → `926d69ff` → `8be5ef12` (3 Codex rounds to clean). Shared envelope/lease
   validator: `shared/utils/field-primer-envelope.js`.
3. **New prod Dataverse field** `akoya_request.wmkf_ai_fieldprimer` (Memo/JSON/100000), deployed live
   via an **isolated** wave (`lib/dataverse/schema/wave2-fieldprimer/`) — `9100713b`.
4. **Self-review hook + lesson** — `.claude/hooks/pre-commit-self-review.js` + memory
   `feedback-self-review-before-delegating-review.md`; the fan-out audit it embodies caught a real miss
   (`resolve-request` lacked requestId GUID-validation). `10c49802`.
5. **`reset-request-reviewers.mjs`** now protects applicant-sourced rows by default (`12c77512`); J27
   doc-capture evolution captured as a durable memory + wiki routing (`bf3a87ec`).

## Potential Next Steps

1. **✅ DONE (S259) — hook self-review ran + acted on.** Codex's adversarial review of the
   pre-commit self-review hook found the S258 fan-out was incomplete: many reviewer-surface routes
   passed a client id into a Dataverse selector with only a presence check. Fixed across all of them
   + `phase-i/summarize` (`58d5fd35`), added a BLOCKING `check:trust-boundary-guid` gate + self-test +
   commit guard (`ae016131`, `fd94267d`), and hardened the shared commit-hook trigger regex
   (`692a82a4`). See `docs/agent-wiki/topics/security-auth.md` → "Trust-Boundary GUID Validation".
2. **Field-primer expert enrichment (deferred, Justin-requested S258):** make confirmed experts
   clickable to ORCID / OpenAlex profiles; optionally a Wikipedia link (`ids.wikipedia`, not currently
   fetched) + the already-mapped h-index/citations. **Profile links only — NO contact/email enrichment**
   (OpenAlex has no emails anyway; keeps the primer orientation-only, not a candidate source). Small.
3. **J27 document-capture planning (near-term, large):** D26's SharePoint filename-match doc resolution
   is an INTERIM bridge; J27 collects docs differently and the converging target (Justin+Connor) is
   direct Dataverse-table references (`wmkf_requestdocument`-style). Needs a real planning push soon —
   `project-j27-doc-capture-evolution`.
4. **Reviewer hold-step GO-LIVE (carried from S257, untouched this session):** built but DORMANT. Two
   switches: (a) a staff UI trigger to send `templateType:'hold'`/`'finalize'`
   (`InviteEmailModal.js` hardcodes `'invitation'`); (b) flip `isProposalReadyForReviewers` (returns
   `true` today) to the real post-QA release signal — **[OPEN — Justin/Connor]** identify that signal.
   Sequence: UI trigger → predicate. `project-reviewer-hold-step-decouple`.

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

## Parked — do NOT surface in startup summaries
> User-recall-only; act only when the named un-park trigger fires (`feedback-dont-resurface-parked-items`).
- **PubPeer migration off SerpAPI** — contingent on a sanctioned-API reply from PubPeer (Justin emailed
  S251). `docs/agent-wiki/topics/integrity-screener.md`; `project-serpapi-capability-erosion`.

## ⚠ Continuity guardrails (still live)
- **NEW self-review hook is ADVISORY, not blocking** — it injects a checklist at commit; it can't force
  judgment. Treat it as the reminder to actually fan-out/verify. `feedback-self-review-before-delegating-review`.
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

## Key Files Reference (Proposal tab — all this session)

| File | Role |
|------|------|
| `docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md` | the spec (Phases 1–6, design Qs resolved) |
| `pages/workbench/[requestId].js` | shell — renders `ProposalTab` on `tab=proposal` |
| `shared/components/workbench/ProposalTab.js` | the 3-section tab + FieldPrimer UI |
| `pages/api/workbench/resolve-request.js` | top + AI data (now GUID-validates requestId) |
| `pages/api/workbench/proposal-documents.js` + `download-proposal-document.js` | doc list + scoped proxy |
| `shared/config/workbenchProposalDocuments.js` | per-cycle Phase I filename→label map (interim) |
| `lib/services/workbench-proposal-documents.js` | SharePoint list/slot-match + `getProposalText` |
| `pages/api/field-primer/generate.js` | requestId persist mode + ETag lease |
| `shared/utils/field-primer-envelope.js` | envelope/lease validator (shared route↔UI) |
| `lib/dataverse/schema/wave2-fieldprimer/akoya_request-fieldprimer.json` | the new field's schema-as-code |
| `.claude/hooks/pre-commit-self-review.js` | the new advisory commit hook |

## Testing
```bash
npm run build && npm run lint
npx jest --testPathPatterns "workbench|field-primer|proposal"   # (note: no dedicated tests yet — see below)
npm run check:api-routes && npm run check:atlas && npm run check:fact-consistency
```
> **No automated tests** were written for the Proposal-tab routes / Field Primer this session (verified
> manually in the running app). Adding `tests/unit/workbench-proposal-documents.test.js` +
> `field-primer-request-mode.test.js` is a clean follow-up (the build plan lists them).
