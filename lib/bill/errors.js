/**
 * BILL.com API error class hierarchy.
 *
 * Public callers handle four subclasses:
 *   - BillAuthError       (BDC_1101/1102 — dev key or credentials wrong)
 *   - BillRateLimitError  (BDC_1144 — hourly quota exhausted; do NOT retry)
 *   - BillValidationError (4xx client errors — caller-fixable input)
 *   - BillServerError     (5xx — transient BILL-side outage)
 *
 * BillSessionError (BDC_1109) is internal-only: the wrapper catches it,
 * reauths, and retries the original call once. Callers never see it.
 */

import { redactString } from './redact.js';

const TRUNCATE = 500;

export class BillError extends Error {
  /**
   * @param {string} message
   * @param {Object} opts
   * @param {number|null} [opts.status]   - HTTP status (null for network errors)
   * @param {string[]} [opts.codes]       - BDC codes parsed from body
   * @param {string} [opts.response]      - raw body excerpt (will be truncated + redacted)
   */
  constructor(message, { status = null, codes = [], response = '' } = {}) {
    super(redactString(message));
    this.name = 'BillError';
    this.status = status;
    this.codes = Array.isArray(codes) ? codes : [];
    this.response = redactString(String(response)).slice(0, TRUNCATE);
  }
}

export class BillAuthError extends BillError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'BillAuthError';
  }
}

export class BillRateLimitError extends BillError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'BillRateLimitError';
  }
}

export class BillValidationError extends BillError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'BillValidationError';
  }
}

export class BillServerError extends BillError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'BillServerError';
  }
}

/** @internal — never thrown to callers; caught by the wrapper's retry path */
export class BillSessionError extends BillError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'BillSessionError';
  }
}
