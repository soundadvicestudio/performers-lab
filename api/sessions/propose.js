import { supabaseRequest } from '../lib/supabaseAdmin.js';

const VIRTUAL_SESSION_ID = '920fec9d-03e5-4ade-9ddc-e5d225c354e2';

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

  const { orderId, proposedStart, proposedEnd } = req.body || {};
  if (!orderId || !proposedStart || !proposedEnd) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: orderRows } = await supabaseRequest(
    'GET', `/rest/v1/service_orders?id=eq.${orderId}&select=*&limit=1`
  );
  const order = orderRows?.[0];
  if (!order || order.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Order not found or not pending approval' });
  }

  const proposedStartMs = new Date(proposedStart).getTime();
  if (isNaN(proposedStartMs)) return res.status(400).json({ error: 'Invalid proposedStart' });
  if (proposedStartMs < Date.now() + 24 * 3600 * 1000) {
    return res.status(400).json({ error: 'Proposed slot must be at least 24 hours from now' });
  }

  // Conflict check — exclude the current order's existing slot
  const { data: existingOrders } = await supabaseRequest(
    'GET',
    `/rest/v1/service_orders?service_id=eq.${VIRTUAL_SESSION_ID}&status=not.in.(cancelled)&proposed_slot_start=not.is.null&id=neq.${orderId}&select=proposed_slot_start,proposed_slot_end`
  );
  const newStart = new Date(proposedStart).getTime();
  const newEnd = new Date(proposedEnd).getTime();
  const bufMs = 30 * 60 * 1000;
  for (const ex of (existingOrders || [])) {
    const exS = new Date(ex.proposed_slot_start).getTime();
    const exE = new Date(ex.proposed_slot_end).getTime();
    if (newStart < exE + bufMs && newEnd > exS) {
      return res.status(400).json({ error: 'This time slot conflicts with an existing booking.' });
    }
  }

  await supabaseRequest('PATCH', `/rest/v1/service_orders?id=eq.${orderId}`, {
    proposed_slot_start: proposedStart,
    proposed_slot_end: proposedEnd,
    proposal_status: 'pending',
  });

  const { member_id, session_duration_minutes } = order;

  const { data: memberProf } = await supabaseRequest(
    'GET', `/rest/v1/profiles?user_id=eq.${member_id}&select=display_name,timezone&limit=1`
  );
  const displayName = memberProf?.[0]?.display_name || 'Member';
  const memberTz = memberProf?.[0]?.timezone || 'America/Chicago';

  const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${member_id}`, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const { email: memberEmail } = await emailRes.json();

  const slotDate = new Date(proposedStart);

  const formattedCT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(slotDate) + ' CT';

  let formattedLocal = formattedCT;
  let localLine = '';
  if (memberTz !== 'America/Chicago') {
    const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: memberTz, timeZoneName: 'short' })
      .formatToParts(slotDate).find(p => p.type === 'timeZoneName')?.value || memberTz;
    formattedLocal = new Intl.DateTimeFormat('en-US', {
      timeZone: memberTz,
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(slotDate) + ` (${tzAbbr})`;
    localLine = `<p style="margin:0 0 6px;font-size:16px;color:#f0ede6;font-weight:600;">${formattedLocal}</p><p style="margin:0 0 16px;font-size:13px;color:rgba(240,237,230,0.58);font-weight:300;">${formattedCT}</p>`;
  } else {
    localLine = `<p style="margin:0 0 16px;font-size:16px;color:#f0ede6;font-weight:600;">${formattedCT}</p>`;
  }

  await supabaseRequest('POST', '/rest/v1/notifications', {
    user_id: member_id,
    type: 'session_proposal',
    title: 'New session time proposed',
    body: `Jonathan proposed a new time for your coaching session: ${formattedCT}. Review and respond from My Orders.`,
    link: '/app/services.html?tab=orders',
    read: false,
  });

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
        subject: `New session time proposed — ${formattedCT}`,
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
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">New Session Time Proposed</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 12px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Jonathan has proposed a new time for your ${session_duration_minutes || 60}-minute coaching session:</p>
            ${localLine}
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Please accept or decline from your My Orders page within 48 hours. If no response is received, the proposal will expire automatically.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/services.html?tab=orders" style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Review Proposal →</a>
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
      }),
    });
  }

  return res.status(200).json({ ok: true });
}
