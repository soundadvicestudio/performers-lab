import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';
const VIRTUAL_SESSION_ID = '920fec9d-03e5-4ade-9ddc-e5d225c354e2';

function toIcs(isoStr) {
  return new Date(isoStr).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  const caller = await userRes.json();

  const { data: profRows } = await supabaseRequest(
    'GET', `/rest/v1/profiles?user_id=eq.${caller.id}&select=is_admin&limit=1`
  );
  if (!profRows?.[0]?.is_admin) return res.status(403).json({ error: 'Not authorized' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  const { data: orderRows } = await supabaseRequest(
    'GET', `/rest/v1/service_orders?id=eq.${orderId}&select=*&limit=1`
  );
  const order = orderRows?.[0];
  if (!order) return res.status(400).json({ error: 'Order not found' });
  if (order.status !== 'pending_approval') return res.status(400).json({ error: 'Order is not pending approval' });
  if (order.service_id !== VIRTUAL_SESSION_ID) return res.status(400).json({ error: 'Not a session order' });

  const { member_id, session_duration_minutes, proposed_slot_start, proposed_slot_end, notes } = order;

  const { data: profData } = await supabaseRequest(
    'GET', `/rest/v1/profiles?user_id=eq.${member_id}&select=display_name&limit=1`
  );
  const displayName = profData?.[0]?.display_name || 'Member';

  const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${member_id}`, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const { email: memberEmail } = await emailRes.json();

  if (!process.env.DAILY_API_KEY) return res.status(500).json({ error: 'DAILY_API_KEY not configured' });

  const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privacy: 'private',
      properties: { enable_chat: true, enable_screenshare: false, max_participants: 2 },
    }),
  });
  if (!dailyRes.ok) {
    const errText = await dailyRes.text();
    console.error('[approve] Daily.co room error:', errText);
    return res.status(502).json({ error: 'Failed to create Daily.co room' });
  }
  const room = await dailyRes.json();

  const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { room_name: room.name, is_owner: true } }),
  });
  if (!tokenRes.ok) {
    console.error('[approve] Daily.co token error:', await tokenRes.text());
    return res.status(502).json({ error: 'Failed to create host token' });
  }
  const { token: hostToken } = await tokenRes.json();

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(proposed_slot_start)) + ' CT';

  const { ok: evtOk, data: evtData } = await supabaseRequest(
    'POST', '/rest/v1/events',
    {
      title: `${displayName} — Coaching Session`,
      topic: `${session_duration_minutes}-min 1:1 Vocal Coaching`,
      description: notes || '',
      starts_at: proposed_slot_start,
      status: 'upcoming',
      type: 'private',
      member_id,
      daily_room_url: room.url,
      reminder_sent: false,
      morning_notify_sent: false,
    },
    { 'Prefer': 'return=representation' }
  );
  if (!evtOk) {
    console.error('[approve] event insert failed:', JSON.stringify(evtData));
    return res.status(500).json({ error: 'Failed to create event' });
  }
  const eventId = Array.isArray(evtData) ? evtData[0]?.id : evtData?.id;

  await supabaseRequest('PATCH', `/rest/v1/service_orders?id=eq.${orderId}`, {
    status: 'scheduled',
    proposal_status: null,
  });

  await supabaseRequest('POST', '/rest/v1/notifications', {
    user_id: member_id,
    type: 'session_approved',
    title: 'Your session is confirmed!',
    body: `Your ${session_duration_minutes}-min coaching session is confirmed for ${formattedDate}. Join from your My Orders page.`,
    link: '/app/services.html?tab=orders',
    read: false,
  });

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//The Performer's Lab//EN",
    'BEGIN:VEVENT',
    `DTSTART:${toIcs(proposed_slot_start)}`,
    `DTEND:${toIcs(proposed_slot_end)}`,
    'SUMMARY:1:1 Coaching Session with Jonathan',
    "DESCRIPTION:Your coaching session via The Performer's Lab.\\nJoin from: https://performers-lab.com/app/services.html?tab=orders",
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  if (memberEmail) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "The Performer's Lab <notifications@performers-lab.com>",
        to: [memberEmail],
        subject: `Your coaching session is confirmed — ${formattedDate}`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#070707;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#070707;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid rgba(201,169,110,0.28);border-radius:6px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid rgba(201,169,110,0.18);background:linear-gradient(180deg,rgba(201,169,110,0.08) 0%,transparent 100%);">
            <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9a96e;font-weight:600;">The Performer's Lab</p>
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">Session Confirmed</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Great news, ${displayName}!</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Your <strong style="color:#f0ede6;font-weight:600;">${session_duration_minutes}-minute coaching session</strong> is confirmed for <strong style="color:#f0ede6;font-weight:600;">${formattedDate}</strong>.</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Join the session from your My Orders page when it's time. A calendar invite is attached to this email.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/services.html?tab=orders" style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">View My Orders →</a>
            </td></tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid rgba(240,237,230,0.06);">
            <p style="margin:0;font-size:12px;color:rgba(240,237,230,0.28);line-height:1.7;">
              <a href="https://alittlesoundadvice.com" style="color:rgba(240,237,230,0.28);text-decoration:none;"><strong style="font-weight:600;">Sound Advice</strong> <span style="font-size:11px;">Vocal Studio</span></a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        attachments: [{
          filename: 'coaching-session.ics',
          content: Buffer.from(icsContent).toString('base64'),
          content_type: 'text/calendar',
        }],
      }),
    });
  }

  return res.status(200).json({ ok: true, eventId, hostToken });
}
