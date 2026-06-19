/**
 * Grantee deliverables portal — landing page (scaffold).
 *
 * Parallel grantee variant of pages/external/review/[token].js. Token-authed,
 * not user-authed: it reads the opaque token from the URL and fetches
 * /api/external/grantee/[token]/context, which verifies the token server-side.
 *
 * Chunk 1 ships the scaffold + fail-closed state rendering. The actual edit
 * form (abstract editor, image upload, caption, publish-image waiver submit
 * gate) is chunk 4; the submit route is chunk 5.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const REASON_MESSAGE = {
  no_token: 'This link is missing its access token.',
  malformed: 'This link is malformed.',
  invalid_signature: 'This link is invalid.',
  invalid_claim: 'This link is invalid.',
  expired: 'This link has expired. Please contact the Foundation for a new one.',
  not_found: 'We could not find the associated grant.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
};

export default function GranteePortalPage() {
  const router = useRouter();
  const { token } = router.query;

  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/external/grantee/${token}/context`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setState({ status: 'error', reason: data.reason });
        } else {
          setState({ status: 'ok', data });
        }
      } catch {
        if (!cancelled) setState({ status: 'error', reason: 'server_error' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <Shell><p>Loading…</p></Shell>;
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <h1>Grant Deliverables</h1>
        <p>{REASON_MESSAGE[state.reason] || 'This link cannot be opened.'}</p>
      </Shell>
    );
  }

  const { request, deliverable, view } = state.data;

  return (
    <Shell>
      <h1>Grant Deliverables</h1>
      {request.title && <h2>{request.title}</h2>}
      {request.requestNumber && <p>Grant #{request.requestNumber}</p>}

      {view === 'edit' && (
        <section>
          {/* Chunk 4: abstract editor + image upload + caption + publish-image
              waiver submit gate. Placeholder render until then. */}
          <p>Please review and submit your grant deliverables.</p>
          {deliverable.abstractFormatted && (
            <article aria-label="abstract-preview">{deliverable.abstractFormatted}</article>
          )}
        </section>
      )}

      {view === 'submitted' && (
        <p>Thank you — your deliverables have been received and are being reviewed.</p>
      )}

      {view === 'closed' && (
        <p>This submission is closed. Please contact the Foundation if you have questions.</p>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      {children}
    </main>
  );
}
