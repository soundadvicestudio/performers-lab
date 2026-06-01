import { supabaseRequest } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify caller JWT
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  const callerUser = await userRes.json();
  const callerUserId = callerUser?.id;
  if (!callerUserId) return res.status(401).json({ error: 'Unauthorized' });

  const { type, recipientId, title, body, link, contextId } = req.body || {};

  if (!type || !recipientId || !title || !body || !link || !contextId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Never notify caller about their own actions
  if (recipientId === callerUserId) {
    return res.status(200).json({ ok: true, skipped: 'self-notification' });
  }

  // Batch lookup with service role (bypasses RLS, sees all rows)
  const qs = new URLSearchParams({
    user_id: `eq.${recipientId}`,
    type: `eq.${type}`,
    read: 'eq.false',
    context_id: `eq.${contextId}`,
    limit: '1',
    select: 'id,notification_count',
  });
  const { ok: lookupOk, data: rows } = await supabaseRequest(
    'GET',
    `/rest/v1/notifications?${qs}`
  );

  if (!lookupOk) {
    return res.status(500).json({ error: 'Lookup failed' });
  }

  const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  if (existing) {
    const newCount = (existing.notification_count || 1) + 1;
    const { ok: updateOk } = await supabaseRequest(
      'PATCH',
      `/rest/v1/notifications?id=eq.${existing.id}`,
      {
        notification_count: newCount,
        body: buildBatchedBody(type, newCount),
        link: buildBatchedLink(type, link, newCount),
      }
    );
    if (!updateOk) return res.status(500).json({ error: 'Update failed' });
  } else {
    const { ok: insertOk } = await supabaseRequest(
      'POST',
      '/rest/v1/notifications',
      {
        user_id: recipientId,
        type,
        title,
        body,
        link,
        read: false,
        notification_count: 1,
        context_id: contextId,
      }
    );
    if (!insertOk) return res.status(500).json({ error: 'Insert failed' });
  }

  return res.status(200).json({ ok: true });
}

function buildBatchedBody(type, count) {
  if (count === 1) return undefined; // caller's original body used on first insert
  if (type === 'post_reply') return `${count} new replies to a post you're following`;
  if (type === 'post_liked') return `${count} people liked your post`;
  if (type === 'comment_liked') return `${count} people liked your comment`;
  return `${count} new notifications`;
}

function buildBatchedLink(type, originalLink, count) {
  if (count === 1) return originalLink;
  if (type === 'post_reply') return originalLink.split('#')[0];
  return originalLink;
}
