/**
 * Ownership: view module: renders contact modals; controller owns state and contact hooks own commands.
 */
import CandidateEditModal from '../CandidateEditModal';
import { getCandidateEmailReadiness } from '../reviewer-search-logic';

export default function SearchContactModals({
  editingContact,
  confirmingContact,
  persistManualContact,
  verifyAddressContact,
  setEditingContact,
  confirmIdentityContact,
  setConfirmingContact,
}) {
  return (
    <>
      {editingContact && (
        <CandidateEditModal
          candidate={editingContact}
          nameEditable={false}
          onApply={(updates) => persistManualContact(editingContact, updates)}
          onVerifyAddress={(updates, evidence) => verifyAddressContact(editingContact, updates, evidence)}
          requireAddressVerification={getCandidateEmailReadiness(editingContact).action !== 'ready'}
          onClose={() => setEditingContact(null)}
        />
      )}
      {confirmingContact && (
        <CandidateEditModal
          candidate={confirmingContact}
          nameEditable={false}
          confirmMode
          onVerifyAddress={() => {}}
          requireAddressVerification
          onConfirm={(updates, evidence) => confirmIdentityContact(confirmingContact, updates, evidence)}
          onClose={() => setConfirmingContact(null)}
        />
      )}
    </>
  );
}
