/**
 * ServiceHttpError — campaign-wide typed error for the Route→Service
 * Consolidation Plan (Decision 3: services throw domain errors carrying
 * enough for the route shell to map to HTTP; shape finalized in the Stage 1
 * pilot, generalized after the P1 retrospective).
 *
 * Shell mapping template:
 *   if (e instanceof ServiceHttpError) {
 *     return res.status(e.httpStatus).json(e.body ?? { error: e.message });
 *   }
 *   // unknown errors → the route's existing 500 envelope
 *
 * `body` exists because not every route speaks `{ error }` — e.g.
 * external/review/[token]/respond.js sends `{ ok: false, reason }` and
 * admin/review-questions.js sends `{ status, errors/currentVersion }`.
 * Domain subclasses set `body` to the exact JSON their shell must send;
 * when absent, shells default to `{ error: message }`.
 *
 * Dependency-free on purpose — importable from any service or shell.
 */

export class ServiceHttpError extends Error {
  /**
   * @param {string} message - human-readable; doubles as the default envelope's `error`
   * @param {Object} options
   * @param {number} options.httpStatus - required HTTP status the shell sends
   * @param {Object} [options.body] - exact JSON body the shell should send
   *   (omit to let the shell default to `{ error: message }`)
   * @param {string} [options.code] - optional machine-readable error code
   */
  constructor(message, { httpStatus, body, code } = {}) {
    super(message);
    if (typeof httpStatus !== 'number') {
      throw new TypeError('ServiceHttpError: httpStatus (number) is required');
    }
    this.name = 'ServiceHttpError';
    this.httpStatus = httpStatus;
    this.body = body;
    this.code = code;
  }
}
