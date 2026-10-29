import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import BoardWriteups from '../shared/components/board-writeups/BoardWriteups';
import { useBoardPageCycle } from '../shared/components/landing-cycle/useBoardPageCycle';
export default function BoardWriteupsPage() {
  const router = useRouter();
  const cycle = useBoardPageCycle(router);
  useEffect(() => {
    if (cycle && window.location.hash === '#discussion-cleanup') router.replace(`/board-cycle-setup?cycle=${cycle}#discussion-cleanup`);
  }, [router, cycle]);
  return <RequireAppAccess appKey="reviewers"><Layout title="Board writeups">{cycle ? <BoardWriteups key={cycle} initialCycle={cycle} /> : <p className="text-sm text-gray-500">Loading…</p>}</Layout></RequireAppAccess>;
}
