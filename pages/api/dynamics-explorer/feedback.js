/**
 * API Route: /api/dynamics-explorer/feedback
 *
 * POST  — Submit feedback (thumbs up/down) from Dynamics Explorer chat
 *   Body: { feedbackType, category?, userNote?, queryText, conversationContext, sessionId, requestId?, autoDetected? }
 * GET   — List feedback records (superuser only)
 *   Query: ?status=new|reviewed|resolved&type=positive|negative&limit=50
 * PATCH — Update feedback status (superuser only)
 *   Body: { id, status, adminNote? }
 */

import { requireAppAccess, requireAuthWithProfile, isAuthRequired, getUserRole } from '../../../lib/utils/auth';
import FeedbackService from '../../../lib/services/feedback-service';

export default async function handler(req, res) {
  // POST — any authenticated user with dynamics-explorer access
  if (req.method === 'POST') {
    const access = await requireAppAccess(req, res, 'dynamics-explorer');
    if (!access) return;

    try {
      const { feedbackType, category, userNote, queryText, conversationContext, sessionId, requestId, autoDetected } = req.body;

      if (!feedbackType || !['positive', 'negative'].includes(feedbackType)) {
        return res.status(400).json({ error: 'feedbackType must be "positive" or "negative"' });
      }

      if (feedbackType === 'negative' && category && !['wrong_answer', 'no_results', 'incomplete', 'other'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }

      const feedback = await FeedbackService.createFeedback({
        userProfileId: access.profileId,
        sessionId,
        requestId,
        feedbackType,
        category: feedbackType === 'negative' ? category : null,
        userNote: userNote?.slice(0, 1000),
        queryText: queryText?.slice(0, 2000),
        conversationContext,
        autoDetected: autoDetected || false,
      });

      return res.json({ feedback });
    } catch (error) {
      console.error('Feedback POST error:', error);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }
  }

  // GET and PATCH — superuser only
  let profileId = null;
  if (!isAuthRequired()) {
    // Dev mode — skip auth
  } else {
    profileId = await requireAuthWithProfile(req, res);
    if (profileId === null) return;

    const role = await getUserRole(profileId);
    if (role !== 'superuser') {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }

  if (req.method === 'GET') {
    try {
      if (req.query.summary === 'true') {
        const summary = await FeedbackService.getFeedbackSummary();
        return res.json(summary);
      }

      const feedback = await FeedbackService.getFeedback({
        status: req.query.status,
        feedbackType: req.query.type,
        limit: Math.min(parseInt(req.query.limit) || 50, 200),
      });
      const summary = await FeedbackService.getFeedbackSummary();
      return res.json({ feedback, summary });
    } catch (error) {
      console.error('Feedback GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, status, adminNote } = req.body;
      if (!id || !['reviewed', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Missing id or invalid status (reviewed|resolved)' });
      }

      const feedback = await FeedbackService.updateFeedback(id, {
        status,
        adminNote,
        reviewedBy: profileId,
      });

      if (!feedback) {
        return res.status(404).json({ error: 'Feedback record not found' });
      }

      return res.json({ feedback });
    } catch (error) {
      console.error('Feedback PATCH error:', error);
      return res.status(500).json({ error: 'Failed to update feedback' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
