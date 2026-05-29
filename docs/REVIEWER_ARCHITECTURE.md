# Reviewer Architecture — Mental Model

## The three Dataverse tables (live in prod — cutover W3–W6 complete 2026-05-12)

```
wmkf_potentialreviewers     ← person identity (one row per real human)
        │
        │ 1:1 ─────────────────────► wmkf_appresearcher
        │                              (bibliometric sidecar:
        │                               h-index, citations,
        │                               ORCID, Scholar, etc.)
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

## Why three tables, not one

| Table | Purpose | Cadence |
|---|---|---|
| **potentialreviewers** | Canonical person — name, email, affiliation, expertise, why-chosen. The de-dupe anchor. | Stable; only fills empty fields on re-import to preserve staff edits. |
| **appresearcher** | Bibliometric/discovery metadata. Snapshot data that *changes over time*. | Refreshes overwrite metric fields (h-index, citations); other fields fill-empty. |
| **appreviewersuggestion** | The *relationship* between a person and one specific proposal. Lifecycle ledger. | Per-proposal; one row per (person, request). |

The split exists so updating someone's h-index doesn't churn their identity row, and so the same person can have an unbounded number of suggestion rows across cycles without duplicating their bio.

## Keys and relationships

- **Person identity de-dupe:** `wmkf_emailaddress` on `wmkf_potentialreviewers` (alt-key behavior — adapter `getByEmail` enforces).
- **Suggestion alt-key:** `(_wmkf_potentialreviewer_value, _wmkf_request_value)` on `wmkf_appreviewersuggestion`. Saving the same person again on the same proposal updates the existing row; saving them on a different proposal creates a new one.
- **Researcher ↔ potentialreviewer:** 1:1 via `_wmkf_potentialreviewer_value` on `wmkf_appresearcher`.
- **Suggestion → request:** `_wmkf_request_value` → `akoya_request`.
- **Suggestion → person:** `_wmkf_potentialreviewer_value` → `wmkf_potentialreviewers`.
- **Promotion to CRM contact:** `wmkf_contact` lookup on `wmkf_potentialreviewers` (set when staff first reaches out — a potential reviewer becomes a real CRM contact at first invitation).

## How a reviewer flows through the system

1. **Discovery** — Reviewer Finder analyzes a proposal, queries external sources (Scholar/ORCID/PubMed/etc.), produces candidates with scores and bibliometrics.
2. **Save candidates** — for each candidate:
   - Upsert `wmkf_potentialreviewers` by email (creates or fills empty).
   - Upsert `wmkf_appresearcher` 1:1 with metrics overwrite.
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

The legacy Postgres schema (`researchers`, `reviewer_suggestions`, plus a flatter person concept) maps onto the same three-table shape. Wave 2 adapters are live in `/api/reviewer-finder/save-candidates` (writes to Dataverse `wmkf_potentialreviewer`, `wmkf_appresearcher`, `wmkf_appreviewersuggestion`). `/my-candidates` is **Dataverse-backed** (W3-W6 / S164) — reads suggestions via `suggestionAdapter.findByPD()` and resolves grant-cycle data through `grant-cycles-dataverse`. The remaining Postgres reviewer tables are drain-only post-W6; per-row reconciliation status lives in `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`.
