/**
 * Normalize one Busboy field for legacy review-upload routes.
 *
 * Scalar fields keep the historical strict-integer coercion. A field name
 * ending in `[]` is the multipart representation of a multiselect numeric
 * array; repeated values are accumulated under the base question key.
 */
export function addReviewMultipartField(fields, name, rawValue) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('addReviewMultipartField: fields object required');
  }
  if (typeof name !== 'string' || name.length === 0 || typeof rawValue !== 'string') {
    throw new TypeError('addReviewMultipartField: string name/value required');
  }

  const numeric = /^-?\d+$/.test(rawValue) ? Number(rawValue) : rawValue;
  if (!name.endsWith('[]')) {
    if (Array.isArray(fields[name])) {
      throw new TypeError(`addReviewMultipartField: "${name}" mixed scalar and array encodings`);
    }
    fields[name] = numeric;
    return fields;
  }

  const key = name.slice(0, -2);
  if (!key) throw new TypeError('addReviewMultipartField: array field key required');
  if (fields[key] === undefined) fields[key] = [];
  if (!Array.isArray(fields[key])) {
    throw new TypeError(`addReviewMultipartField: "${key}" mixed scalar and array encodings`);
  }
  fields[key].push(numeric);
  return fields;
}
