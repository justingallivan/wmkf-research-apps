import { isYmd } from '../../utils/date-ymd';

/**
 * Resolve the one due date used by renderer, sender, and lifecycle stamp.
 * A staff-supplied render setting preserves the existing override behavior;
 * otherwise the request column wins over the cycle default. Non-empty invalid
 * values fail closed instead of rendering/stamping an ambiguous date.
 */
export function resolveEffectiveReviewDueDate({
  requestedDueDate,
  requestDueDate,
  cycleDueDate,
} = {}) {
  const candidates = [
    ['settings', requestedDueDate],
    ['request', requestDueDate],
    ['cycle', cycleDueDate],
  ];
  for (const [source, raw] of candidates) {
    if (raw == null || raw === '') continue;
    const value = String(raw).trim();
    if (!isYmd(value)) {
      return { value: null, source, error: `${source} review due date is not a valid YYYY-MM-DD date` };
    }
    return { value, source, error: null };
  }
  return { value: null, source: 'none', error: null };
}
