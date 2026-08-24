/**
 * Adapter: Dynamics email activities and their MIME attachments.
 *
 * The write methods preserve the existing guarded non-entity transport
 * helpers. Read methods keep email/activitymimeattachment entity access behind
 * the Dataverse adapter boundary so domain services never issue raw queries.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';

const EMAILS = entitySet('emails');
const ATTACHMENTS = entitySet('activitymimeattachments');
const EMAIL_SELECT = 'activityid,subject,description,subcategory,statecode,statuscode,senton';
const PARTY_EXPAND = 'email_activity_parties($select=participationtypemask,addressused)';

export function create(input) {
  return DynamicsService.createEmailActivity(input);
}

export function addAttachment(emailId, input) {
  return DynamicsService.addEmailAttachment(emailId, input);
}

export function send(emailId, options) {
  return DynamicsService.sendEmail(emailId, options);
}

export function getById(emailId) {
  return DynamicsService.getRecord(EMAILS, emailId, {
    select: EMAIL_SELECT,
    expand: PARTY_EXPAND,
  });
}

export async function findByCorrelation(correlationKey) {
  const result = await DynamicsService.queryRecords(EMAILS, {
    select: EMAIL_SELECT,
    expand: PARTY_EXPAND,
    filter: odata.eq('subcategory', correlationKey),
    top: 2,
  });
  return result.records || [];
}

export async function findAttachments(emailId, filename) {
  const result = await DynamicsService.queryRecords(ATTACHMENTS, {
    select: 'activitymimeattachmentid,filename,mimetype,filesize',
    filter: odata.and([
      odata.eqGuid('_objectid_value', emailId),
      odata.eq('filename', filename),
    ]),
    top: 3,
  });
  return result.records || [];
}

export function getAttachmentById(attachmentId) {
  return DynamicsService.getRecord(ATTACHMENTS, attachmentId, {
    select: 'activitymimeattachmentid,filename,mimetype,filesize,body',
  });
}

export const EMAIL_ENTITY_SET = EMAILS;
export const ATTACHMENT_ENTITY_SET = ATTACHMENTS;
