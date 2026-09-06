/**
 * Reviewer engagement — shared domain error (Reviewer Lifecycle Stage 3D
 * correction round). `MyCandidatesError` moved here as a neutral leaf owner
 * so `lib/services/reviewer-finder/my-candidates-service.js` can import just
 * the class — for its non-correction throws — without pulling in
 * `correct-response.js`'s adapters and token-lifecycle dependencies.
 * `correct-response.js` imports it from here too (its `correctionError`
 * helper constructs it). Dependency-free apart from `ServiceHttpError`.
 */

import { ServiceHttpError } from '../service-http-error';

/**
 * Domain error; `body` set explicitly where the historical envelope carries
 * more than `{ error }` (rejected-fields 400, duplicate-key 409, sanitized
 * proposals-mode 500).
 */
export class MyCandidatesError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'MyCandidatesError';
  }
}
