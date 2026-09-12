/**
 * Preview read-only resolution for the Request Workbench shell.
 *
 * A Vercel Preview pointed at anything other than the reviewer sandbox is
 * visibly read-only: follow-up controls render but stay disabled, matching
 * the Dataverse target interlock instead of letting writes fail. Unknown
 * targets fail closed (read-only). Production and sandbox Previews are live.
 */
import { classifyTarget } from '../../dataverse/core/interlock';

export function resolvePreviewReadOnly(env = process.env) {
  return env.VERCEL_ENV === 'preview' && classifyTarget(env.DYNAMICS_URL) !== 'sandbox';
}
