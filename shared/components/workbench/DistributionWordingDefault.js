import { Button } from '../Layout';

/** View only: request, mutation and dirty state belong to the retained panel. */
export default function DistributionWordingDefault({ open, onOpen, template, onChange, data, busy, blocked, message, onSave, onClear, onReload }) {
  return <details className="mt-4 border-t border-gray-200 pt-3" open={open} onToggle={event => onOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium text-gray-800">Your default wording</summary>
    <p className="mt-2 text-sm text-gray-600">Used for future emails. The current email is unchanged. Use {'{{requestNumber}}'} in the default subject only.</p>
    <label className="mt-3 block text-sm font-medium text-gray-800" htmlFor="distribution-default-subject">Default subject</label>
    <input id="distribution-default-subject" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={template.subject} disabled={busy || blocked} maxLength={500} onChange={event => onChange({ ...template, subject: event.target.value })} />
    <label className="mt-3 block text-sm font-medium text-gray-800" htmlFor="distribution-default-message">Default message</label>
    <textarea id="distribution-default-message" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={5} value={template.body} disabled={busy || blocked} maxLength={20000} onChange={event => onChange({ ...template, body: event.target.value })} />
    {message && <p className="mt-2 text-sm text-gray-800" role="status">{message}</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      <Button type="button" variant="secondary" size="sm" disabled={busy || blocked || !data?.canSave} onClick={onSave}>Save as my default</Button>
      <Button type="button" variant="secondary" size="sm" disabled={busy || blocked || !data?.canClear} onClick={onClear}>Clear my default</Button>
      <Button type="button" variant="link" size="sm" disabled={busy} onClick={onReload}>Reload defaults</Button>
    </div>
  </details>;
}
