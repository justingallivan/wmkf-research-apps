# Opus Review Disposition — Workbench Plan (2026-08-14)

**Point-in-time artifact.** Fable's disposition of every Opus finding in
`docs/audits/fable-refactor-plan-opus-review-2026-08-14.md`. Each finding was re-verified against
current source before disposition. The plan
(`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`) is revised accordingly.

| Finding | Disposition | Evidence | Plan change |
|---|---|---|---|
| P1-1 (Stage 2 dedupes nothing) | **ACCEPT** | Verified: 3 route scopes (`my-candidates.js:52`, `reviewers.js:46`, `decline-referrals.js:63`); concurrent `Promise.all` disjoint-select pairs (`reviewers-service.js:225-228`, `my-candidates-service.js:168-180`) | Stage 2 re-scoped to the sibling-query merge; ALS helper + `withDalContext` edit + cache-key contract + flag deleted; acceptance number restated to 6→3 person queries (1/1/1 across routes), suggestions unchanged |
| P1-2 (wrong seam + missed egress + PII) | **ACCEPT** | Verified: `dynamics-service.js` has 0 `fetch`; transport is `dynamics/http.js:24`; `lib/dataverse/client.js:50,106` second egress used by `dataverse-app-access-service.js` + `dataverse-settings-service.js` | Stage 1 retargeted to `lib/services/dynamics/http.js:24`; added no-raw-URL/entity-set-from-path redaction rule; added `lib/dataverse/client.js` as an explicit second-seam follow-up |
| P1-3 (false withDalContext claim) | **ACCEPT** | Verified: `context.js` delegates to ALS; not per-HTTP-request | Removed the "withDalContext scopes the request" justification (moot once the helper is deleted per P1-1) |
| P1-4 (T2 armed, not held) | **ACCEPT** | Verified: `vercel.json:61` daily schedule; `reviewer-reminders.js:38` dryRun default false | Corrected severity framing in the plan AND the security-audit doc AND memory; added reminder-flag live-state to the probe hand-off list |
| P2-5 (T2 filter under-specified) | **ACCEPT** | Verified divergence + house null-safe pattern (`reviewer-reminder-sweep.js:114-115`) | Stage 4 now specifies `(wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null)` + `wmkf_selected eq true`, notes the `$select` extension, and marks `authorizeMint` parity as optional defense-in-depth (ETag claim already largely closes the race) |
| P2-6 (missing decline-referrals) | **ACCEPT** | `decline-referrals-service.js:46-51` runs the same person read | Added to Stage 2's edit set |
| P2-7 (four-way split covers one leg) | **ACCEPT IN PART** | Stage 1 emit is Dataverse+Graph via the shared transport; Postgres/Blob/client are separate | Narrowed Stage 1's claim to "external dependency (Dataverse+Graph) timing"; client-render + Postgres timing named as explicit later measurement, not gated by Stage 1 |
| P3-8 (Stage 3 not a stage) | **ACCEPT** | T1 is owner-blocked since S414 | Relabeled "not a stage — blocked pending owner trust-model decision"; kept the confirmed characterization |
| P3-9 (rollback names unbuilt flag) | **ACCEPT** | No flag in Stage 2 steps | Stage 2 rollback corrected to plain revert |

No finding rejected; none needs-owner beyond the two already-flagged owner decisions (campaign window,
merge trust model). The review's own success signal is met: every correction is about the *proposed
work*, not the audit's characterization of live state — which held up under re-verification.

## Post-disposition contract-reconcile

Mode A over the revised plan: pending (run after the plan revision lands).
