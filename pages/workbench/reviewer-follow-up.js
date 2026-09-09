/**
 * Legacy route: Reviewer follow-up now lives inside the Request Workbench
 * shell (`/workbench?view=reviewer-follow-up`). Redirect, carrying the cycle
 * and program so old links and bookmarks land on the same view.
 */
import { buildWorkbenchHref, readWorkbenchQuery } from '../../shared/components/workbench/workbench-location';

export async function getServerSideProps({ query }) {
  const state = readWorkbenchQuery(query);
  return {
    redirect: {
      destination: buildWorkbenchHref({ ...state, view: 'reviewer-follow-up' }),
      permanent: false,
    },
  };
}

export default function ReviewerFollowUpRedirect() {
  return null;
}
