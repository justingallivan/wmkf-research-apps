# Nomenclature Glossary

Canonical, human-readable glossary for confusing or overloaded names across the
multi-app repo. It is backed by the `APP_LIFECYCLE_REGISTRY` and
`ROUTE_NAMESPACE_LIFECYCLE` exports in `shared/config/appRegistry.js` (the data),
and explains how a legacy / overloaded term maps to its current canonical name,
owner app, and allowed use.

Strategy and classification framework: `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md`.
The agent wiki routes here; it does not duplicate these entries. When a term's
state changes, update the export in `appRegistry.js` and the matching entry here
in the same pass, then run `npm run check:fact-consistency` and
`npm run check:doc-symbol-refs`.

Per-term fields: `canonicalName`, `legacyAliases`, `status`, `ownerAppKey`,
`successorKey`, `surfaceType`, `currentPaths`, `allowedUse`, `forbiddenUse`,
`migrationDecision`, `notes`, `lastVerified`. `status` ∈ `canonical |
legacy-live | deprecated | ambiguous | direct-url-test`. `migrationDecision` ∈
`RENAME | ALIAS | LEAVE+DOCUMENT`.

---

## Request Workbench

- **canonicalName:** Request Workbench
- **legacyAliases:** Reviewers (app display name), Workbench
- **status:** canonical
- **ownerAppKey:** `reviewers`
- **successorKey:** —
- **surfaceType:** app
- **currentPaths:** app key `reviewers` → `/workbench`; `pages/workbench/[requestId].js`; `/api/workbench/*`
- **allowedUse:** The current per-request reviewer dashboard. Successor to Reviewer Finder + Review Manager.
- **forbiddenUse:** Don't call it "Reviewer Finder" or "Review Manager" in new UI/docs.
- **migrationDecision:** —
- **notes:** App `key` is `reviewers` but the user-facing surface is the Workbench at `/workbench`. The canonical API namespace is `/api/workbench/*`; the legacy `reviewer-finder`/`review-manager` namespaces are still live (see below).
- **lastVerified:** 2026-06-26

## Reviewer Finder

- **canonicalName:** Request Workbench (find/invite lanes)
- **legacyAliases:** Reviewer Finder, `reviewer-finder`
- **status:** legacy-live
- **ownerAppKey:** `reviewers`
- **successorKey:** `reviewers`
- **surfaceType:** route-namespace
- **currentPaths:** `/api/reviewer-finder/*`; persisted prefs in `shared/config/reviewerFinderPreferences.js` (per-user draw + prompt overrides keyed `reviewer-finder.*`); model-override settings stored under the `model_override:` namespace keyed by app (loader strips the `model_override:` prefix — `model-override-loader.js:44,54`)
- **allowedUse:** Borrowed-live-infra. The `/api/reviewer-finder/*` routes are live and owned by the Workbench. Reference them by path as-is.
- **forbiddenUse:** Do NOT rename the route path or bare-rename any persisted `reviewer-finder` key — both are contracts (route + stored preference/override). Don't re-add `reviewer-finder` to `APP_REGISTRY`.
- **migrationDecision:** LEAVE+DOCUMENT
- **notes:** Consolidated into the Workbench. Routes accept BOTH a legacy `reviewer-finder` grant and a `reviewers` grant via variadic `requireAppAccess`. Lingering `user_app_access` grants for `reviewer-finder` remain live.
- **lastVerified:** 2026-06-26

## Review Manager

- **canonicalName:** Request Workbench (track/complete lanes)
- **legacyAliases:** Review Manager, `review-manager`
- **status:** legacy-live
- **ownerAppKey:** `reviewers`
- **successorKey:** `reviewers`
- **surfaceType:** route-namespace
- **currentPaths:** `/api/review-manager/*`
- **allowedUse:** Borrowed-live-infra. The `/api/review-manager/*` routes are live and owned by the Workbench. Reference them by path as-is.
- **forbiddenUse:** Do NOT rename the route path. Don't re-add `review-manager` to `APP_REGISTRY`.
- **migrationDecision:** LEAVE+DOCUMENT
- **notes:** Consolidated into the Workbench. Variadic grant accepts legacy `review-manager` AND `reviewers`.
- **lastVerified:** 2026-06-26

## candidates / Candidates

- **canonicalName:** Invite Reviewers
- **legacyAliases:** Candidates, candidate, `CandidatesPanel`, `my-candidates`
- **status:** ambiguous
- **ownerAppKey:** `reviewers`
- **successorKey:** —
- **surfaceType:** component
- **currentPaths:** `shared/components/reviewers/CandidatesPanel.js` (the Invite Reviewers tab); `/api/reviewer-finder/my-candidates`
- **allowedUse:** In NEW user-facing copy use "Invite Reviewers" for the tab. "Candidate" remains acceptable for an individual potential-reviewer record.
- **forbiddenUse:** Don't use "Candidates" as the tab title in new UI (the S290 header is already "Invite Reviewers"). Don't rename the `my-candidates` route path or the persisted preference keys.
- **migrationDecision:** RENAME (component/UI text only; planned Phase 2 — `CandidatesPanel.js` → an Invite-Reviewers name. Route path stays.)
- **notes:** Overloaded: the word refers to (a) potential-reviewer data records, (b) the "Invite Reviewers" tab UI (`CandidatesPanel`), and (c) the `my-candidates` route. Only the component/UI-text sense is safely renameable.
- **lastVerified:** 2026-06-26

## reviewer-suggestion

- **canonicalName:** Reviewer Suggestion (`wmkf_appreviewersuggestion`)
- **legacyAliases:** reviewer-suggestion, app reviewer suggestion
- **status:** canonical
- **ownerAppKey:** `reviewers`
- **successorKey:** —
- **surfaceType:** data-model
- **currentPaths:** Dataverse `wmkf_appreviewersuggestion` (entity set `wmkf_appreviewersuggestions`; adapter `lib/dataverse/adapters/reviewer-suggestion.js`) — see `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`
- **allowedUse:** The per-(reviewer, request) suggestion + outreach lifecycle record. Reviewer Finder writes here on save-candidates; Review Manager updates lifecycle here on send/receive/thank-you. Links `wmkf_potentialreviewer` → a request via alt-key `(wmkf_potentialreviewer, wmkf_request)`.
- **forbiddenUse:** Don't read "app" as "applicant" — it is the per-(reviewer, request) join, NOT an applicant-suggested reviewer. Don't conflate with `wmkf_potentialreviewers` (the broader pool it links to).
- **migrationDecision:** LEAVE+DOCUMENT
- **notes:** Included to disambiguate from "candidate"/"potential reviewer" and to correct the easy "applicant-suggested" misread of the `app` prefix. Data-model term, not an app.
- **lastVerified:** 2026-06-26

## Concept Evaluator

- **canonicalName:** Concept Evaluator (deprecated)
- **legacyAliases:** `concept-evaluator`
- **status:** deprecated
- **ownerAppKey:** —
- **successorKey:** — (no direct successor)
- **surfaceType:** app
- **currentPaths:** `_archived/pages/concept-evaluator.js` (+ archived API/prompt)
- **allowedUse:** Historical reference only.
- **forbiddenUse:** Don't re-add to `APP_REGISTRY`. Don't confuse with the active `multi-perspective-evaluator` app.
- **migrationDecision:** —
- **notes:** Deprecated 2026-04-25 (S110); concept-stage screening superseded, intake AI work moved to backend automation. Page/API/prompt archived. Existing `concept-evaluator` grants left in place (no app to grant). `multi-perspective-evaluator` reuses some prompt content but is a distinct active app, not the successor.
- **lastVerified:** 2026-06-26
</content>
</invoke>
