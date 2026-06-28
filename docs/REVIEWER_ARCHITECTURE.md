# Reviewer Architecture — Mental Model

> **⚠ SUPERSEDED IN PART (S213, 2026-06-02): now TWO core tables, not three.** The `wmkf_appresearcher` bibliometric sidecar was collapsed onto `wmkf_potentialreviewers` and **dropped** — h-index/citations/affiliation/ORCID/Scholar now live directly on the person row, written by `adapters/researcher.js` (repointed to the person). Everywhere below shows a 1:1 `wmkf_appresearcher` sidecar; **read it as folded into `wmkf_potentialreviewers`**. The "Why three tables" rationale (avoid churning identity on metric refresh) didn't survive scrutiny — see `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md` and the "What changed" note in `docs/REVIEWER_DATA_MODEL.md`. The diagrams/steps below are kept as the historical 3-table mental model.

## The two Dataverse tables (live in prod — cutover W3–W6 complete 2026-05-12; S213 collapse complete)

```
wmkf_potentialreviewers     ← person identity + bibliometrics
        │                     (name/email, affiliation, h-index,
        │                     citations, ORCID, Scholar, etc.)
        │
        │ 1:N
        ▼
wmkf_appreviewersuggestion  ← one row per (person, request)
        │                     holds match score + full outreach
        │                     lifecycle (invited/accepted/declined/
        │                     materials sent/reminders/review
        │                     received/thank-you)
        │ N:1
        ▼
akoya_request               ← the proposal
```

Plus, when a potential reviewer is first invited:

```
wmkf_potentialreviewers ──── wmkf_contact ───► contact
                             (lookup, set on first outreach)
```

## Why two tables, not one

| Table | Purpose | Cadence |
|---|---|---|
| **potentialreviewers** | Canonical person — name, email, affiliation, expertise, why-chosen, plus bibliometrics. The de-dupe anchor. | Stable identity fields fill empty to preserve staff edits; metric refreshes overwrite bibliometric fields. |
| **appreviewersuggestion** | The *relationship* between a person and one specific proposal. Lifecycle ledger. | Per-proposal; one row per (person, request). |

The split exists so the same person can have an unbounded number of suggestion rows across cycles without duplicating their bio or lifecycle state. The former 1:1 bibliometric sidecar was collapsed in S213 because it added a join hop without a historical-snapshot requirement.

## Keys and relationships

- **Person identity de-dupe:** `wmkf_emailaddress` on `wmkf_potentialreviewers` (alt-key behavior — adapter `getByEmail` enforces).
- **Suggestion alt-key:** `(_wmkf_potentialreviewer_value, _wmkf_request_value)` on `wmkf_appreviewersuggestion`. Saving the same person again on the same proposal updates the existing row; saving them on a different proposal creates a new one.
- **Bibliometrics ↔ potentialreviewer:** h-index/citations/affiliation/ORCID/Scholar fields live directly on `wmkf_potentialreviewers` after S213.
- **Suggestion → request:** `_wmkf_request_value` → `akoya_request`.
- **Suggestion → person:** `_wmkf_potentialreviewer_value` → `wmkf_potentialreviewers`.
- **Promotion to CRM contact:** `wmkf_contact` lookup on `wmkf_potentialreviewers` (set when staff first reaches out — a potential reviewer becomes a real CRM contact at first invitation).

## How a reviewer flows through the system

1. **Discovery** — Reviewer Finder analyzes a proposal, queries external sources (Scholar/ORCID/PubMed/etc.), produces candidates with scores and bibliometrics.
2. **Save candidates** — for each candidate:
   - Upsert `wmkf_potentialreviewers` by email (creates or fills empty; writes bibliometrics onto the person).
   - Upsert `wmkf_appreviewersuggestion` on (person, request) with score/reason/sources, `selected=true`.
3. **Selection** — staff reviews candidates; `wmkf_selected` toggles on the suggestion row.
4. **Invitation** — Review Manager sends email; on first contact, person is promoted to CRM `contact` (link via `wmkf_contact`). Suggestion row's lifecycle fields populate: `wmkf_invited`, `wmkf_emailsentat`, `wmkf_responsereceivedat`, etc.
5. **Outreach lifecycle** — accept/decline, materials sent, reminders, review received, thank-you all timestamp on the suggestion row.

## Existing parallel: the `akoya_request` 5 slots

`akoya_request` itself has `wmkf_potentialreviewer1..5` lookup fields. These are an over-invite buffer (we need 3 confirmed; 5 slots cover declines). The suggestion ledger and the slots co-exist:

- The **slots** are AkoyaGO's native pattern — what staff sees on the request form.
- The **suggestion rows** are the system-of-record for the full lifecycle, including everyone who was *considered* (selected=false) plus declines plus reminder counts.

When a reviewer is "assigned" to a proposal, they appear in both: a slot lookup on the request, and a `selected=true` suggestion row.

## Same model across Postgres (now drain-only) and Dataverse (live source of truth, post-W6 2026-05-12)

The legacy Postgres schema (`researchers`, `reviewer_suggestions`, plus a flatter person concept) maps onto the same two-table shape. Wave 2 adapters are live in `/api/reviewer-finder/save-candidates` (writes to Dataverse `wmkf_potentialreviewer` and `wmkf_appreviewersuggestion`; bibliometrics are on the person after S213). `/my-candidates` is **Dataverse-backed** (W3-W6 / S164) — reads suggestions via `suggestionAdapter.findByPD()` and resolves grant-cycle data through `grant-cycles-dataverse`. The remaining Postgres reviewer tables are drain-only post-W6; per-row reconciliation status lives in `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`.
