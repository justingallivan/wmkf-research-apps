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
import {
  DOCUMENT_KIND_LABELS, RESOURCE_KIND_LABELS, RESOURCE_OUTCOME_LABELS, humanize,
} from '../../shared/config/testRequestFactory.js';
import {
  ATTENTION_COPY, BLIP_COPY, ERROR_COPY, attentionCopyFor, messageFor,
} from '../../shared/components/admin/test-request-factory-copy.js';
import { readFileSync } from 'node:fs';
import { LEDGER_REASON_CODES, LEDGER_RESOURCE_KINDS } from '../../lib/services/test-requests/run-ledger.js';
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
      "An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the command-line tool; it can't be done from this form.",
    );
  });

  test('artifact-exists and the Foundation setup codes have their copy', () => {
    expect(messageFor(apiError('factory_artifact_exists'))).toBe("The files for this run were already saved, but the run wasn't reserved, so this draft can't be confirmed again. Look up the source Request again. Nothing was created.");
    const foundation = "I couldn't confirm the Foundation's setup needed to clone this Request. This is usually a temporary blip. Please try again, and if the problem doesn't resolve, contact an administrator. Nothing was created.";
    expect(messageFor(apiError('test_request_foundation_unavailable', 'x', 503))).toBe(foundation);
    expect(messageFor(apiError('test_request_grant_type_unavailable', 'x', 503))).toBe(foundation);
  });

  test('an unknown code shows the server message; no code is the blip copy; an abort is empty', () => {
    expect(messageFor(apiError('something_new', 'Server says this.'))).toBe('Server says this.');
    expect(messageFor(apiError('something_new', ''))).toBe(BLIP_COPY);
    expect(messageFor(Object.assign(new Error('Request failed (500)'), { status: 500, payload: { error: 'The Test Request run could not be processed.' } }))).toBe(BLIP_COPY);
    expect(messageFor(new TypeError('Failed to fetch'))).toBe(BLIP_COPY);
    expect(messageFor(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('');
  });

  test('factory_invalid_input keeps the server message when there is one', () => {
    expect(messageFor(apiError('factory_invalid_input', 'A valid fiscal year and meeting date are required for this source.', 400))).toBe('A valid fiscal year and meeting date are required for this source.');
  });
});

describe('labels for the run record and the source summary', () => {
  test('DOCUMENT_KIND_LABELS equal the preview service document specs (keys and labels)', () => {
    const source = readFileSync(new URL('../../lib/services/test-requests/admin-preview-service.js', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const DOCUMENT_SPECS'), source.indexOf('function previewError'));
    const found = Object.fromEntries([...block.matchAll(/^\s{2}(\w+): Object\.freeze\(\{\s*\n\s*label: '([^']+)'/gm)].map((m) => [m[1], m[2]]));
    expect(found).toEqual({ ...DOCUMENT_KIND_LABELS });
  });

  test('every labelled resource kind is a ledger kind, and the outcomes equal the ledger set', () => {
    for (const kind of Object.keys(RESOURCE_KIND_LABELS)) expect(LEDGER_RESOURCE_KINDS).toContain(kind);
    const source = readFileSync(new URL('../../lib/services/test-requests/run-ledger.js', import.meta.url), 'utf8');
    const outcomes = /const RESOURCE_OUTCOMES = new Set\(\[([^\]]+)\]\)/.exec(source)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(Object.keys(RESOURCE_OUTCOME_LABELS).sort()).toEqual([...outcomes].sort());
  });

  test('humanize turns a code into sentence case', () => {
    expect(humanize('half_done_thing')).toBe('Half done thing');
    expect(humanize('')).toBe('');
  });

  test('every needs-attention reason with its own copy is a real ledger reason code; others get the default', () => {
    for (const code of Object.keys(ATTENTION_COPY)) expect(LEDGER_REASON_CODES).toContain(code);
    const fallback = attentionCopyFor('file_copy_failed');
    expect(fallback).toBe('This step stopped. Retrying never creates a second Request: the run checks where it stands first and, if nothing had been written, does the step again. If it keeps stopping here, find the cause in the technical detail or the function log and clear it before retrying again.');
    expect(attentionCopyFor(null)).toBe(fallback);
    expect(attentionCopyFor('timeout (http 504)')).toBe(ATTENTION_COPY.timeout);
  });

  test('no stop claims the command-line tool resolves a run; a dead end says so and names the way out', () => {
    // No mode of scripts/rehearse-test-request-sandbox.mjs abandons, resets or force-advances a run; `--run-inspect` only reads.
    const cannotContinue = ['ambiguous_create_outcome', 'file_journal_unverified', 'file_ambiguous_unrecovered', 'location_readback_mismatch', 'bundle_stale'];
    for (const code of cannotContinue) {
      const text = attentionCopyFor(code);
      expect(text).toMatch(/can't continue/);
      expect(text).toMatch(/Start a new run from a fresh lookup\./);
    }
    // The default covers retryable stops (file_copy_failed before upload, upstream_http, unknown_error): it never declares the run finished.
    for (const code of ['file_copy_failed', 'upstream_http', 'unknown_error']) expect(attentionCopyFor(code)).not.toMatch(/can't continue|Start a new run/);
    // provision_location re-reads on retry and records a late, owned location as recovered (run-runner.js stepProvisionLocation).
    expect(attentionCopyFor('location_readback_mismatch')).toMatch(/If the record appears and is this run's, the run continues/);
    for (const text of Object.values(ATTENTION_COPY)) expect(text).not.toMatch(/resolv\w* (?:by hand )?with the command-line tool/i);
  });

  test('timeout and network say a retry re-checks first and may stop under a different reason; bundle_stale and meeting_date_patch_failed have their own copy', () => {
    for (const code of ['timeout', 'network']) {
      expect(attentionCopyFor(code)).toMatch(/checks where the run stands first/);
      expect(attentionCopyFor(code)).toMatch(/may stop again under a different reason/);
      expect(attentionCopyFor(code)).not.toMatch(/picks the run up where it stopped/);
    }
    expect(attentionCopyFor('bundle_stale')).toMatch(/too old, or the copy rules changed/);
    expect(attentionCopyFor('meeting_date_patch_failed')).toMatch(/sends the correction once more/);
    expect(attentionCopyFor('meeting_date_patch_failed')).not.toBe(attentionCopyFor('file_copy_failed'));
  });
});

describe('needs-attention copy refinements', () => {
  test('check-failed codes share one honest line; the readback mismatch is the unconfirmed line; the source fence line says what may have happened', () => {
    const failed = 'A check on this step failed, and retrying will most likely stop here again. Nothing further was written. Inspect the run with the command-line tool.';
    for (const code of ['preflight_identity_changed', 'meeting_date_readback_mismatch', 'request_readback_mismatch', 'verification_failed', 'observation_side_effects', 'manifest_digest_mismatch']) {
      expect(attentionCopyFor(code)).toBe(failed);
    }
    expect(attentionCopyFor('file_ambiguous_unrecovered')).toBe(attentionCopyFor('file_journal_unverified'));
    expect(attentionCopyFor('source_fence_failed')).toBe("The run couldn't confirm the source Request is unchanged: either it changed, or it couldn't be read. Nothing was created. Retry; if it stops here again, look up the source Request again and start a new run.");
  });

  test('no needs-attention or error copy points at "the owner", and the blip copy is verbatim', () => {
    const texts = [...Object.values(ATTENTION_COPY), ...Object.values(ERROR_COPY).map((entry) => (typeof entry === 'function' ? entry('') : entry))];
    for (const text of texts) expect(text).not.toMatch(/\bowner\b/i);
    expect(BLIP_COPY).toBe("I'm having trouble reaching the server. This is usually a temporary blip. Please try again, and if the problem doesn't resolve, contact an administrator.");
  });
});
