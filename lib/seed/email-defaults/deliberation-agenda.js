/**
 * Seed copy for the deliberation-session agenda email's admin-editable
 * subject and opening message (Meeting Tracker session page, "Agenda email"
 * card).
 *
 * This file is the SINGLE source of the shipped default text. It is written
 * into Dataverse `wmkf_appsystemsetting` once by `scripts/seed-email-defaults.mjs`
 * — it is init data, NOT a runtime fallback. A blank/unavailable admin value
 * renders blank in the composer; the staff user sees it and types (see
 * shared/config/editableTextDefaults.js and
 * lib/services/meeting-tracker/agenda-service.js).
 *
 * {{sessionDate}} is resolved server-side by `resolveAgendaDefault` in
 * agenda-service.js from the session's scheduled start and time zone (e.g.
 * "Friday, September 11"). The agenda block (session details plus
 * per-proposal lines) is rendered separately and is not part of this seed
 * text.
 */

export const DELIBERATION_AGENDA_SEED_SUBJECT = 'Deliberation session agenda — {{sessionDate}}';

export const DELIBERATION_AGENDA_SEED_BODY = "Here is the agenda for our deliberation session. Each proposal's briefing page opens without a login.";
