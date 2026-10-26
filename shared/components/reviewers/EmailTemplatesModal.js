/** Personal reviewer wording maintenance; stores existing field-level overrides. */
import { useState } from 'react';
import EmailDialog from '../EmailDialog';
import { Button } from '../Layout';
import LegacyWordingDefault from './LegacyWordingDefault';
export default function EmailTemplatesModal({ onClose }) {
  const [type, setType] = useState('invitation');
  const [busy, setBusy] = useState(false);
  return <EmailDialog label="Your email defaults" busy={busy} onClose={onClose}>
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-semibold">Your email defaults</h2><Button variant="link" size="sm" disabled={busy} onClick={onClose}>Close</Button></div>
        <div className="my-4 flex flex-wrap gap-2" aria-label="Active email templates">
          <Button variant={type === 'invitation' ? 'primary' : 'outline'} disabled={busy} onClick={() => setType('invitation')}>Invitation</Button>
          <Button variant={type === 'materials' ? 'primary' : 'outline'} disabled={busy} onClick={() => setType('materials')}>Materials (post-accept)</Button>
        </div>
        <details className="mb-4 rounded border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium">Legacy templates</summary>
          <p className="mt-2 text-sm text-gray-600">Retained for compatibility. Current staff send actions do not use Follow-up reminder or Thank-you. Automatic reviewer thank-yous use a separate setting in Profile Settings → Reviewer Emails; this legacy tab does not control them.</p>
          <div className="mt-3 flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setType('followup')}>Follow-up reminder</Button><Button variant="outline" disabled={busy} onClick={() => setType('thankyou')}>Thank-you</Button></div>
        </details>
        <p className="mb-3 text-sm text-gray-600">Editing {({ invitation: 'Invitation', materials: 'Materials (post-accept)', followup: 'Legacy follow-up reminder', thankyou: 'Legacy thank-you' })[type]}. Changes apply to future emails only.</p>
        <LegacyWordingDefault key={type} type={type} initialOpen onBusyChange={setBusy} hint="Supported placeholders include {{greeting}}, {{proposalTitle}}, {{piInstitution}}, {{externalLink}}, {{reviewDueDate}} and {{signature}}. Invitation wording must retain {{externalLink}}; timeline values are entered when sending." />
      </section>
    </div>
  </EmailDialog>;
}
