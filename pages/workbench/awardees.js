/**
 * Legacy route: this view now lives inside the Request Workbench shell
 * (`/workbench?view=awardees`). Redirect, carrying the cycle so old
 * links and bookmarks land on the same view.
 */
import { buildWorkbenchHref, readWorkbenchQuery } from '../../shared/components/workbench/workbench-location';

export async function getServerSideProps({ query }) {
  const state = readWorkbenchQuery(query);
  return {
    redirect: { destination: buildWorkbenchHref({ ...state, view: 'awardees' }), permanent: false },
  };
}

export default function LegacyWorkbenchViewRedirect() {
  return null;
}
