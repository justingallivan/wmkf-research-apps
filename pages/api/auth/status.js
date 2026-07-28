/**
 * API Route: /api/auth/status
 *
 * Returns whether the shared server policy is enforcing staff authentication.
 * Used by `RequireAuth` and page chrome to choose the matching client UX before
 * any session cookie exists.
 *
 * **Intentionally public.** The response shape MUST stay `{ enabled: boolean }`
 * — never grow this endpoint to expose tenant IDs, client IDs, configured
 * provider names, env-var presence flags, or any other deployment metadata.
 * The boolean alone is what the client needs and is the only thing that's
 * safe to expose pre-auth. If you need richer config on the client, gate it
 * behind a session.
 *
 * The value deliberately comes from the same `isAuthRequired()` predicate used
 * by the proxy and API guards. In production-mode runtimes this means `enabled`
 * remains true when configuration is incomplete, because the server fails
 * closed. It can report false only when the explicit emergency bypass permits
 * the base kill-switch/configuration predicate to disable authentication.
 */

import { isAuthRequired } from '../../../lib/utils/auth-policy';

export default function handler(req, res) {
  res.status(200).json({ enabled: isAuthRequired() });
}
