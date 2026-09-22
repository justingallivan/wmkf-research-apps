import RequireAppAccess from '../../shared/components/RequireAppAccess';
import PresentationMediaProofHarness from '../../shared/components/meeting-tracker/PresentationMediaProofHarness';
import { classifyDeployment } from '../../lib/dataverse/core/interlock';

export async function getServerSideProps() {
  if (classifyDeployment() !== 'preview') return { notFound: true };
  return { props: {} };
}

export default function PresentationMediaProofPage() {
  return (
    <RequireAppAccess appKey="meeting-tracker">
      <PresentationMediaProofHarness />
    </RequireAppAccess>
  );
}
