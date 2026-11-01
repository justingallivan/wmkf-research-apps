# Email terminology change: preservation audit (2026-11-01)

## Scope and evidence boundary

This is a source/Git and mock-test audit of the bounded terminology changes on
`codex/email-template-terminology` as of 2026-11-01. It covers deliberation
packet-sharing and agenda copy, applicant presentation-material invitation and
reminder copy, their Admin metadata and UI preview labels, and the fixed outgoing
materials upload CTA. It does not verify deployed configuration, actual stored
Dataverse values, personal overrides, or sent mail. No email-default seed,
rebaseline, or database-write command was invoked for this audit. The source
branch status is not a deployment receipt.

## Preservation evidence

| Invariant | Source and test evidence | Finding / limit |
|---|---|---|
| Existing Admin and personal settings are not rewritten by the terminology edits. | The changes update code fallback/seed strings and `editableTextDefaults` display metadata; the settings readers/writers and preference keys are unchanged. See `shared/config/deliberationShareEmail.js`, `shared/config/editableTextDefaults.js`, `lib/seed/email-defaults/{deliberation-agenda,site-visit-materials}.js`, `lib/services/pre-site-visit/distribution-personalization.js`, and the relevant unit tests. | Verified by source diff and mock tests only. Actual deployed values and personal overrides are unknown. No automatic backfill is part of this change. |
| Runtime fallback and initialization seed semantics remain distinct. | `shared/config/deliberationShareEmail.js:1-4,15-23` supplies a runtime fallback for packet-sharing; `lib/seed/email-defaults/deliberation-agenda.js:6-11` and `lib/seed/email-defaults/site-visit-materials.js:1-21` are initialization seed text. `scripts/seed-email-defaults.mjs:132-183` reads configured values and, in execute mode, writes only keys it considers unconfigured. | Agenda/materials seed text is not a runtime fallback. Seeder is a read-then-write flow; source inspection does not prove protection against a concurrent writer. Existing nonblank values are skipped by its normal path, but blank values may be initialized. No seed command was run. |
| Admin and personal preference identity/contracts are preserved. | `shared/config/editableTextDefaults.js` keeps setting keys, groups, and placeholder contracts while changing the scoped labels/descriptions. Preference keys and settings readers/writers are unchanged in the source diff. | Source/Git evidence only; no live settings inspection. |
| Previously prepared packet-sharing and agenda content retains exact send identity. | `lib/services/meeting-tracker/agenda-service.js:396-406` still matches prepared subject, body text/HTML, session, snapshot tuple, sender, actor, and recipients. `tests/unit/meeting-tracker-agenda-service.test.js` covers frozen prepared content and legacy prepared snapshots. The packet-sharing prepared-send identity/snapshot contract is covered by `tests/unit/pre-site-distribution-service.test.js`; the terminology diff changes rendered labels, not identity comparison fields. | This establishes source/test behavior, not the contents of any persisted or sent row. It is specific to packet-sharing and agenda prepared attempts; it is not a claim that every email family freezes all rendered wrapper HTML. |
| Agenda freshness remains compatible with earlier previews. | `computeAgenda` retains the legacy `sessionLine`; `agendaSnapshotComparisonTuple` is unchanged. `renderedSessionLine` changes the generated label only inside fresh `renderAgendaEmail` output. The legacy snapshot test confirms `agendaScheduleChanged` stays false when the schedule has not changed. | No snapshot migration or re-render of a frozen send is introduced. |
| Presentation-materials caller wording does not rewrite sender copy. | `lib/seed/email-defaults/site-visit-materials.js:1-21` changes default invitation/reminder seed copy. The collection invitation source changes one fixed outgoing CTA label to “Upload presentation materials.” The Admin/personal settings writers are unchanged. | The CTA is application-owned outgoing text, not user-editable body text. The materials preview digest binds subject/body; the CTA wrapper is not part of the returned preview body. No claim is made that the preview contains this CTA. Existing settings were not written. |
| Stable integration contracts and tokens remain unchanged. | Source diff preserves setting IDs (`email.deliberation_share.*`, `email.deliberation_agenda.*`, `email.site_visit_materials_{invite,reminder}.*`), personal preference IDs, routes, and placeholders such as `{{requestNumber}}`, `{{sessionDate}}`, `{{checklist}}`, and `{{missingItems}}`. | Verified by source diff and scoped mock tests. No schema/API migration or automatic backfill is included. |

The focused catalogue and Admin-section unit tests previously passed on this
source state. Unit tests use mocks; they do not establish live Dataverse values,
deployment state, or behavior under concurrent seed execution. Review current
test receipts and release status in Git/PR before relying on this audit as a
release verification.

## Canonical status pointers

- [Approved vocabulary and current implementation boundary](../NOMENCLATURE_GLOSSARY.md#deliberations-workflow-vocabulary--approved-names)
- [Current work queue entry](../CURRENT_WORK_QUEUE.md)
- [Session chronology memory](../../.claude-memory/project-deliberation-session-precedes-site-visit.md)

PR #581 (`8c0859a6f`) records the Board-reader terminology slice merged in
source/Git only; it is separate from this email-copy work. As of 2026-11-01, the
email terminology source changes are on `codex/email-template-terminology`.
Check Git/PR and release receipts for subsequent merge or deployment status.
