import { useState } from 'react';
import { useSession } from 'next-auth/react';
import PreSiteDistributionPanel from './PreSiteDistributionPanel';

/** Loading is a pause, not an actor change; private state never crosses confirmed senders. */
export default function DistributionSenderPanel(props) {
  const { data, status } = useSession();
  const [lastActor, setLastActor] = useState(null);
  const user = data?.user;
  const email = String(user?.azureEmail || '').trim().toLowerCase();
  const actor = status === 'authenticated' && user?.dynamicsSystemuserId && email
    ? `${user.dynamicsSystemuserId.toLowerCase()}:${email}` : null;
  if (status !== 'loading' && lastActor !== actor) setLastActor(actor);
  const scope = status === 'loading' ? lastActor : actor;
  if (!scope) return null;
  return <div hidden={status === 'loading'}><PreSiteDistributionPanel {...props}
    key={`${props.requestId}:${scope}`} actorScope={scope}
    composer={status === 'loading' ? 'hidden' : props.composer}
    authPaused={status !== 'authenticated'} /></div>;
}
