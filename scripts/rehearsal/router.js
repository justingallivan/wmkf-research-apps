/** Static rehearsal has no Next page navigation; retain the same event API. */
import mitt from 'next/dist/shared/lib/mitt';
const router = { events: mitt() };
export default router;
