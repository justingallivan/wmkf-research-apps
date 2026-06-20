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
import GranteeDeliverableForm from '../../../shared/components/external/GranteeDeliverableForm';

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

  const { request, deliverable, view, preview } = state.data;

  return (
    <Shell>
      <h1>Grant Deliverables</h1>
      {request.title && <h2>{request.title}</h2>}
      {request.requestNumber && <p>Grant #{request.requestNumber}</p>}

      {preview && <AwardPreview html={preview} />}

      {view === 'edit' && (
        <GranteeDeliverableForm token={token} deliverable={deliverable} />
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

/**
 * Display-only preview of the assembled, styled award (chunk-8 output a). The
 * `html` is the server-rendered award block from the context route: every
 * plain-text field is HTML-escaped server-side and the body is DOMPurify-
 * sanitized to a tight allowlist, so it is safe to inject here. Header fields
 * (institution / location / PI+co-PIs / amount / edited title) are Foundation-
 * owned and not editable; the grantee edits the body in the form below.
 */
function AwardPreview({ html }) {
  return (
    <section
      aria-label="award-preview"
      style={{
        border: '1px solid #ddd',
        borderRadius: 6,
        background: '#fafafa',
        padding: '1rem 1.25rem',
        margin: '1.5rem 0',
        fontFamily: "Georgia, 'Times New Roman', serif",
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: '0 0 .75rem', fontFamily: 'Arial, sans-serif', fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#666' }}>
        How your award will appear
      </p>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

function Shell({ children }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      {children}
    </main>
  );
}
