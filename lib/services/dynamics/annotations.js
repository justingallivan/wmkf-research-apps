/**
 * DynamicsService decomposition — Stage 3 leaf module (Checkpoint A).
 *
 * Moved verbatim from lib/services/dynamics-service.js: `processAnnotations`
 * (was a static method; pure — uses no `this`, no external deps). The facade
 * keeps a thin `processAnnotations` delegating wrapper so internal `this.` and
 * external `DynamicsService.` calls are unchanged.
 */

/**
 * Process OData annotation values in a record.
 * Annotations like `_fieldid_value@OData.Community.Display.V1.FormattedValue`
 * become `_fieldid_value_formatted`.
 */
export function processAnnotations(record) {
  if (!record || typeof record !== 'object') return record;

  const processed = {};
  const annotationSuffix = '@OData.Community.Display.V1.FormattedValue';
  const msAnnotationSuffix = '@Microsoft.Dynamics.CRM.lookuplogicalname';

  for (const [key, value] of Object.entries(record)) {
    // Preserve @odata.etag as _etag for optimistic-concurrency callers
    // (If-Match on PATCH). All other @odata / @Microsoft annotations are stripped.
    if (key === '@odata.etag') {
      processed._etag = value;
      continue;
    }
    if (key.startsWith('@odata') || key.startsWith('@Microsoft')) continue;

    if (key.endsWith(annotationSuffix)) {
      const baseKey = key.replace(annotationSuffix, '');
      processed[`${baseKey}_formatted`] = value;
    } else if (key.endsWith(msAnnotationSuffix)) {
      const baseKey = key.replace(msAnnotationSuffix, '');
      processed[`${baseKey}_entity`] = value;
    } else {
      processed[key] = value;
    }
  }

  return processed;
}
