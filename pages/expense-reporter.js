import { useState } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import { FiDollarSign, FiDownload, FiEdit, FiCheck, FiX } from 'react-icons/fi';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

function ExpenseReporter() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [editingRow, setEditingRow] = useState(null);
  const [editedData, setEditedData] = useState({});

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleRemoveFile = (indexToRemove) => {
    setUploadedFiles(files => files.filter((_, index) => index !== indexToRemove));
    if (uploadedFiles.length === 1) {
      setResults(null);
      setError(null);
    }
  };

  const handleFilesUploaded = async (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;

    // Filter for supported file types
    const supportedFiles = newFiles.filter(file => {
      const ext = file.filename.toLowerCase().split('.').pop();
      return ['pdf', 'png', 'jpg', 'jpeg'].includes(ext);
    });

    if (supportedFiles.length === 0) {
      setError('Please upload PDF or image files (PNG, JPG, JPEG)');
      return;
    }

    setUploadedFiles(prev => [...prev, ...supportedFiles]);
    setError(null);
  };

  const handleProcessExpenses = async () => {
    if (!uploadedFiles.length) {
      setError('Please upload at least one receipt or invoice');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResults(null);
    setStreamingMessage('Processing receipts...');

    try {
      const response = await fetch('/api/process-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: uploadedFiles
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process expenses');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'progress') {
                setStreamingMessage(data.message);
              } else if (data.type === 'result') {
                setResults(data);
                setStreamingMessage('');
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (e) {
              if (line.slice(6) !== '[DONE]') {
                console.error('Failed to parse streaming data:', e);
              }
            }
          }
        }
      }
    } catch (err) {
      setError(err.message);
      setStreamingMessage('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEditRow = (index) => {
    setEditingRow(index);
    setEditedData(results.expenses[index]);
  };

  const handleSaveEdit = () => {
    const updatedExpenses = [...results.expenses];
    updatedExpenses[editingRow] = editedData;
    setResults({ ...results, expenses: updatedExpenses });
    setEditingRow(null);
    setEditedData({});
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setEditedData({});
  };

  const handleFieldChange = (field, value) => {
    setEditedData({ ...editedData, [field]: value });
  };

  const exportToCSV = () => {
    if (!results?.expenses) return;

    const headers = ['Date', 'Vendor', 'Description', 'Amount', 'Category', 'Payment Method', 'Card Type', 'Card Last 4', 'Source File', 'Notes', 'Confidence'];
    const rows = results.expenses.map(expense => [
      expense.date || '',
      expense.vendor || '',
      expense.description || '',
      expense.amount || '',
      expense.category || '',
      expense.paymentMethod || '',
      expense.cardType || '',
      expense.cardLast4 || '',
      expense.sourceFile || '',
      expense.notes || '',
      expense.confidence || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expense-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToExcel = () => {
    if (!results?.expenses) return;

    try {
      // Create HTML table with proper formatting
      let htmlTable = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:x="urn:schemas-microsoft-com:office:excel"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <style>
            table {
              border-collapse: collapse;
              width: 100%;
            }
            th {
              background-color: #d3d3d3;
              font-weight: bold;
              text-align: center;
              padding: 8px;
              border: 1px solid #999;
            }
            td {
              padding: 8px;
              border: 1px solid #ddd;
            }
            .amount {
              text-align: right;
            }
            .date {
              text-align: center;
            }
            .total-row td {
              font-weight: bold;
              border-top: 2px solid #000;
              padding-top: 10px;
            }
            .total-label {
              text-align: right;
            }
            .total-amount {
              text-align: right;
            }
          </style>
        </head>
        <body>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Payment Method</th>
                <th>Card Type</th>
                <th>Card Last 4</th>
                <th>Source File</th>
                <th>Notes</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>`;

      // Add data rows
      results.expenses.forEach(expense => {
        // Extract numeric value from amount string
        let numericAmount = '';
        if (expense.amount) {
          const amountMatch = expense.amount.match(/[\d,]+\.?\d*/);
          if (amountMatch) {
            numericAmount = parseFloat(amountMatch[0].replace(/,/g, '')).toFixed(2);
          }
        }

        htmlTable += `
              <tr>
                <td class="date">${expense.date || ''}</td>
                <td>${expense.vendor || ''}</td>
                <td>${expense.description || ''}</td>
                <td class="amount">${numericAmount}</td>
                <td>${expense.category || ''}</td>
                <td>${expense.paymentMethod || ''}</td>
                <td>${expense.cardType || ''}</td>
                <td>${expense.cardLast4 || ''}</td>
                <td>${expense.sourceFile || ''}</td>
                <td>${expense.notes || ''}</td>
                <td>${expense.confidence || ''}</td>
              </tr>`;
      });

      // Add total row
      const totalAmount = calculateTotal();
      htmlTable += `
              <tr class="total-row">
                <td colspan="2"></td>
                <td class="total-label">TOTAL:</td>
                <td class="total-amount">${totalAmount}</td>
                <td colspan="7"></td>
              </tr>
            </tbody>
          </table>
        </body>
        </html>`;

      // Create blob and download
      const blob = new Blob([htmlTable], {
        type: 'application/vnd.ms-excel;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date().toISOString().split('T')[0];
      link.download = `expense-report-${today}.xls`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Excel export error:', err);
      setError('Failed to export to Excel. Please try CSV export instead.');
    }
  };

  const calculateTotal = () => {
    if (!results?.expenses) return '0.00';

    return results.expenses.reduce((total, expense) => {
      const amount = parseFloat(expense.amount?.replace(/[^0-9.-]/g, '') || 0);
      return total + amount;
    }, 0).toFixed(2);
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <PageHeader
          title="Expense Report Generator"
          subtitle="Upload receipts and invoices to automatically generate expense reports"
          icon="💰"
        />

        <Card>
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Upload Receipts</h3>
            </div>

            <p className="text-sm text-gray-600">
              Upload PDF, JPG, or PNG receipts and invoices. You can select multiple files;
              extracted amounts and categories can be checked before export.
            </p>

            <FileUploaderSimple
              onFilesUploaded={handleFilesUploaded}
              multiple={true}
              accept=".pdf,.png,.jpg,.jpeg"
              // Phase 1 pilot: receipts/invoices are sensitive — upload as
              // private blobs (no auth-free URL). process-expenses reads them
              // server-side by pathname. Gated behind a flag (default public)
              // until a live private upload→read smoke confirms the store
              // supports private access; flip NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB
              // to 'true' to enable. The read path handles both modes, so the
              // flag only controls new uploads.
              access={process.env.NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB === 'true' ? 'private' : 'public'}
            />

            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Uploaded Files ({uploadedFiles.length})</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">
                          {file.filename.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️'}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{file.filename}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(index)}
                        aria-label={`Remove ${file.filename}`}
                        title={`Remove ${file.filename}`}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                      >
                        <FiX />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ErrorAlert error={error} onDismiss={() => setError(null)} className="mt-4" />

            <div className="flex justify-center mt-6">
              <Button
                onClick={handleProcessExpenses}
                disabled={isProcessing || !uploadedFiles.length}
                variant="primary"
                className="px-8"
              >
                {isProcessing ? 'Processing...' : 'Process Expenses'}
              </Button>
            </div>

            {isProcessing && streamingMessage && (
              <div className="mt-4 text-center" role="status" aria-live="polite">
                <div className="inline-flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                  <span className="text-sm text-gray-600">{streamingMessage}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {results && (
          <Card>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Extracted Expenses</h3>
                <div className="flex space-x-2">
                  <Button onClick={exportToCSV} variant="outline" size="sm">
                    <FiDownload className="mr-1" /> Export CSV
                  </Button>
                  <Button onClick={exportToExcel} variant="outline" size="sm">
                    <FiDownload className="mr-1" /> Export Excel
                  </Button>
                </div>
              </div>

              {results.expenses && results.expenses.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.expenses.map((expense, index) => (
                          <tr key={index} className={editingRow === index ? 'bg-blue-50/50' : 'hover:bg-gray-50'}>
                            {editingRow === index ? (
                              <>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    aria-label={`Date for expense ${index + 1}`}
                                    value={editedData.date || ''}
                                    onChange={(e) => handleFieldChange('date', e.target.value)}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    aria-label={`Vendor for expense ${index + 1}`}
                                    value={editedData.vendor || ''}
                                    onChange={(e) => handleFieldChange('vendor', e.target.value)}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    aria-label={`Description for expense ${index + 1}`}
                                    value={editedData.description || ''}
                                    onChange={(e) => handleFieldChange('description', e.target.value)}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    aria-label={`Amount for expense ${index + 1}`}
                                    value={editedData.amount || ''}
                                    onChange={(e) => handleFieldChange('amount', e.target.value)}
                                    className="w-24 px-2 py-1 border rounded text-sm"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    aria-label={`Category for expense ${index + 1}`}
                                    value={editedData.category || ''}
                                    onChange={(e) => handleFieldChange('category', e.target.value)}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      aria-label={`Payment method for expense ${index + 1}`}
                                      placeholder="Payment method"
                                      value={editedData.paymentMethod || ''}
                                      onChange={(e) => handleFieldChange('paymentMethod', e.target.value)}
                                      className="w-full px-2 py-1 border rounded text-xs"
                                    />
                                    <div className="flex space-x-1">
                                      <input
                                        type="text"
                                        placeholder="Card"
                                        value={editedData.cardType || ''}
                                        aria-label={`Card type for expense ${index + 1}`}
                                        onChange={(e) => handleFieldChange('cardType', e.target.value)}
                                        className="w-16 px-1 py-1 border rounded text-xs"
                                      />
                                      <input
                                        type="text"
                                        placeholder="****"
                                        value={editedData.cardLast4 || ''}
                                        aria-label={`Last four card digits for expense ${index + 1}`}
                                        onChange={(e) => handleFieldChange('cardLast4', e.target.value)}
                                        className="w-12 px-1 py-1 border rounded text-xs"
                                        maxLength="4"
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex space-x-1">
                                    <button
                                      type="button"
                                      onClick={handleSaveEdit}
                                      aria-label={`Save edits for expense ${index + 1}`}
                                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-green-600 hover:bg-green-50 hover:text-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                                    >
                                      <FiCheck />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCancelEdit}
                                      aria-label={`Cancel edits for expense ${index + 1}`}
                                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                                    >
                                      <FiX />
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 text-sm">{expense.date || '-'}</td>
                                <td className="px-3 py-2 text-sm font-medium">{expense.vendor || '-'}</td>
                                <td className="px-3 py-2 text-sm">{expense.description || '-'}</td>
                                <td className="px-3 py-2 text-sm font-semibold">{expense.amount || '-'}</td>
                                <td className="px-3 py-2 text-sm">
                                  <span className="inline-flex min-h-6 items-center px-2.5 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                                    {expense.category || 'Uncategorized'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  <div className="space-y-1">
                                    {expense.paymentMethod && (
                                      <div className="text-xs text-gray-600">
                                        {expense.paymentMethod}
                                      </div>
                                    )}
                                    {(expense.cardType || expense.cardLast4) && (
                                      <div className="text-xs text-gray-500">
                                        {expense.cardType && <span className="font-medium">{expense.cardType}</span>}
                                        {expense.cardLast4 && <span className="ml-1">••••{expense.cardLast4}</span>}
                                      </div>
                                    )}
                                    {!expense.paymentMethod && !expense.cardType && !expense.cardLast4 && (
                                      <span className="text-xs text-gray-400">-</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() => handleEditRow(index)}
                                    aria-label={`Edit expense ${index + 1}`}
                                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                                  >
                                    <FiEdit />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan="3" className="px-3 py-2 text-sm font-semibold text-right">Total:</td>
                          <td className="px-3 py-2 text-sm font-bold">${calculateTotal()}</td>
                          <td colSpan="3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {results.summary && (
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                      <h4 className="text-sm font-semibold mb-2">Processing Summary</h4>
                      <p className="text-sm text-gray-600">{results.summary}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-center py-4">No expenses extracted</p>
              )}
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}

export default function ExpenseReporterPage() {
  return <RequireAppAccess appKey="expense-reporter"><ExpenseReporter /></RequireAppAccess>;
}
