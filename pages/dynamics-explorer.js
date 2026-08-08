import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import DOMPurify from 'dompurify';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import HelpButton from '../shared/components/HelpButton';
import ProfileContext from '../shared/context/ProfileContext';
import RequireAppAccess from '../shared/components/RequireAppAccess';

// ─── Markdown table parser ───

function parseMarkdownTables(text) {
  // Split text into segments: regular text and table blocks
  const lines = text.split('\n');
  const segments = [];
  let currentText = [];
  let tableLines = [];
  let inTable = false;

  for (const line of lines) {
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

    if (isTableLine || isSeparator) {
      if (!inTable) {
        // Flush text before table
        if (currentText.length > 0) {
          segments.push({ type: 'text', content: currentText.join('\n') });
          currentText = [];
        }
        inTable = true;
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        // Flush table
        segments.push(parseTable(tableLines));
        tableLines = [];
        inTable = false;
      }
      currentText.push(line);
    }
  }

  // Flush remaining
  if (inTable && tableLines.length > 0) {
    segments.push(parseTable(tableLines));
  }
  if (currentText.length > 0) {
    segments.push({ type: 'text', content: currentText.join('\n') });
  }

  return segments;
}

function parseTable(lines) {
  const rows = lines
    .filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())) // skip separator
    .map(l =>
      l.trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim())
    );

  if (rows.length === 0) return { type: 'text', content: lines.join('\n') };

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return { type: 'table', headers, rows: dataRows };
}

function tableToCsv(headers, rows) {
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const csvLines = [headers.map(escape).join(',')];
  for (const row of rows) {
    csvLines.push(row.map(escape).join(','));
  }
  return csvLines.join('\n');
}

function downloadCsv(headers, rows, filename) {
  const csv = tableToCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Simple markdown renderer ───

function renderMarkdownText(text) {
  if (!text) return null;
  // Bold
  let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm">$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br/>');
  return html;
}

// ─── Example query chips ───

const EXAMPLE_QUERIES = [
  'How many proposals are there?',
  'Show me the 10 most recent proposals',
  'What tables are available?',
  'What fields does akoya_request have?',
  'Find emails related to proposal 1002386',
];

// ─── Main Page ───

function DynamicsExplorer() {
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState('');
  const [userRole, setUserRole] = useState('read_only');
  const [sessionId] = useState(() => `de-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [showAdmin, setShowAdmin] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState({});       // { messageId: 'positive'|'negative' }
  const [suggestFeedbackId, setSuggestFeedbackId] = useState(null);
  const [feedbackModalFor, setFeedbackModalFor] = useState(null); // messageId or null

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const messageIdRef = useRef(0);
  const pendingFileExportsRef = useRef([]);
  const pendingDocumentLinksRef = useRef([]);

  // useContext returns null when no ProfileProvider is mounted (non-public
  // pages always have one — see pages/_app.js); unconditional hook call.
  const profileContext = useContext(ProfileContext);
  const currentProfile = profileContext?.currentProfile;

  // Fetch user role on mount
  useEffect(() => {
    const profileId = currentProfile?.id;
    if (!profileId) return;

    fetch(`/api/dynamics-explorer/roles?userProfileId=${profileId}`)
      .then(r => r.json())
      .then(data => setUserRole(data.callerRole || data.role || 'read_only'))
      .catch(() => {});
  }, [currentProfile?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingStatus]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, []);

  const sendMessage = useCallback(async (text) => {
    const messageText = text || currentMessage.trim();
    if (!messageText || isProcessing) return;

    const userMsg = { id: ++messageIdRef.current, role: 'user', content: messageText, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setCurrentMessage('');
    setIsProcessing(true);
    setThinkingStatus('Thinking...');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const resp = await fetch('/api/dynamics-explorer/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          userProfileId: currentProfile?.id,
          sessionId,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Server error: ${resp.status}`);
      }

      // Parse SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let streamingMsgId = null;
      // Tracks whether the server sent a terminal event. A plain
      // `if (isProcessing)` after the read loop can never work: isProcessing is
      // captured from the render that created this callback, and the guard at
      // the top of sendMessage already returned when it was true — so it is
      // always false here, and a stream that drops without a terminal event
      // (function timeout, network cut) left the spinner running forever with
      // nothing rendered. A local flag is the only thing that survives the
      // closure correctly.
      let sawTerminalEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const eventLines = buffer.split('\n\n');
        buffer = eventLines.pop(); // Keep incomplete event in buffer

        for (const eventBlock of eventLines) {
          const lines = eventBlock.split('\n');
          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            if (line.startsWith('data: ')) eventData = line.slice(6);
          }

          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            switch (eventType) {
              case 'thinking':
                setThinkingStatus(parsed.message || 'Processing...');
                break;
              case 'file_ready':
                pendingFileExportsRef.current.push(parsed);
                break;
              case 'document_links':
                pendingDocumentLinksRef.current.push(parsed);
                break;
              case 'export_progress':
                setThinkingStatus(`Processing records ${parsed.processed} of ${parsed.total}...${parsed.failed ? ` (${parsed.failed} failed)` : ''}`);
                break;
              case 'text_delta':
                // Stream text incrementally — create or update streaming message
                if (!streamingMsgId) {
                  streamingMsgId = ++messageIdRef.current;
                  assistantContent = parsed.text || '';
                  setThinkingStatus('');
                  setMessages(prev => [...prev, {
                    id: streamingMsgId,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: Date.now(),
                    isStreaming: true,
                  }]);
                } else {
                  assistantContent += parsed.text || '';
                  setMessages(prev => prev.map(m =>
                    m.id === streamingMsgId
                      ? { ...m, content: assistantContent }
                      : m
                  ));
                }
                break;
              case 'response':
                // Non-streamed full response (fallback)
                assistantContent = parsed.content || '';
                break;
              case 'complete': {
                const fileExports = pendingFileExportsRef.current.length > 0
                  ? [...pendingFileExportsRef.current]
                  : undefined;
                pendingFileExportsRef.current = [];
                const documentLinks = pendingDocumentLinksRef.current.length > 0
                  ? [...pendingDocumentLinksRef.current]
                  : undefined;
                pendingDocumentLinksRef.current = [];

                let finalMsgId;
                if (streamingMsgId) {
                  finalMsgId = streamingMsgId;
                  // Finalize streaming message
                  setMessages(prev => prev.map(m =>
                    m.id === streamingMsgId
                      ? { ...m, content: assistantContent, isStreaming: false, rounds: parsed.rounds, fileExports, documentLinks }
                      : m
                  ));
                } else {
                  finalMsgId = ++messageIdRef.current;
                  // Add complete assistant message (non-streamed)
                  setMessages(prev => [...prev, {
                    id: finalMsgId,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: Date.now(),
                    rounds: parsed.rounds,
                    fileExports,
                    documentLinks,
                  }]);
                }
                // If server suggests feedback, mark this message
                if (parsed.suggestFeedback) {
                  setSuggestFeedbackId(finalMsgId);
                }
                sawTerminalEvent = true;
                setIsProcessing(false);
                setThinkingStatus('');
                break;
              }
              case 'error':
                setMessages(prev => [...prev, {
                  id: ++messageIdRef.current,
                  role: 'assistant',
                  // The reference id matches the server log line for this
                  // request — it's what an administrator needs to find the
                  // underlying error, which is not sent to the browser in
                  // production (development additionally returns `details`).
                  content: `**Error:** ${parsed.message}${parsed.requestId ? `\n\nReference: \`${parsed.requestId}\`` : ''}`,
                  timestamp: Date.now(),
                  isError: true,
                }]);
                sawTerminalEvent = true;
                setIsProcessing(false);
                setThinkingStatus('');
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // The stream ended without a terminal event — finalize whatever arrived
      // so the composer is usable again instead of stuck on a spinner.
      if (!sawTerminalEvent) {
        if (assistantContent) {
          if (streamingMsgId) {
            setMessages(prev => prev.map(m =>
              m.id === streamingMsgId
                ? { ...m, content: assistantContent, isStreaming: false }
                : m
            ));
          } else {
            setMessages(prev => [...prev, {
              id: ++messageIdRef.current,
              role: 'assistant',
              content: assistantContent,
              timestamp: Date.now(),
            }]);
          }
        } else {
          // Nothing arrived at all. Silently clearing the spinner would leave
          // the user staring at their own question with no idea it failed.
          setMessages(prev => [...prev, {
            id: ++messageIdRef.current,
            role: 'assistant',
            content: '**Error:** The connection dropped before I could answer. '
              + 'Long questions are the usual cause — narrowing yours often helps. '
              + 'Please try asking again, and if the problem doesn\'t resolve, contact an administrator.',
            timestamp: Date.now(),
            isError: true,
          }]);
        }
        setIsProcessing(false);
        setThinkingStatus('');
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: ++messageIdRef.current,
        role: 'assistant',
        content: `**Error:** ${err.message}`,
        timestamp: Date.now(),
        isError: true,
      }]);
      setIsProcessing(false);
      setThinkingStatus('');
    }
  }, [currentMessage, isProcessing, messages, currentProfile?.id, sessionId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = useCallback((content) => {
    navigator.clipboard.writeText(content);
  }, []);

  // Build conversation context: target message + up to 3 previous turns
  const buildFeedbackContext = useCallback((targetMsgId) => {
    const idx = messages.findIndex(m => m.id === targetMsgId);
    if (idx === -1) return [];

    // Find the user message that preceded this assistant message
    let startIdx = idx;
    let turnsBack = 0;
    for (let i = idx - 1; i >= 0 && turnsBack < 3; i--) {
      startIdx = i;
      if (messages[i].role === 'user') turnsBack++;
    }

    return messages.slice(startIdx, idx + 1).map(m => ({
      role: m.role,
      content: m.content,
      ...(m.rounds && { rounds: m.rounds }),
    }));
  }, [messages]);

  const submitFeedback = useCallback(async (messageId, feedbackType, category, userNote) => {
    const targetMsg = messages.find(m => m.id === messageId);
    // Find the user query that prompted this response
    const idx = messages.findIndex(m => m.id === messageId);
    const userMsg = idx > 0 ? messages.slice(0, idx).reverse().find(m => m.role === 'user') : null;

    try {
      await fetch('/api/dynamics-explorer/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackType,
          category,
          userNote,
          queryText: userMsg?.content || '',
          conversationContext: buildFeedbackContext(messageId),
          sessionId,
          autoDetected: messageId === suggestFeedbackId,
        }),
      });
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }

    setFeedbackMap(prev => ({ ...prev, [messageId]: feedbackType }));
    if (messageId === suggestFeedbackId) setSuggestFeedbackId(null);
  }, [messages, sessionId, suggestFeedbackId, buildFeedbackContext]);

  const handleFeedback = useCallback((messageId, type) => {
    if (feedbackMap[messageId]) return; // already submitted
    if (type === 'positive') {
      submitFeedback(messageId, 'positive');
    } else {
      setFeedbackModalFor(messageId);
    }
  }, [feedbackMap, submitFeedback]);

  const handleFeedbackModalSubmit = useCallback((category, note) => {
    if (feedbackModalFor) {
      submitFeedback(feedbackModalFor, 'negative', category, note);
    }
    setFeedbackModalFor(null);
  }, [feedbackModalFor, submitFeedback]);

  const exportChat = () => {
    const md = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `## ${role}\n\n${m.content}\n`;
    }).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dynamics-explorer-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const roleBadge = {
    superuser: { label: 'Superuser', color: 'bg-purple-100 text-purple-800 border-purple-200' },
    read_write: { label: 'Read/Write', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    read_only: { label: 'Read Only', color: 'bg-gray-100 text-gray-800 border-gray-200' },
  };
  const badge = roleBadge[userRole] || roleBadge.read_only;

  return (
    <Layout title="Dynamics Explorer" maxWidth="7xl">
      <PageHeader
        title="Dynamics Explorer"
        subtitle="Chat with your CRM data using natural language"
        icon="💬"
      >
        <HelpButton appKey="dynamics-explorer" className="mt-3" />
      </PageHeader>

      <div className="space-y-6 pb-8">
        {/* Role + Export */}
        <Card hover={false}>
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${badge.color}`}>
              {badge.label}
            </span>
            {messages.length > 0 && (
              <button
                onClick={exportChat}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Export chat
              </button>
            )}
          </div>
        </Card>

        {/* Chat area */}
        <Card hover={false} padding="p-0" className="flex flex-col" style={{ height: '70vh' }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && !isProcessing && (
              <WelcomeMessage
                onExampleClick={(q) => { setCurrentMessage(q); sendMessage(q); }}
              />
            )}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onCopy={copyMessage}
                onFeedback={handleFeedback}
                feedbackGiven={feedbackMap[msg.id]}
                suggestFeedback={msg.id === suggestFeedbackId}
              />
            ))}

            {/* Thinking indicator */}
            {isProcessing && thinkingStatus && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm flex-shrink-0">
                  💬
                </div>
                <div className="bg-gray-100 rounded-lg px-4 py-3 max-w-[80%]">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent" />
                    {thinkingStatus}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-200 p-4 bg-white rounded-b-xl">
            <div className="flex items-end gap-3">
              <textarea
                ref={textareaRef}
                value={currentMessage}
                onChange={(e) => { setCurrentMessage(e.target.value); adjustTextarea(); }}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your CRM data..."
                disabled={isProcessing}
                rows={1}
                className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                style={{ maxHeight: '200px' }}
              />
              <Button
                onClick={() => sendMessage()}
                disabled={!currentMessage.trim() || isProcessing}
                loading={isProcessing}
                size="md"
                className="flex-shrink-0"
              >
                Send
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Enter to send, Shift+Enter for new line
            </p>
          </div>
        </Card>

        {/* Admin panel (superuser only) */}
        {userRole === 'superuser' && (
          <Card hover={false}>
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-700"
            >
              <span className={`transition-transform ${showAdmin ? 'rotate-90' : ''}`}>&#9654;</span>
              Admin Panel
            </button>
            {showAdmin && (
              <AdminPanel userProfileId={currentProfile?.id} />
            )}
          </Card>
        )}
      </div>

      {/* Feedback modal */}
      {feedbackModalFor && (
        <FeedbackModal
          onSubmit={handleFeedbackModalSubmit}
          onCancel={() => setFeedbackModalFor(null)}
        />
      )}
    </Layout>
  );
}

// ─── Welcome Message ───

function WelcomeMessage({ onExampleClick }) {
  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4">💬</div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to Dynamics Explorer</h2>
      <p className="text-gray-600 mb-6 max-w-md mx-auto">
        Ask questions about your CRM data in natural language. I'll query the Dynamics 365 system and present the results.
      </p>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
        {EXAMPLE_QUERIES.map((q, i) => (
          <button
            key={i}
            onClick={() => onExampleClick(q)}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message Bubble ───

const MessageBubble = React.memo(function MessageBubble({ message, onCopy, onFeedback, feedbackGiven, suggestFeedback }) {
  const isUser = message.role === 'user';
  const segments = useMemo(
    () => isUser ? [{ type: 'text', content: message.content }] : parseMarkdownTables(message.content),
    [isUser, message.content]
  );

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
        isUser ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
      }`}>
        {isUser ? '👤' : '💬'}
      </div>

      <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`rounded-lg px-4 py-3 inline-block text-left ${
          isUser
            ? 'bg-blue-600 text-white'
            : message.isError
              ? 'bg-red-50 border border-red-200 text-gray-900'
              : 'bg-gray-100 text-gray-900'
        }`}>
          {segments.map((seg, i) => (
            seg.type === 'table' ? (
              <DataTable key={i} headers={seg.headers} rows={seg.rows} />
            ) : (
              <div
                key={i}
                className="text-sm leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdownText(seg.content)) }}
              />
            )
          ))}
        </div>

        {/* File download buttons */}
        {message.fileExports?.map((fe, i) => (
          <FileDownloadButton key={i} fileExport={fe} />
        ))}

        {/* Document download links */}
        {message.documentLinks?.map((dl, i) => (
          <DocumentLinks key={i} data={dl} />
        ))}

        {/* Actions */}
        {!isUser && !message.isStreaming && (
          <div className="mt-1">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <button onClick={() => onCopy(message.content)} className="hover:text-gray-600">
                Copy
              </button>
              {!message.isError && (
                <>
                  <button
                    onClick={() => onFeedback(message.id, 'positive')}
                    className={`hover:text-gray-600 ${feedbackGiven === 'positive' ? 'text-green-600' : ''}`}
                    title="Helpful"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={feedbackGiven === 'positive' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 10v12" /><path d="M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0117.5 22H4a2 2 0 01-2-2v-8a2 2 0 012-2h2.76a2 2 0 001.79-1.11L12 2a3.13 3.13 0 013 3.88z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onFeedback(message.id, 'negative')}
                    className={`hover:text-gray-600 ${feedbackGiven === 'negative' ? 'text-red-600' : ''}`}
                    title="Not helpful"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={feedbackGiven === 'negative' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 14V2" /><path d="M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 016.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2h-2.76a2 2 0 00-1.79 1.11L12 22a3.13 3.13 0 01-3-3.88z" />
                    </svg>
                  </button>
                </>
              )}
              {message.rounds && (
                <span>{message.rounds} query round{message.rounds > 1 ? 's' : ''}</span>
              )}
            </div>
            {suggestFeedback && !feedbackGiven && (
              <div className="mt-1 text-xs text-amber-600">
                Was this response helpful? Use the thumbs above to let us know.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── File Download Button ───

function FileDownloadButton({ fileExport }) {
  const handleDownload = useCallback(() => {
    const bytes = Uint8Array.from(atob(fileExport.base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileExport.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileExport]);

  return (
    <div className="my-3 flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
      <div className="text-2xl flex-shrink-0">📊</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{fileExport.filename}</div>
        <div className="text-xs text-gray-500">
          {fileExport.recordCount.toLocaleString()} rows, {fileExport.columns.length} columns
          {fileExport.capped && (
            <span className="text-amber-600 ml-1">
              (capped — {fileExport.totalCount.toLocaleString()} total matched)
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleDownload}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex-shrink-0"
      >
        Download
      </button>
    </div>
  );
}

// ─── Document Links ───

function DocumentLinks({ data }) {
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!data?.files?.length) return null;

  return (
    <div className="my-3 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-lg">📄</span>
        <span className="text-sm font-medium text-gray-700">
          {data.files.length} document{data.files.length !== 1 ? 's' : ''}
          {data.requestNumber ? ` — Request ${data.requestNumber}` : ''}
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {data.files.map((file, i) => {
          // Build a "where" label so users can tell `Year 1/Report.docx` from
          // `Year 2/Report.docx` and see which library a migrated file came from.
          const where = file.subfolder
            ? `${file.library || ''}/${file.subfolder}`.replace(/^\//, '')
            : (file.library || '');
          return (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{file.name}</div>
              <div className="text-xs text-gray-500">
                {formatSize(file.size)}
                {file.lastModified && ` · ${new Date(file.lastModified).toLocaleDateString()}`}
                {where && ` · ${where}`}
              </div>
            </div>
            <a
              href={file.downloadUrl}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex-shrink-0"
              download
            >
              Download
            </a>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Data Table ───

function DataTable({ headers, rows }) {
  return (
    <div className="my-3 -mx-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 bg-gray-200 border-b border-gray-300 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-gray-700 border-b border-gray-200 whitespace-nowrap max-w-xs truncate" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end mt-1">
        <button
          onClick={() => downloadCsv(headers, rows, `dynamics-export-${Date.now()}.csv`)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}

// ─── Admin Panel ───

function AdminPanel({ userProfileId }) {
  const [restrictions, setRestrictions] = useState([]);
  const [newRestriction, setNewRestriction] = useState({ table_name: '', field_name: '', reason: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/dynamics-explorer/restrictions?userProfileId=${userProfileId}`)
      .then(r => r.json())
      .then(data => {
        setRestrictions(data.restrictions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userProfileId]);

  const addRestriction = async () => {
    if (!newRestriction.table_name) return;
    const resp = await fetch('/api/dynamics-explorer/restrictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newRestriction, userProfileId }),
    });
    const data = await resp.json();
    if (data.restriction) {
      setRestrictions(prev => [...prev, data.restriction]);
      setNewRestriction({ table_name: '', field_name: '', reason: '' });
    }
  };

  const removeRestriction = async (id) => {
    await fetch('/api/dynamics-explorer/restrictions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userProfileId }),
    });
    setRestrictions(prev => prev.filter(r => r.id !== id));
  };

  if (loading) return <p className="text-sm text-gray-500 mt-4">Loading admin data...</p>;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">Data Restrictions</h3>
      {restrictions.length > 0 ? (
        <div className="space-y-1 mb-3">
          {restrictions.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm bg-gray-50 px-3 py-2 rounded">
              <span>
                <span className="font-mono text-xs">{r.table_name}</span>
                {r.field_name && <span className="font-mono text-xs">.{r.field_name}</span>}
                <span className="text-gray-500 ml-2">({r.restriction_type})</span>
                {r.reason && <span className="text-gray-500 ml-1">- {r.reason}</span>}
              </span>
              <button onClick={() => removeRestriction(r.id)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-3">No restrictions configured.</p>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <input
          placeholder="Table name"
          value={newRestriction.table_name}
          onChange={e => setNewRestriction(prev => ({ ...prev, table_name: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-40"
        />
        <input
          placeholder="Field (optional)"
          value={newRestriction.field_name}
          onChange={e => setNewRestriction(prev => ({ ...prev, field_name: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-36"
        />
        <input
          placeholder="Reason"
          value={newRestriction.reason}
          onChange={e => setNewRestriction(prev => ({ ...prev, reason: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
        />
        <button onClick={addRestriction} className="px-3 py-1 bg-gray-900 text-white text-sm rounded hover:bg-gray-800">Add</button>
      </div>
    </div>
  );
}

// ─── Feedback Modal ───

function FeedbackModal({ onSubmit, onCancel }) {
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  const categories = [
    { value: 'wrong_answer', label: 'Wrong answer' },
    { value: 'no_results', label: 'No results found' },
    { value: 'incomplete', label: 'Incomplete response' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl p-5 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">What went wrong?</h3>
        <div className="space-y-2 mb-3">
          {categories.map(c => (
            <label key={c.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="feedback-category"
                value={c.value}
                checked={category === c.value}
                onChange={() => setCategory(c.value)}
                className="text-blue-600"
              />
              {c.label}
            </label>
          ))}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Additional details (optional)"
          maxLength={500}
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 mb-3"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(category, note)}
            disabled={!category}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-40"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DynamicsExplorerPage() {
  return <RequireAppAccess appKey="dynamics-explorer"><DynamicsExplorer /></RequireAppAccess>;
}
