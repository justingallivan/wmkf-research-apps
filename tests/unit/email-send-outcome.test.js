import {
  EMAIL_SEND_OUTCOME,
  classifyEmailDispatchError,
  isEmailSendOutcome,
} from '../../shared/utils/email-send-outcome';

describe('email send outcome contract', () => {
  test('a pre-dispatch failure is a definite, retryable non-send', () => {
    expect(classifyEmailDispatchError(Object.assign(new Error('create failed'), {
      dispatched: false,
    }))).toEqual({
      outcome: EMAIL_SEND_OUTCOME.FAILED,
      retryable: true,
      emailId: null,
    });
  });

  test('a SendEmail-stage failure remains uncertain and retains its activity id', () => {
    expect(classifyEmailDispatchError(Object.assign(new Error('response lost'), {
      emailId: 'mail-1',
    }))).toEqual({
      outcome: EMAIL_SEND_OUTCOME.UNCERTAIN,
      retryable: false,
      emailId: 'mail-1',
    });
  });

  test('unknown and non-Error throws fail closed to uncertain', () => {
    expect(classifyEmailDispatchError(undefined).outcome).toBe(EMAIL_SEND_OUTCOME.UNCERTAIN);
    expect(classifyEmailDispatchError('failure').retryable).toBe(false);
  });

  test('the outcome vocabulary rejects unhandled values', () => {
    expect(isEmailSendOutcome(EMAIL_SEND_OUTCOME.PARTIAL)).toBe(true);
    expect(isEmailSendOutcome('delivered')).toBe(false);
    expect(isEmailSendOutcome(null)).toBe(false);
  });
});
