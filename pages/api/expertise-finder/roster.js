/**
 * API Route: /api/expertise-finder/roster
 *
 * CRUD for the internal expertise roster (consultants, board members, staff).
 * Any user with expertise-finder app access can read and write.
 *
 * GET:    Fetch roster members (with search, filter, pagination)
 * POST:   Create new roster member
 * PATCH:  Update existing roster member
 * DELETE: Soft-delete (set is_active = false)
 *
 * Query parameters (GET):
 *   id: number           - Fetch single member by ID
 *   search: string       - Search name, affiliation, expertise
 *   roleType: string     - Filter by role_type ('Consultant' | 'Board' | 'Research Program Staff')
 *   includeInactive: bool - Include soft-deleted members (default: false)
 *   sortBy: string       - 'name' | 'role_type' | 'affiliation' | 'updated_at' (default: 'name')
 *   sortOrder: string    - 'asc' | 'desc' (default: 'asc')
 *   limit: number        - Default: 100
 *   offset: number       - Default: 0
 */

import { sql } from '@vercel/postgres';
import { requireAppAccess } from '../../../lib/utils/auth';

function normalizePreferredEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('preferred_email must be a valid email address');
    error.status = 400;
    throw error;
  }
  return email;
}

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;

  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handleCreate(req, res, access);
    case 'PATCH':
      return handlePatch(req, res, access);
    case 'DELETE':
      return handleDelete(req, res, access);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req, res) {
  try {
    const {
      id,
      search = '',
      roleType,
      includeInactive,
      sortBy = 'name',
      sortOrder = 'asc',
      limit = '100',
      offset = '0',
    } = req.query;

    // Single member by ID
    if (id) {
      const result = await sql`
        SELECT * FROM expertise_roster WHERE id = ${parseInt(id)}
      `;
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Roster member not found' });
      }
      return res.status(200).json({ success: true, member: result.rows[0] });
    }

    // Build query with filters
    const conditions = [];
    const params = [];

    if (!includeInactive || includeInactive === 'false') {
      conditions.push('is_active = true');
    }

    if (roleType) {
      params.push(roleType);
      conditions.push(`role_type = $${params.length}`);
    }

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      conditions.push(`(name ILIKE $${idx} OR affiliation ILIKE $${idx} OR expertise ILIKE $${idx} OR keywords ILIKE $${idx})`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Validate sort
    const allowedSorts = ['name', 'role_type', 'affiliation', 'updated_at'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'name';
    const safeOrder = sortOrder === 'desc' ? 'DESC' : 'ASC';

    const safeLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    params.push(safeLimit);
    const limitIdx = params.length;
    params.push(safeOffset);
    const offsetIdx = params.length;

    const query = `
      SELECT * FROM expertise_roster
      ${whereClause}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM expertise_roster ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      sql.query(query, params),
      sql.query(countQuery, params.slice(0, params.length - 2)), // exclude limit/offset
    ]);

    return res.status(200).json({
      success: true,
      members: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: safeLimit,
      offset: safeOffset,
    });
  } catch (error) {
    console.error('Roster GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch roster' });
  }
}

async function handleCreate(req, res, access) {
  try {
    const {
      name, preferred_email, role_type, role, affiliation, orcid,
      primary_fields, keywords, subfields_specialties,
      methods_techniques, distinctions, expertise,
      keck_affiliation, keck_affiliation_details,
    } = req.body;

    if (!name || !role_type) {
      return res.status(400).json({ error: 'name and role_type are required' });
    }

    const validRoleTypes = ['Consultant', 'Board', 'Research Program Staff'];
    if (!validRoleTypes.includes(role_type)) {
      return res.status(400).json({ error: `role_type must be one of: ${validRoleTypes.join(', ')}` });
    }

    const result = await sql`
      INSERT INTO expertise_roster (
        name, preferred_email, role_type, role, affiliation, orcid,
        primary_fields, keywords, subfields_specialties,
        methods_techniques, distinctions, expertise,
        keck_affiliation, keck_affiliation_details,
        created_by, updated_by
      ) VALUES (
        ${name}, ${normalizePreferredEmail(preferred_email)}, ${role_type}, ${role || null}, ${affiliation || null}, ${orcid || 'N/A'},
        ${primary_fields || null}, ${keywords || null}, ${subfields_specialties || null},
        ${methods_techniques || null}, ${distinctions || null}, ${expertise || null},
        ${keck_affiliation || null}, ${keck_affiliation_details || null},
        ${access.profileId}, ${access.profileId}
      )
      RETURNING *
    `;

    return res.status(201).json({ success: true, member: result.rows[0] });
  } catch (error) {
    console.error('Roster CREATE error:', error);
    return res.status(error.status || 500).json({
      error: error.status === 400 ? error.message : 'Failed to create roster member',
    });
  }
}

async function handlePatch(req, res, access) {
  try {
    const { id, ...updates } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    // Check member exists
    const existing = await sql`SELECT id FROM expertise_roster WHERE id = ${parseInt(id)}`;
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Roster member not found' });
    }

    // Build dynamic update
    const allowedFields = [
      'name', 'preferred_email', 'role_type', 'role', 'affiliation', 'orcid',
      'primary_fields', 'keywords', 'subfields_specialties',
      'methods_techniques', 'distinctions', 'expertise',
      'keck_affiliation', 'keck_affiliation_details', 'is_active',
    ];

    const setClauses = [];
    const params = [];

    for (const field of allowedFields) {
      if (field in updates) {
        params.push(field === 'preferred_email'
          ? normalizePreferredEmail(updates[field])
          : updates[field]);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Validate role_type if being updated
    if ('role_type' in updates) {
      const validRoleTypes = ['Consultant', 'Board', 'Research Program Staff'];
      if (!validRoleTypes.includes(updates.role_type)) {
        return res.status(400).json({ error: `role_type must be one of: ${validRoleTypes.join(', ')}` });
      }
    }

    // Add audit fields
    params.push(access.profileId);
    setClauses.push(`updated_by = $${params.length}`);
    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    params.push(parseInt(id));
    const idIdx = params.length;

    const query = `
      UPDATE expertise_roster
      SET ${setClauses.join(', ')}
      WHERE id = $${idIdx}
      RETURNING *
    `;

    const result = await sql.query(query, params);
    return res.status(200).json({ success: true, member: result.rows[0] });
  } catch (error) {
    console.error('Roster PATCH error:', error);
    return res.status(error.status || 500).json({
      error: error.status === 400 ? error.message : 'Failed to update roster member',
    });
  }
}

async function handleDelete(req, res, access) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    // Soft-delete
    const result = await sql`
      UPDATE expertise_roster
      SET is_active = false, updated_by = ${access.profileId}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${parseInt(id)} AND is_active = true
      RETURNING id, name
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Roster member not found or already inactive' });
    }

    return res.status(200).json({
      success: true,
      message: `Deactivated "${result.rows[0].name}"`,
    });
  } catch (error) {
    console.error('Roster DELETE error:', error);
    return res.status(500).json({ error: 'Failed to delete roster member' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
