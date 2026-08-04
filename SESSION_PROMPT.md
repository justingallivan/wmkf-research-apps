# Session Prompt: Post-revert steady state (Session 397)

> **Handoff, 2026-08-03 (late, Session 396).** The Reviewer Find
> warm-reconciliation incident is CLOSED. Production runs the pre-rollout
> baseline again and the owner smoked it. This session starts from a working
> production; nothing here is urgent. Run `/start` first.

## What Session 396 did

- Ran the full `/start` gate suite on branch `reviewer-find-revert-baseline`:
  all gates green (including the doc-drift gates the S395 handoff expected to
  be red — S395's doc cleanup had already handled them).
- Pushed the branch; Vercel Git integration built a Preview
  (stable alias `wmkfresearchapps-git-reviewer-76ad8d-…vercel.app`).
- Preview smoke initially failed with "Failed to load dashboard": the
  Dataverse target interlock correctly denied preview→prod reads. Fixed per
  the owner-decided S355 pattern — owner set `DATAVERSE_ALLOW_PROD_READS=yes`
  scoped to the branch's Preview env, redeploy, smoke passed.
- Owner smoke (preview, then production) verified Request `1002903`: warm
  roster with checkboxes on selectable rows (Shapiro, Ferrara), identity-gated
  rows correctly read-only with the confirm affordance (Rajan, Kim, Lu —
  checkbox gating confirmed against
  `shared/components/reviewers/ReviewerSearchSection.js:2773-2809`), no
  "Reconcile previously found reviewers" button, no per-card evidence-refresh.
- On owner go: fast-forwarded `main` `aef99e63 → 2fc29b82` and pushed.
  Production deployment `dpl_EbFDP4PpPa9K91bs9CnuH2yUviW1` Ready, serving all
  prod domains; owner re-smoked production. Incident closed.
- Durable closeout: incident doc marked `status: historical` with a resolution
  section; `DEVELOPMENT_LOG.md` milestone entry; memory-router line updated.

## Open items for this or a later session

1. **[P1] Remaining lockfile advisories** (the revert reintroduced advisories;
   S396 late: owner ran the non-force `npm audit fix`, which cleared the
   `ip-address` high, shipped as `f9d9a1f2`). S397: the `brace-expansion`
   high (GHSA-rgw5-rvv9-x895) is FIXED and promoted to `main` (`3130733e`,
   owner-approved ff) — no `--force` was needed: the advisory sat on the
   vendored compat shim's upstream pin (`vendor/brace-expansion-compat`,
   `npm:brace-expansion@5.0.8`), bumped to `5.0.9` in place; verified via
   shim/minimatch smoke + types + 6,774 unit tests + production build.
   Still open, needing an owner decision: moderate `postcss` pinned under
   `next` (likely needs a `next` upgrade). `main` auto-deploys — treat it as
   a deliberate change with full verification.
2. ~~Temporary smoke scaffolding~~ — DONE in S396: owner removed the Vercel
   Preview env var `DATAVERSE_ALLOW_PROD_READS` (verified via `vercel env rm`
   output) and Codex removed the temporary Entra redirect URI (independently
   verified via `az ad app show` — the registration is back to its four
   permanent callbacks). Note: a local homebrew Azure CLI now exists and is
   owner-login authenticated for the `wmkeck.org` tenant; see the
   dev-environment wiki topic for its verified capabilities and caveats.
3. ~~[P2] Wiki topic~~ — DONE in S397 (`30af076d`):
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` reconciled against
   the live baseline, stale marker cleared (`status: active`), agent-wiki /
   memory-router / doc-currency gates green.
4. ~~[P3] Optional read-only check~~ — DONE in S397, verdict **RENDERS**
   [VERIFIED via S397 SELECT-only probe of Postgres `reviewer_find_roster`]:
   the probe found 7 staff identity confirmations with `confirmedAt` in the
   Aug 1–3 window and explicitly checked the disconfirming condition on each —
   none carries the incident-only shape (`canonicalPersonId` /
   `canonicalPersonEtag` / missing `email`), all match the old/simple
   `staffIdentityConfirmation` shape with `pdIdentityConfirmationId` =
   `confirmationId`, so the baseline read path
   (`preserveStoredRosterAuthority`) surfaces email/website/affiliation
   correctly. The theoretical shape mismatch was possible in code but did not
   materialize in stored data.
5. **Branch hygiene** — `reviewer-find-revert-baseline` deleted in S397
   (verified ancestor of `main` first; removed locally and on origin).
   `reviewer-find-outcome-contract` is ABANDONED but kept for history — never
   merge it.

## Reviewer Find latency — incremental plan ACTIVE (S397, 2026-08-04)

The freeze is lifted: the owner approved a new incremental, tier-gated plan
(measure → one cache per increment → observe). Record of truth:
`outputs/reviewer-find-warm-revisit-step0-findings.md` (gitignored working
doc — durable facts must be re-homed at closeout if the file is retired).
- **Step 0 measured** (production, 2026-08-04): warm revisit ≈5.9s; roster
  GET cheap; the repeated work was `load-proposal` (full PDF re-download +
  Blob re-upload every view) and the ungated Haiku exclusion parse.
- **Step 1 SHIPPED to production**: proposal blob cache
  (`efa6aa5e`+`bc3a8739`+`122e6661`, main ff → `c4e08fcc`). Full chain:
  sonnet build → opus review (3 hardenings) → Codex adversarial (1 hardening
  + 1 pre-existing finding deferred) → Preview smoke → owner production
  smoke: MISS→HIT proven on `1003010`; `1002903` warm settle ~3.1s vs 5.9s
  baseline (~47% cut). Observation window ~90d (one blob-sweep cycle) gates
  the Candidate B (exclusion-parse cache) go/no-go.
- **Deferred backlog item (owner to prioritize)**: enrichment cache
  staleness on in-place proposal updates — PRE-EXISTING on main, verified
  not introduced by Step 1; fix shape recorded in the findings doc.
- **Cleanup status: COMPLETE.** Preview env var removed (verified via owner
  `vercel env rm` output); merged branch deleted local+origin; Entra
  registration restored to exactly the four permanent callbacks [VERIFIED
  2026-08-04 via owner-run `az ad app update` + post-update `az ad app show`
  listing four URIs]. No temporary scaffolding remains.

## Standing constraints

- Latency/performance work proceeds ONLY within the incremental plan above —
  one owner-approved increment at a time, tier-gated, with its own
  observation window. Read
  `.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md` before
  proposing any expansion.
- Do not cherry-pick from `5b6757df..7072d52a` or from
  `reviewer-find-outcome-contract` without owner sign-off.
- Request `1002903` remains read-only; no reviewer promotion/invite/email
  during any verification.

## Handoff summary

```text
Previous owner: Session 396 (Fable) — preview smoke, production promotion, closeout
Branch: main @ 2fc29b82 (= reviewer-find-revert-baseline tip, merged)
Production: dpl_EbFDP4PpPa9K91bs9CnuH2yUviW1 Ready, owner-smoked, incident CLOSED
Incident doc: docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md (historical)
Next candidate first task: item 1 (owner decision on remaining advisories)
```
