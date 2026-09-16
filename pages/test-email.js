import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import EmailSendFeedback from '../shared/components/EmailSendFeedback';

export default function TestEmail() {
  const { data: session } = useSession();
  const sessionEmail = session?.user?.azureEmail || '';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('[TEST] Dynamics Email Integration');
  const [body, setBody] = useState('<p>This is a <strong>test email</strong> sent via the Dynamics 365 Email Activities API.</p><p>If you received this, the integration is working correctly.</p>');
  const [sendMode, setSendMode] = useState('draft');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const senderEmail = sessionEmail || from;

  async function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    setResult(null);

    try {
      const resp = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body, sendMode, from: senderEmail }),
      });
      const data = await resp.json();
      if (data.outcome === 'uncertain') {
        setResult({ ...data, status: 'uncertain' });
        return;
      }
      if (!resp.ok) {
        setResult({ ...data, status: data.outcome || 'failed', message: data.error || `Request failed (${resp.status})` });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({ status: 'uncertain', message: `The connection ended before the result could be confirmed. Check Dynamics before trying again. (${err.message})` });
    } finally {
      setSending(false);
    }
  }

  return (
    <Layout title="Email Test Client">
      <PageHeader
        title="Dynamics Email Test Client"
        description="Test the Dynamics 365 email integration. Creates email activities via the CRM API."
      />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
            {sessionEmail ? (
              <>
                <input
                  type="email"
                  value={sessionEmail}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
                />
                <p className="mt-1 text-xs text-gray-500">Sender is your authenticated email</p>
              </>
            ) : (
              <>
                <input
                  type="email"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  placeholder="sender@wmkeck.org"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">No session detected — enter sender manually (dev mode)</p>
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@wmkeck.org"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body (HTML)</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sendMode"
                  value="draft"
                  checked={sendMode === 'draft'}
                  onChange={e => setSendMode(e.target.value)}
                  className="text-blue-600"
                />
                <span className="text-sm">Create draft only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sendMode"
                  value="send"
                  checked={sendMode === 'send'}
                  onChange={e => setSendMode(e.target.value)}
                  className="text-blue-600"
                />
                <span className="text-sm">Create and send</span>
              </label>
            </div>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={sending || !to || !senderEmail}
            >
              {sending ? 'Processing...' : sendMode === 'send' ? 'Send Email' : 'Create Draft'}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <Card className="mt-4">
          <EmailSendFeedback
            status={result.status === 'draft' ? 'draft' : result.status === 'sent' ? 'sent' : result.status || 'failed'}
            message={result.message}
            details={result.emailId ? [`Dynamics activity ID: ${result.emailId}`] : []}
          />
        </Card>
      )}
    </Layout>
  );
}
