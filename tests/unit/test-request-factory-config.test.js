/**
 * The browser-safe factory config and copy must stay in step with the server
 * modules they mirror (a component may not import those).
 *
 * @jest-environment node
 */
import { STEP_ORDER } from '../../lib/services/test-requests/run-runner.js';
import { TEST_REQUEST_PREVIEW_READ_LIMITS } from '../../lib/services/test-requests/admin-preview-service.js';
import {
  ADVANCE_LABELS, BASIC_STEPS, RUN_STATUSES, SIZE_LIMITS, STATUS_FIELDS,
} from '../../shared/config/testRequestFactory.js';
import { BLIP_COPY, ERROR_COPY, messageFor } from '../../shared/components/admin/test-request-factory-copy.js';
import { STATUS_FIELDS as SERVER_STATUS_FIELDS } from '../../lib/services/test-requests/status-transitions.js';

const apiError = (code, message = 'server text', status = 409) => Object.assign(new Error(message), { status, payload: { code, error: message } });

describe('factory config parity', () => {
  test('BASIC_STEPS keys equal the runner STEP_ORDER, in order', () => {
    expect(BASIC_STEPS.map((step) => step.key)).toEqual([...STEP_ORDER]);
    expect(BASIC_STEPS.every((step) => step.label.length > 0)).toBe(true);
  });

  test('SIZE_LIMITS equal TEST_REQUEST_PREVIEW_READ_LIMITS', () => {
    expect(SIZE_LIMITS.maxFiles).toBe(TEST_REQUEST_PREVIEW_READ_LIMITS.maxFiles);
    expect(SIZE_LIMITS.maxFileMb * 1024 * 1024).toBe(TEST_REQUEST_PREVIEW_READ_LIMITS.maxFileBytes);
    expect(SIZE_LIMITS.maxTotalMb * 1024 * 1024).toBe(TEST_REQUEST_PREVIEW_READ_LIMITS.maxTotalBytes);
  });

  test('the size copy states the limits from the config', () => {
    for (const code of ['test_request_preview_file_too_large', 'test_request_preview_total_size_exceeded', 'test_request_preview_file_count_exceeded']) {
      expect(messageFor(apiError(code))).toBe(
        `This Request's documents are too large to clone here (limit ${SIZE_LIMITS.maxFileMb} MB per file, ${SIZE_LIMITS.maxTotalMb} MB in total, ${SIZE_LIMITS.maxFiles} files). Choose a smaller source Request. Nothing was created.`,
      );
    }
  });

  test('status field columns equal the server STATUS_FIELDS', () => {
    expect(Object.fromEntries(STATUS_FIELDS.map((field) => [field.key, field.column]))).toEqual({ ...SERVER_STATUS_FIELDS });
  });

  test('resumable labels are exactly the service RESUMABLE statuses; every run status has words', () => {
    expect(Object.keys(ADVANCE_LABELS).sort()).toEqual(['creating', 'needs_attention', 'prepared']);
    expect(Object.keys(RUN_STATUSES).sort()).toEqual(['creating', 'needs_attention', 'prepared', 'ready', 'retired', 'retiring']);
  });
});

describe('messageFor', () => {
  test('every route-reachable code has copy that is never the bare code', () => {
    for (const [code, entry] of Object.entries(ERROR_COPY)) {
      const text = typeof entry === 'function' ? entry('') : entry;
      expect(text).toBeTruthy();
      expect(text).not.toBe(code);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  test('the codes in the brief map to the brief copy', () => {
    expect(messageFor(apiError('factory_deadline_exceeded', 'x', 504))).toBe("There wasn't enough time left to start that safely, so nothing was started. Try again.");
    expect(messageFor(apiError('factory_source_not_found', 'x', 404))).toBe('No Request has that number. Check the number and try again.');
    expect(messageFor(apiError('status_change_replay'))).toBe(
      "An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the owner; it can't be done from this form.",
    );
  });

  test('an unknown code shows the server message; no code is the blip copy; an abort is empty', () => {
    expect(messageFor(apiError('something_new', 'Server says this.'))).toBe('Server says this.');
    expect(messageFor(apiError('something_new', ''))).toBe(BLIP_COPY);
    expect(messageFor(Object.assign(new Error('Request failed (500)'), { status: 500, payload: { error: 'The Test Request run could not be processed.' } }))).toBe(BLIP_COPY);
    expect(messageFor(new TypeError('Failed to fetch'))).toBe(BLIP_COPY);
    expect(messageFor(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('');
  });

  test('factory_invalid_input keeps the server message when there is one', () => {
    expect(messageFor(apiError('factory_invalid_input', 'A fiscal year and a meeting date are required for this source.', 400))).toBe('A fiscal year and a meeting date are required for this source.');
  });
});
