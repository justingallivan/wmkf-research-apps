/**
 * ReviewFormFields — renders the structured-review form by walking
 * `reviewFormSchema.fields`. Used by both the public landing page (token-auth)
 * and the staff Review Manager (session-auth) so the two paths can never
 * drift on what's collected or how it validates.
 *
 * Picklists render as <input type="radio"> so HTML enforces single-select —
 * the failure mode of reviewers ticking two boxes on the PDF form is exactly
 * what made these worth lifting out of the PDF.
 *
 * Intentionally uncontrolled (uses native form elements). The parent reads
 * values via FormData on submit; this keeps the component cheap to mount
 * and reusable in either an HTML <form> POST or a fetch-based submit.
 *
 * Rich-text questions (`type: 'richtext'`) are intentionally NOT rendered here:
 * they need a controlled WYSIWYG editor (RichReviewEditor) with autosave, which
 * the in-browser authoring surface owns. This legacy renderer stays scoped to
 * the string + picklist fields so the staff/landing upload surfaces are
 * unaffected by the new questions.
 */
import { reviewFormSchema } from '../../../lib/external/review-form-schema';

export default function ReviewFormFields({ initialValues = {}, disabled = false, idPrefix = 'rf' }) {
  return (
    <div className="space-y-6">
      {reviewFormSchema.fields.filter(field => field.type !== 'richtext').map(field => (
        <div key={field.key} className="space-y-2">
          <label
            htmlFor={`${idPrefix}-${field.key}`}
            className="block text-sm font-semibold text-gray-900"
          >
            {field.label}
            {field.required && <span className="text-red-600 ml-1">*</span>}
          </label>
          {field.hint && (
            <p className="text-xs text-gray-500">{field.hint}</p>
          )}
          {field.type === 'string' && (
            <input
              id={`${idPrefix}-${field.key}`}
              name={field.key}
              type="text"
              required={field.required}
              maxLength={field.maxLength}
              defaultValue={initialValues[field.key] ?? ''}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100"
            />
          )}
          {field.type === 'picklist' && (
            <fieldset className="space-y-2">
              <legend className="sr-only">{field.label}</legend>
              {field.options.map(option => {
                const id = `${idPrefix}-${field.key}-${option.value}`;
                return (
                  <div key={option.value} className="flex items-start gap-2">
                    <input
                      id={id}
                      name={field.key}
                      type="radio"
                      value={option.value}
                      required={field.required}
                      defaultChecked={initialValues[field.key] === option.value}
                      disabled={disabled}
                      className="mt-1"
                    />
                    <label htmlFor={id} className="text-sm text-gray-800">
                      {option.label}
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}
        </div>
      ))}
    </div>
  );
}
