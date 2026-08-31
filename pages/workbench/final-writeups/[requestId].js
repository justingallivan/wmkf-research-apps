import { useRouter } from 'next/router';
import RequireAppAccess from '../../../shared/components/RequireAppAccess';
import { FinalWriteupFocusedView } from '../../../shared/components/final-writeups/FinalWriteupsViews';

export default function FinalWriteupFocusedPage() {
  const router = useRouter();
  const requestId = typeof router.query.requestId === 'string' ? router.query.requestId : '';
  return (
    <RequireAppAccess appKey="reviewers">
      <FinalWriteupFocusedView requestId={requestId} />
    </RequireAppAccess>
  );
}
