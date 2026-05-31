import { supabaseRequest } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { recipientUserId, senderName, messagePreview, conversationId } = req.body || {};

  if (!recipientUserId || !senderName || !conversationId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Fetch recipient email from Supabase Auth admin API
  const { data: adminUser, ok } = await supabaseRequest(
    'GET',
    `/auth/v1/admin/users/${recipientUserId}`
  );
  if (!ok || !adminUser?.email) {
    return res.status(404).json({ error: 'Recipient not found' });
  }

  const recipientEmail = adminUser.email;

  // Check recipient's DM email preference (null treated as true — opt-in by default)
  const { data: prefRows } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${recipientUserId}&select=email_notify_dm&limit=1`
  );
  const pref = Array.isArray(prefRows) ? prefRows[0] : null;
  if (pref?.email_notify_dm === false) {
    return res.status(200).json({ success: true, skipped: 'email_notify_dm=false' });
  }

  const preview = String(messagePreview || '').substring(0, 80);
  const msgUrl = `https://performers-lab.com/app/messages.html?conversation=${conversationId}`;

  const emailHtml = buildEmailHtml(senderName, preview, messagePreview, msgUrl);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: "The Performer's Lab <notifications@performers-lab.com>",
      to: recipientEmail,
      subject: `New message from ${senderName}`,
      html: emailHtml,
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    return res.status(500).json({ error: 'Email send failed', detail });
  }

  return res.status(200).json({ success: true });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEmailHtml(senderName, preview, fullPreview, msgUrl) {
  const ellipsis = fullPreview && fullPreview.length > 80 ? '&hellip;' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070707;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#070707;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#0d0d0d;border-radius:8px;border:1px solid rgba(201,169,110,0.28);overflow:hidden;">
      <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#c9a96e,transparent);"></td></tr>
      <tr><td style="padding:36px 32px;">
        <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(240,237,230,0.28);font-weight:600;">The Performer's Lab</p>
        <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:26px;font-weight:400;color:#f0ede6;line-height:1.2;">You have a new message</h1>
        <p style="margin:0 0 20px;font-size:14px;color:rgba(240,237,230,0.58);line-height:1.6;">
          <span style="color:#c9a96e;font-weight:600;">${esc(senderName)}</span> sent you a message:
        </p>
        <div style="background:#131313;border-left:3px solid #c9a96e;border-radius:0 4px 4px 0;padding:14px 18px;margin:0 0 28px;">
          <p style="margin:0;font-size:14px;color:rgba(240,237,230,0.7);line-height:1.6;font-style:italic;">${esc(preview)}${ellipsis}</p>
        </div>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${esc(msgUrl)}" style="display:inline-block;background:#c9a96e;color:#070707;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none;">Open Messages</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid rgba(240,237,230,0.08);">
        <p style="margin:0;font-size:11px;color:rgba(240,237,230,0.28);line-height:1.6;">
          <a href="https://alittlesoundadvice.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">Sound Advice <span style="font-size:10px;">Vocal Studio</span></a>
          &middot;
          <a href="https://performers-lab.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">performers-lab.com</a><br>
          <a href="https://performers-lab.com/app/profile.html" style="color:rgba(240,237,230,0.28);text-decoration:none;">Manage notifications</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
