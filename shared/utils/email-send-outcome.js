/**
 * Shared email-send outcome vocabulary.
 *
 * `sent` means the transport request was accepted. It never claims inbox
 * delivery. `failed` is reserved for a provable non-send; an error raised
 * during the Dynamics SendEmail request is `uncertain` unless the caller can
 * reconcile the email activity to an accepted status.
 */

export const EMAIL_SEND_OUTCOME = Object.freeze({
  SENT: 'sent',
  DRAFT: 'draft',
  FAILED: 'failed',
  UNCERTAIN: 'uncertain',
  PARTIAL: 'partial',
  INFO: 'info',
});

export const EMAIL_SEND_OUTCOME_COPY = Object.freeze({
  [EMAIL_SEND_OUTCOME.SENT]: Object.freeze({
    title: 'Sent for delivery.',
    message: 'Dynamics accepted the email for delivery.',
  }),
  [EMAIL_SEND_OUTCOME.DRAFT]: Object.freeze({
    title: 'Draft created.',
    message: 'The email was saved in Dynamics and was not sent.',
  }),
  [EMAIL_SEND_OUTCOME.FAILED]: Object.freeze({
    title: 'Not sent.',
    message: 'The email could not be sent. Review the reason below and try again.',
  }),
  [EMAIL_SEND_OUTCOME.UNCERTAIN]: Object.freeze({
    title: 'Send status is uncertain.',
    message: 'Check the email history before trying again.',
  }),
  [EMAIL_SEND_OUTCOME.PARTIAL]: Object.freeze({
    title: 'Some emails need attention.',
    message: 'Review the named recipients below before trying again.',
  }),
  [EMAIL_SEND_OUTCOME.INFO]: Object.freeze({
    title: 'Email status',
    message: '',
  }),
});

/**
 * Classify a createAndSendEmail failure without guessing whether a SendEmail
 * POST reached Dynamics. Callers may promote `uncertain` to `sent` only after
 * reconciling the persisted email activity.
 */
export function classifyEmailDispatchError(error) {
  const definitelyNotSent = error?.dispatched === false;
  return {
    outcome: definitelyNotSent ? EMAIL_SEND_OUTCOME.FAILED : EMAIL_SEND_OUTCOME.UNCERTAIN,
    retryable: definitelyNotSent,
    emailId: typeof error?.emailId === 'string' && error.emailId ? error.emailId : null,
  };
}

export function isEmailSendOutcome(value) {
  return Object.values(EMAIL_SEND_OUTCOME).includes(value);
}
