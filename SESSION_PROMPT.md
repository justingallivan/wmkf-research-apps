# Session 268 Prompt: Finish branded domains + (future) grantee portal spec

> **S267 delivered the contact-recall pivot.** The full reviewer contact-leads layer (Slices 1–5)
> + on-card manual contact edit shipped to prod, Codex-reviewed across 5 passes. The broad paid
> scout (Slice 2b) was MEASURED unjustified (Slice 1 audit: ~68% verified, 100% of misses are
> found-then-discarded) — do NOT build it.
> **Open carryover: branded subdomains await IT DNS** — finish the verify + env flip when IT confirms.

## Session 267 — what happened

Built the entire reviewer **contact-leads recall layer** end-to-end (the S266 design), measuring
first, then shipping each slice with a Codex review and a prod deploy. Then added an on-card
manual contact editor, helped set up two Vercel custom domains (awaiting IT), and seeded a
future grantee-portal spec. Codex (separate window) shipped a reviewer E2E rehearsal harness.

### Shipped to prod (all pushed)
1. **Slice 1 — missing-email audit** (`lib/services/reviewer-contact-audit.js`). Classifies each
   candidate's missing-email reason into buckets; logged by both enrichment routes + on SSE stats.
   Ran in prod on 2 proposals: **~68% verified; every miss was `withheld_by_gate` /
   `lead_found_not_persisted` / `has_page_no_email`** — 0 `searched_no_result` / `search_skipped`.
   → Slice 2b (paid scout) is unjustified.
2. **Slice 2a — quarantined `contactLeads[]`** (`contact-enrichment-service.js`). Surfaces
   discarded/withheld contacts + faculty-pages-without-email. `_addContactLead` forces
   `persistable:false`. No new network calls.
3. **Slice 3 — card display** (`shared/components/reviewers/ContactLeads.js`). Read-only; gated on
   `!identityUnverified` (NOT `!email` — fixed mid-session so promoting one field doesn't hide the
   others); high/medium prominent, low/rejected behind a toggle.
4. **Slices 4+5 — staff promotion + roster persistence.** "Use this email"/"Use this page" stamps
   `emailSource:'manual'` → `emailConfidence` LOW → confirm-before-send. Compact leads persisted in
   the Find roster (`pruneContactLeads`, ≤8) so they survive reload.
5. **On-card manual contact edit** (`CandidateEditModal` local `onApply` mode +
   `ReviewerSearchSection.setManualContact`). "✏️ Edit contact" lets staff type email/website/
   affiliation/h-index by hand (the Javier Martinez case). Name locked on the Find card (name is
   the dedup key). Affiliation edits intentionally NOT COI-rechecked (owner decision — see memory).
6. **Codex E2E rehearsal harness** (separate window): reviewer email-capture mode + captured-invite
   + return-upload Playwright specs + runbook (`docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md`).

### Codex reviews (all clean / fixed)
5 Codex passes — every safety/identity invariant CONFIRMED. Fixes applied: Serp name-mismatch
marker (`c196d574`), dedup sharpen (`d4e62a33`), manual source authoritative on promotion
(`93b7e2ce`, MED), website-clears-abstain + h-index NaN guard (`d3682068`).

### Infra / data ops (not feature commits)
- **Branded Vercel domains** `applications.wmkeck.org` + `reviews.wmkeck.org` added to project
  `wmkf_research_apps` (both Invalid Configuration until DNS). DNS host is **Cloudflare** (IT). The
  records to give IT (from dashboard Manual setup): **CNAME → `c2b4d46311200992.vercel-dns-017.com`**
  for each, **DNS-only / proxy OFF**. IT emailed; Justin replied with records. Email is M365/Dynamics
  (PD mailbox) — subdomains are web-only, no mail records, no SMTP2GO needed.
- Roster cleanups (non-applicant) for **1002794** and **1002874** via `reset-request-reviewers.mjs`.
- Refreshed 3 stale applicant suggestion labels on 1002794 (Alexandra/Thomas/Anh-Thu).

## Potential next steps for S268

### 1. Finish the branded domains (carryover — needs IT DNS first)
When IT confirms the CNAMEs are in Cloudflare (DNS-only):
- Verify both: `vercel inspect <url>` / dashboard Refresh → Valid + HTTPS active (use `vercel inspect`,
  NOT a `vercel ls` hash-poll — see `feedback-deployment-monitoring-use-inspect`).
- Set env **`REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org`** (Production) — it falls back to
  `NEXTAUTH_URL` until set (commit `19bd446e`).
- Redeploy so future reviewer invitation emails use the branded link.
- Decide what `applications.wmkeck.org` routes to (just live → app for now, unless a path is wanted).

### 2. (Future) Grantee Deliverables Portal — spec it out
`docs/GRANTEE_PORTAL_SPEC.md` stub (commit `835e3a29`). Workbench-triggered at cycle close: Claude
drafts 2 docs → email grantees for edit/approval → they return 2 edited docs + graphical-abstract
image + caption + consent checkbox → Dataverse (+ SharePoint). Reuses the reviewer-portal primitives
(magic-link, token-lifecycle, M365 send, SharePoint upload, Executor). Biggest open question: what
the two documents ARE. Run a Codex design pass off the stub.

### 3. (Parked) S266 TEMP generation audit log still live
`d0fb1ef5` `[Discover API] S266 generation audit` in `discover.js` — never reverted. Low priority;
revert when the generation/exclusion review is truly done. (Distinct from the Slice-1 audit, which
is permanent.)

## Continuity guardrails
- **Do NOT build Slice 2b** (broad paid scout) — measured unjustified.
- Contact-leads safety: leads stay `persistable:false`; a manually entered/promoted email is `manual`
  → low-confidence → confirm-before-send. Never weaken this.
- Reviewer-finder posture: recall over identity-precision (`feedback-prioritize-contact-recall-over-identity-precision`).
- Multi-agent: Codex also works on `main` (separate window/worktree, shares origin). At session
  boundaries: clean tree, scoped commits, `git pull --rebase` before push.

## Key Files Reference
| File | Role |
|------|------|
| `docs/REVIEWER_CONTACT_LEADS_SPEC.md` | Slices 1–5 spec, all IMPLEMENTED |
| `lib/services/reviewer-contact-audit.js` | Slice 1 missing-email classifier |
| `lib/services/contact-enrichment-service.js` | `contactLeads` collection (`_addContactLead`/`_collectContactLeads`) |
| `shared/components/reviewers/ContactLeads.js` | Slice 3 read-only lead display |
| `shared/components/reviewers/ReviewerSearchSection.js` | `setManualContact`/`useLead` + Edit-contact wiring |
| `shared/components/reviewers/CandidateEditModal.js` | local `onApply` mode (Find-card manual edit) |
| `docs/GRANTEE_PORTAL_SPEC.md` | future grantee-portal stub |
| `docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md` | Codex E2E rehearsal harness |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite (~2690 tests as of S267)
npm run check:agent-wiki && npm run check:fact-consistency && npm run check:doc-currency
```
