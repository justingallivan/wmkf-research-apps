# Atlas: `review_drafts` (Postgres — operational scratchpad)

**Last verified:** 2026-06-28 (S301) — created by migration `021_review_drafts.sql` (reviewer in-browser authoring build, Phase 1). **[VERIFIED via `lib/db/migrations/021_review_drafts.sql`, `lib/services/review-draft-service.js`].**
**Live row count:** 0 (new table; no rows until the authoring UI ships in Phase 2 and reviewers begin autosaving). Migration not yet applied to the live database as of S301 — `node scripts/apply-migrations.js` is a deploy-time step.

## Source of truth

**Postgres-primary, but SCRATCHPAD only.** This table holds the in-progress autosave state for the external reviewer in-browser review form — one row per review, keyed by `suggestion_id` (the `wmkf_appreviewersuggestion` GUID). It is NOT the system of record for a submitted review: on final submit, the route maps the draft into the Dataverse `wmkf_appreviewanswer` snapshot child rows + the discrete rating columns on the parent `wmkf_appreviewersuggestion`, then deletes the draft. A reviewer's authoritative, point-in-time answers live in Dataverse (see [dataverse-wmkf-appreviewanswer.md](dataverse-wmkf-appreviewanswer.md)).

Same reasoning as `intake_drafts`: autosave fires many times per session, and Dataverse is the wrong store for high-frequency partial writes.

## Schema

| Column | Type | Notes |
|---|---|---|
| `id` | bigint (IDENTITY PK) | |
| `suggestion_id` | uuid NOT NULL **UNIQUE** | `wmkf_appreviewersuggestion` GUID; at most one active draft per review. The `ON CONFLICT (suggestion_id)` target for autosave upsert. |
| `draft_json` | jsonb NOT NULL DEFAULT `'{}'` | answers keyed by `review-form-schema` `field.key`: server-sanitized HTML for richtext answers, ints for picklist ratings. |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | touched on every autosave; drives GC. |

## Read / Write paths

- `lib/services/review-draft-service.js` — the only data-access layer:
  - `getBySuggestion(suggestionId)` — read the single draft (or null).
  - `upsertDraftJson({ suggestionId, draftJson })` — autosave (last-write-wins; touches `draft_json` + `updated_at`).
  - `deleteBySuggestion(suggestionId)` — after the submit changeset commits, and on staff token revoke/regenerate.
  - `deleteExpired({ olderThanDays })` — maintenance-cron GC (interval finalized in Phase 5).
- `pages/api/external/review/[token]/draft.js` — GET (rehydrate) / PUT (autosave). PUT sanitizes every rich-text answer via `lib/external/sanitize-review-html.js` BEFORE persisting (stored-XSS boundary), whitelists to schema keys, and gates writes on the engagement stage (`computeEngagementState`): 409 once submitted, 409 before materials are released.

## Lifecycle / gotchas

- **Finality is enforced in the ROUTE, not this layer.** The "refuse once submitted" check reads `wmkf_reviewreceivedat` from Dataverse; `ReviewDraftService` is pure Postgres and has no finality awareness.
- **Draft survives benign email resends, dies on revoke/regenerate** (the leak/compromise actions). Wired in Phase 5 into `revoke-token.js` + `regenerate-token.js`, NOT `mintAndStore` (which also runs on every benign resend). Drafts key on `suggestion_id`, stable across token regeneration.
- **Two-tab autosave is last-write-wins** — a single reviewer is the only writer and there is no async drain to corrupt, so no idempotency key.
