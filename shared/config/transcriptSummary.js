/**
 * Site Visit summary acknowledgment (plan §6, §16). The card shows `text` and
 * sends `version`; the server refuses a Summarize request whose version is not
 * the current one, before any provider call, and stores the version on the
 * draft row. Changing the wording means a new version string.
 */
export const PRESENTATION_SUMMARY_ACKNOWLEDGMENT = Object.freeze({
  version: 'presentation-summary-2026-10-05',
  text: 'I confirm the presentation transcript, and the applicant slides if on file, may be sent to Anthropic, the LLM provider, to draft this summary. I will review the draft before it is published.',
});

// Bounds shared by the editor and the server.
export const SUMMARY_TEXT_MAX_CHARS = 100000;
