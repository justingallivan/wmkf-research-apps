import { useRouter } from 'next/router';
import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import BoardWriteups from '../shared/components/board-writeups/BoardWriteups';
export default function BoardWriteupsPage() {
  const router = useRouter();
  const cycle = typeof router.query.cycle === 'string' && /^[JD]\d{2}$/.test(router.query.cycle) ? router.query.cycle : 'D26';
  return <RequireAppAccess appKey="reviewers"><Layout title="Board writeups"><BoardWriteups key={cycle} initialCycle={cycle} /></Layout></RequireAppAccess>;
}
