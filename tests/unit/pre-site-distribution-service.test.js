import {
  distributionBodyHtml,
  getPreSiteDistributionHistory,
  normalizeDistributionRecipients,
  preparePreSiteDistribution,
  projectDistributionAttempt,
  sendPreSiteDistribution,
} from '../../lib/services/pre-site-visit/distribution-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

test('normalizes known recipients without identity scoring and rejects To/Cc overlap', () => {
  expect(normalizeDistributionRecipients(
    'Staff@Example.org; staff@example.org\nconsultant@example.org',
    'another@example.org',
  )).toEqual({
    to: ['staff@example.org', 'consultant@example.org'],
    cc: ['another@example.org'],
  });
  expect(() => normalizeDistributionRecipients('staff@example.org', 'STAFF@example.org'))
    .toThrow(/both To and Cc/);
});

test('plain-text body rendering escapes markup and carries a recovery marker', () => {
  const html = distributionBodyHtml('Hello <staff>\n\nThank you & goodbye.', OPERATION_ID);
  expect(html).toContain('Hello &lt;staff&gt;');
  expect(html).toContain('Thank you &amp; goodbye.');
  expect(html).toContain(`wmkf-pre-site-distribution:${OPERATION_ID}`);
});

test('prepare rejects a missing attachment selection before any persistence or file work', async () => {
  await expect(preparePreSiteDistribution({
    requestId: REQUEST_ID,
    expectedArtifactId: '44444444-4444-4444-8444-444444444444',
    operationId: OPERATION_ID,
    attachmentMode: '',
    to: 'staff@example.org',
    subject: 'Frozen materials',
    bodyText: 'Attached.',
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, {})).rejects.toMatchObject({ code: 'distribution_attachment_mode_required' });
});

function attemptFixture(overrides = {}) {
  return {
    operation_id: OPERATION_ID,
    request_id: REQUEST_ID,
    source_document_id: '44444444-4444-4444-8444-444444444444',
    attachment_mode: 'both',
    to_recipients: ['staff@example.org'],
    cc_recipients: ['consultant@example.org'],
    subject: 'Frozen materials',
    body_text: 'Attached.',
    body_html: '<p>Attached.</p>',
    from_email: 'sender@example.org',
    acting_user_system_id: ACTOR_ID,
    draft_hash: 'b'.repeat(64),
    preview_hash: 'a'.repeat(64),
    state: 'prepared',
    docx_snapshot_document_id: '55555555-5555-4555-8555-555555555555',
    docx_drive_id: 'drive',
    docx_item_id: 'word-item',
    docx_version_id: '1.0',
    docx_web_url: 'https://sharepoint.test/word',
    docx_filename: 'frozen.docx',
    docx_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docx_byte_hash: 'c'.repeat(64),
    docx_size: 10,
    pdf_snapshot_document_id: '66666666-6666-4666-8666-666666666666',
    pdf_drive_id: 'drive',
    pdf_item_id: 'pdf-item',
    pdf_version_id: '1.0',
    pdf_web_url: 'https://sharepoint.test/pdf',
    pdf_filename: 'frozen.pdf',
    pdf_content_type: 'application/pdf',
    pdf_byte_hash: 'd'.repeat(64),
    pdf_size: 20,
    attempt_count: 0,
    ...overrides,
  };
}

function emailFixture(row, overrides = {}) {
  return {
    activityid: row.dynamics_email_id || '88888888-8888-4888-8888-888888888888',
    subject: row.subject,
    description: row.body_html,
    subcategory: `wmkf-pre-site-distribution:${row.operation_id}`,
    statuscode: 1,
    email_activity_parties: [
      { participationtypemask: 1, addressused: row.from_email },
      ...row.to_recipients.map((addressused) => ({ participationtypemask: 2, addressused })),
      ...row.cc_recipients.map((addressused) => ({ participationtypemask: 3, addressused })),
    ],
    ...overrides,
  };
}

test('projects only the selected attachment mode', () => {
  const projected = projectDistributionAttempt(attemptFixture({ attachment_mode: 'pdf' }));
  expect(projected.attachments.map((file) => file.kind)).toEqual(['pdf']);
});

test('history marks a retained distribution changed when the working Word version advances', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentpresitevisit_value: attempt.source_document_id })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: attempt.source_document_id,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'working-word',
    }] })),
    getFileMetadataById: jest.fn(async () => ({ versionId: '2.0' })),
  });
  expect(result.attempts[0].sourceFreshness).toBe('changed');
});

test('send persists one activity and both attachment steps before transport acceptance', async () => {
  let row = attemptFixture();
  const calls = [];
  const dependencies = {
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777', attempt_count: 1 };
      return row;
    }),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(async () => '88888888-8888-4888-8888-888888888888'),
    recordEmailActivity: jest.fn(async (attempt, emailId) => {
      row = { ...attempt, dynamics_email_id: emailId, state: 'activity_created' };
      calls.push('activity');
      return row;
    }),
    findEmailAttachments: jest.fn(async () => []),
    downloadFile: jest.fn(async (_drive, item) => ({
      buffer: item === 'word-item' ? Buffer.from('word-bytes') : Buffer.from('pdf-bytes'),
    })),
    addEmailAttachment: jest.fn(async (_emailId, attachment) => { calls.push(`add:${attachment.filename}`); }),
    recordAttachment: jest.fn(async (attempt, kind) => {
      row = {
        ...attempt,
        ...(kind === 'docx' ? { docx_attached_at: new Date() } : { pdf_attached_at: new Date() }),
      };
      calls.push(`persist:${kind}`);
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ statuscode: 1 })
      .mockResolvedValueOnce({ statuscode: 6, statecode: 0 }),
    recordSendRequested: jest.fn(async (attempt) => {
      row = { ...attempt, state: 'send_requested', send_requested_at: new Date() };
      calls.push('send_requested');
      return row;
    }),
    sendEmail: jest.fn(async () => { calls.push('send'); }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), send_requested_at: new Date(), lease_token: null };
      calls.push('sent');
      return row;
    }),
    recordFailure: jest.fn(async () => row),
  };
  // Match fixture hashes to the exact downloaded buffers.
  const crypto = await import('node:crypto');
  row.docx_byte_hash = crypto.createHash('sha256').update('word-bytes').digest('hex');
  row.pdf_byte_hash = crypto.createHash('sha256').update('pdf-bytes').digest('hex');

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.attempt.transportAccepted).toBe(true);
  expect(calls).toEqual([
    'activity',
    'add:frozen.docx', 'persist:docx',
    'add:frozen.pdf', 'persist:pdf',
    'send_requested', 'send', 'sent',
  ]);
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
});

test('an exact sent retry returns its receipt without another Dynamics write', async () => {
  const sent = attemptFixture({
    state: 'sent',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    sent_at: new Date(),
    send_requested_at: new Date(),
  });
  const dependencies = {
    getAttempt: jest.fn(async () => sent),
    claimSend: jest.fn(),
  };
  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);
  expect(result.reused).toBe(true);
  expect(dependencies.claimSend).not.toHaveBeenCalled();
});

test('send fails before claiming when a selected frozen attachment identity is incomplete', async () => {
  const incomplete = attemptFixture({
    attachment_mode: 'pdf',
    pdf_item_id: null,
  });
  const dependencies = {
    getAttempt: jest.fn(async () => incomplete),
    claimSend: jest.fn(),
  };
  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_preview_incomplete' });
  expect(dependencies.claimSend).not.toHaveBeenCalled();
});

test('a recovered Dynamics attachment is byte-verified before marking its step complete', async () => {
  const crypto = await import('node:crypto');
  const bytes = Buffer.from('pdf-bytes');
  let row = attemptFixture({
    attachment_mode: 'pdf',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    pdf_byte_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    pdf_size: bytes.length,
  });
  const dependencies = {
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 }),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    findEmailAttachments: jest.fn(async () => [{ activitymimeattachmentid: 'attachment-1' }]),
    getEmailAttachmentContent: jest.fn(async () => ({
      activitymimeattachmentid: 'attachment-1',
      filename: row.pdf_filename,
      mimetype: row.pdf_content_type,
      filesize: bytes.length,
      body: bytes.toString('base64'),
    })),
    addEmailAttachment: jest.fn(),
    recordAttachment: jest.fn(async (attempt) => {
      row = { ...attempt, pdf_attached_at: new Date(), state: 'attachments_added' };
      return row;
    }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), lease_token: null };
      return row;
    }),
    recordFailure: jest.fn(),
  };

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.reused).toBe(true);
  expect(dependencies.addEmailAttachment).not.toHaveBeenCalled();
  expect(dependencies.recordAttachment).toHaveBeenCalledWith(
    expect.any(Object),
    'pdf',
  );
});

test('a lost attachment response is byte-verified before the recovered step is persisted', async () => {
  const crypto = await import('node:crypto');
  const bytes = Buffer.from('pdf-bytes');
  let row = attemptFixture({
    attachment_mode: 'pdf',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    pdf_byte_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    pdf_size: bytes.length,
  });
  const dependencies = {
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn(async () => emailFixture(row)),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    findEmailAttachments: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ activitymimeattachmentid: 'attachment-1' }]),
    downloadFile: jest.fn(async () => ({ buffer: bytes })),
    addEmailAttachment: jest.fn(async () => { throw new Error('connection reset after write'); }),
    getEmailAttachmentContent: jest.fn(async () => ({
      activitymimeattachmentid: 'attachment-1',
      filename: row.pdf_filename,
      mimetype: row.pdf_content_type,
      filesize: bytes.length,
      body: Buffer.from('different-bytes').toString('base64'),
    })),
    recordAttachment: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_attachment_recovery_mismatch' });
  expect(dependencies.recordAttachment).not.toHaveBeenCalled();
});

test('an ambiguous SendEmail response is recovered from Dynamics status without a duplicate send', async () => {
  let row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    docx_attached_at: new Date(),
    pdf_attached_at: new Date(),
    state: 'attachments_added',
  });
  const dependencies = {
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 1 })
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 })
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 }),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    recordSendRequested: jest.fn(async (attempt) => {
      row = { ...attempt, state: 'send_requested', send_requested_at: new Date() };
      return row;
    }),
    sendEmail: jest.fn(async () => { throw new Error('connection reset after write'); }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), lease_token: null };
      return row;
    }),
    recordFailure: jest.fn(),
  };

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.attempt.transportAccepted).toBe(true);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
  expect(dependencies.recordFailure).not.toHaveBeenCalled();
});

test('a missing persisted Dynamics activity fails closed without creating a replacement', async () => {
  const row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    state: 'activity_created',
  });
  const leased = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
  const dependencies = {
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => leased),
    getEmailActivity: jest.fn(async () => null),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => leased),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_email_missing' });
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});
