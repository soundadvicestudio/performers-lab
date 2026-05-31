import { supabaseRequest } from '../lib/supabaseAdmin.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adminUserId, subject, body, audience, recipientIds, deliveryMethod } = req.body || {};

  if (!adminUserId || !subject || !body || !audience || !deliveryMethod) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ── Step 1: Verify admin ──────────────────────────────────────────────
  const { data: profileRows } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${adminUserId}&select=is_admin&limit=1`
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (!profile?.is_admin) return res.status(403).json({ error: 'Not authorized' });

  // ── Step 2: Resolve recipients ────────────────────────────────────────
  let targetUserIds = [];

  if (audience === 'individual') {
    if (!Array.isArray(recipientIds) || !recipientIds.length) {
      return res.status(400).json({ error: 'recipientIds required for individual audience' });
    }
    targetUserIds = recipientIds.filter(id => UUID_RE.test(id));
  } else {
    let path = '/rest/v1/memberships?status=in.(active,cancelling)&select=user_id';
    if (audience === 'founding') path += '&plan=eq.founding';
    if (audience === 'standard') path += '&plan=eq.standard';
    const { data: memberships } = await supabaseRequest('GET', path);
    targetUserIds = (memberships || []).map(m => m.user_id);
  }

  // ── Step 3: Insert announcement row ───────────────────────────────────
  const { data: annRows } = await supabaseRequest(
    'POST',
    '/rest/v1/announcements?select=id',
    {
      subject,
      body,
      audience,
      sent_by: adminUserId,
      sent_at: new Date().toISOString(),
      recipient_count: targetUserIds.length,
    },
    { 'Prefer': 'return=representation' }
  );
  const announcementId = Array.isArray(annRows) ? annRows[0]?.id : null;

  const doPlatform = deliveryMethod === 'platform' || deliveryMethod === 'both';
  const doEmail    = deliveryMethod === 'email'    || deliveryMethod === 'both';

  // ── Step 4: Platform delivery ─────────────────────────────────────────
  if (doPlatform && targetUserIds.length > 0) {
    const plainBody = stripHtml(body).substring(0, 100);
    const CHUNK = 50;
    for (let i = 0; i < targetUserIds.length; i += CHUNK) {
      const chunk = targetUserIds.slice(i, i + CHUNK);
      await supabaseRequest(
        'POST',
        '/rest/v1/notifications',
        chunk.map(user_id => ({
          user_id,
          type: 'announcement',
          title: subject,
          body: plainBody,
          link: '/app/announcements.html',
          read: false,
        }))
      );
    }
  }

  // ── Step 5: Email delivery ────────────────────────────────────────────
  if (doEmail && targetUserIds.length > 0) {
    const emailHtml = buildEmailHtml(subject, body);
    for (const userId of targetUserIds) {
      const { data: userRow } = await supabaseRequest('GET', `/auth/v1/admin/users/${userId}`);
      if (!userRow?.email) continue;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: "The Performer's Lab <notifications@performers-lab.com>",
          to: userRow.email,
          subject,
          html: emailHtml,
        }),
      });

      await delay(50);
    }
  }

  // ── Step 6: Return ────────────────────────────────────────────────────
  return res.status(200).json({
    success: true,
    announcementId,
    recipientCount: targetUserIds.length,
    delivered: { platform: doPlatform, email: doEmail },
  });
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildEmailHtml(subject, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070707;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#070707;padding:48px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:600px;background:#0d0d0d;border-radius:8px;border:1px solid rgba(201,169,110,0.28);overflow:hidden;">
      <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#c9a96e,transparent);"></td></tr>
      <tr><td style="padding:24px 36px 16px;border-bottom:1px solid rgba(240,237,230,0.08);">
        <p style="margin:0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(240,237,230,0.28);font-weight:600;">The Performer's Lab</p>
        <h2 style="margin:8px 0 0;font-family:Georgia,serif;font-size:18px;font-weight:400;color:#c9a96e;">Announcement</h2>
      </td></tr>
      <tr><td style="padding:28px 36px;font-size:15px;color:#f0ede6;line-height:1.75;font-weight:300;">
        ${bodyContent}
      </td></tr>
      <tr><td style="padding:0 36px 28px;">
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="https://performers-lab.com/app/announcements.html"
             style="display:inline-block;background:#c9a96e;color:#070707;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none;">
            View in The Performer's Lab
          </a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 36px;border-top:1px solid rgba(240,237,230,0.08);">
        <p style="margin:0;font-size:11px;color:rgba(240,237,230,0.28);line-height:1.6;">
          <a href="https://alittlesoundadvice.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">Sound Advice <span style="font-size:10px;">Vocal Studio</span></a>
          &middot;
          <a href="https://performers-lab.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">performers-lab.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
