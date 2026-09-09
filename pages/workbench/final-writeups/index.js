/**
 * Legacy route: Final writeups now live inside the Request Workbench shell
 * (`/workbench?view=final-writeups`). Redirect, translating this page's old
 * query keys (`view`, `pd`, `cycleCode=none`) into the shell's.
 */
import { buildWorkbenchHref, readWorkbenchQuery } from '../../../shared/components/workbench/workbench-location';

const first = (value) => (Array.isArray(value) ? value[0] : value);

export async function getServerSideProps({ query }) {
  const rawCycle = String(first(query.cycleCode) || '').trim();
  const shell = readWorkbenchQuery({
    cycleCode: rawCycle.toLowerCase() === 'none' ? '' : rawCycle,
    uncycled: rawCycle.toLowerCase() === 'none' ? '1' : '',
    writeups: first(query.view),
    pd: first(query.pd),
  });
  return {
    redirect: { destination: buildWorkbenchHref({ ...shell, view: 'final-writeups' }), permanent: false },
  };
}

export default function FinalWriteupsRedirect() {
  return null;
}
