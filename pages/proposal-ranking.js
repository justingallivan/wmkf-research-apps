import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ProposalRankingApp from '../shared/components/proposal-ranking/ProposalRankingApp';

export default function ProposalRankingPage() {
  return (
    <RequireAppAccess appKey="proposal-ranking">
      <Layout title="Proposal Ranking" description="Prepare PD proposal rankings and facilitate funding-cycle discussion.">
        <ProposalRankingApp />
      </Layout>
    </RequireAppAccess>
  );
}
