import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ProposalRankingApp from '../shared/components/proposal-ranking/ProposalRankingApp';

export async function getServerSideProps() {
  const { getRankingTestPolicy, RANKING_TEST_CYCLE } = await import('../lib/services/proposal-ranking/test-policy');
  const policy = getRankingTestPolicy();
  if (policy.requested && !policy.enabled) return { notFound: true };
  return { props: { rehearsalCycle: policy.enabled ? RANKING_TEST_CYCLE : null } };
}

export default function ProposalRankingPage({ rehearsalCycle = null }) {
  return (
    <RequireAppAccess appKey="proposal-ranking">
      <Layout title="Proposal Ranking" description="Prepare PD proposal rankings and facilitate funding-cycle discussion.">
        {rehearsalCycle && <p role="status" className="rounded-lg bg-amber-100 p-3 text-amber-950">Ranking rehearsal · Fictional proposals · Sandbox data</p>}
        <ProposalRankingApp rehearsalCycle={rehearsalCycle} />
      </Layout>
    </RequireAppAccess>
  );
}
