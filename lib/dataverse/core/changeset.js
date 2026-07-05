/**
 * DAL/core changeset helper — the single place application code composes a
 * Dataverse `$batch` changeset (atomic multi-operation write).
 *
 * It sits in front of `DynamicsService.executeChangeset` (the raw batch
 * transport, which accepts arbitrary POST/PATCH/DELETE operation URLs) so that
 * routes/services never hand raw operation URLs to the transport. Instead they
 * declare each operation as `{method, entitySet, key|keyPredicate, body, ifMatch}`;
 * this helper:
 *   1. validates EVERY `entitySet` through the entity-registry `entitySet()`
 *      (an unknown/guessed set THROWS — it is never forwarded as a raw URL), and
 *   2. builds the operation URL itself from the validated set plus a record `key`
 *      (GUID, wrapped as `set(key)`) or an alternate-key `keyPredicate` (wrapped
 *      as `set(<predicate>)`; the predicate's escaping/allowlist is the owning
 *      adapter's responsibility, e.g. review-answer.answerRowKeyPredicate).
 *
 * DELIBERATELY NOT HERE (Stage 7): restriction-context / fail-closed auth
 * enforcement. This wave only moves batch URL-building behind the DAL; adapters
 * and this helper still call the transport directly, exactly like the Wave-2
 * adapters. Stage 7 adds the trusted-context requirement to both.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from './entity-registry.js';

/**
 * Build the resource URL for one operation descriptor. Validates the entity set
 * (throws on an unknown set — the anti-guessing guarantee) and wraps the record
 * selector: a `keyPredicate` (alternate key) takes precedence over a `key`
 * (record GUID). The transport does NOT GUID-validate `key`, so callers pass a
 * server-sourced/validated id, exactly as the pre-DAL call sites did.
 *
 * @param {{entitySet:string, key?:string, keyPredicate?:string}} op
 * @returns {string} e.g. `wmkf_appreviewersuggestions(<guid>)` or
 *   `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<guid>,wmkf_questionkey='q2')`
 */
export function buildOperationUrl(op) {
  if (!op || typeof op !== 'object') {
    throw new Error('changeset.buildOperationUrl: operation descriptor required');
  }
  const set = entitySet(op.entitySet); // throws on unknown/guessed set
  if (op.keyPredicate != null && op.keyPredicate !== '') {
    return `${set}(${op.keyPredicate})`;
  }
  if (op.key != null && op.key !== '') {
    return `${set}(${op.key})`;
  }
  // Bare-collection POST creates a new record: the URL is the set itself
  // (mirrors the pre-DAL review-questions create ops). Only POST may omit a
  // selector — an unkeyed PATCH/DELETE would address the whole collection.
  if (op.method === 'POST') {
    return set;
  }
  throw new Error(
    `changeset.buildOperationUrl: operation for "${set}" requires a key or keyPredicate`,
  );
}

/**
 * Translate DAL operation descriptors into the transport's operation shape
 * (`{method, url, body, ifMatch}`), validating and building each URL. `ifMatch`
 * is carried through only when present (matching how the review submit sets it on
 * the parent PATCH alone).
 *
 * @param {Array<{method:'POST'|'PATCH'|'DELETE', entitySet:string, key?:string, keyPredicate?:string, body?:object, ifMatch?:string}>} operations
 * @returns {Array<{method:string, url:string, body?:object, ifMatch?:string}>}
 */
export function buildOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('changeset.buildOperations: operations must be a non-empty array');
  }
  return operations.map((op) => {
    const built = { method: op.method, url: buildOperationUrl(op) };
    if (op.body !== undefined) built.body = op.body;
    if (op.ifMatch !== undefined) built.ifMatch = op.ifMatch;
    return built;
  });
}

/**
 * Compose and execute a changeset. Builds/validates every operation URL, then
 * delegates to the atomic batch transport. Returns the transport result
 * unchanged (throws propagate — a throw means NOTHING committed, per the atomic
 * batch contract, so callers branch on `err.status === 412` exactly as with
 * DynamicsService.executeChangeset).
 *
 * @param {Array} operations - DAL operation descriptors (see buildOperations).
 * @param {{actingUserSystemId?:string}} [options] - MSCRMCallerID attribution
 *   for every op in the batch. Null/omitted for external-token flows.
 * @returns {Promise<{ok:true, operations:Array}>}
 */
export function runChangeset(operations, options = {}) {
  return DynamicsService.executeChangeset(buildOperations(operations), options);
}

/**
 * Atomic parent-with-children write shape: the children (e.g. answer-row
 * upserts) execute BEFORE the parent PATCH, matching the external-review submit /
 * staff-upload / mark-received-no-file call sites today (they push the answer
 * upserts first and the parent PATCH last into one changeset). The parent PATCH
 * typically carries an `ifMatch` row-version guard; the children upsert by
 * alternate key.
 *
 * Returns the ordered descriptor array — the caller runs it through
 * `runChangeset` (so a caller can still inspect/extend the array first, and the
 * entity-set validation happens once at execute time).
 *
 * @param {{parent:object, children?:Array<object>}} spec - `parent` and each
 *   `children[]` are DAL operation descriptors (see buildOperations).
 * @returns {Array<object>} `[...children, parent]`
 */
export function atomicParentWithChildren({ parent, children = [] } = {}) {
  if (!parent || typeof parent !== 'object') {
    throw new Error('changeset.atomicParentWithChildren: parent operation descriptor required');
  }
  if (!Array.isArray(children)) {
    throw new Error('changeset.atomicParentWithChildren: children must be an array');
  }
  return [...children, parent];
}
