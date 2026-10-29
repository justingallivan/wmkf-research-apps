import { useRouter } from 'next/router';
import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import BoardWriteups from '../shared/components/board-writeups/BoardWriteups';
import { useBoardPageCycle } from '../shared/components/landing-cycle/useBoardPageCycle';
export default function BoardCycleSetupPage() {
  const router = useRouter();
  const cycle = useBoardPageCycle(router);
  return <RequireAppAccess appKey="reviewers"><Layout title="Board cycle setup">{cycle ? <BoardWriteups key={cycle} initialCycle={cycle} mode="setup" /> : <p className="text-sm text-gray-500">Loading…</p>}</Layout></RequireAppAccess>;
}
