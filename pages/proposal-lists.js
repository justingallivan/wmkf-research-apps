import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ProposalLists from '../shared/components/proposal-lists/ProposalLists';

export default function ProposalListsPage() {
  return <RequireAppAccess appKey="reviewers"><Layout title="Proposal lists"><ProposalLists /></Layout></RequireAppAccess>;
}
