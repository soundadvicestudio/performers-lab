import { supabaseRequest } from '../lib/supabaseAdmin.js';

const FALLBACK_SUBJECT = "Welcome to The Performer's Lab";
const FALLBACK_BODY = `<p>Hi {{display_name}},</p>
<p>Welcome to <strong>The Performer's Lab</strong>. Your account is now active.</p>
<p>Head to your <a href="https://performers-lab.com/app/dashboard.html">dashboard</a> to get started.</p>
<p>— Jonathan<br>Sound Advice Vocal Studio</p>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, displayName } = req.body || {};
  if (!userId || !displayName) {
    return res.status(400).json({ error: 'Missing required fields: userId, displayName' });
  }

  // 1. Fetch email template
  const { data: tplRows } = await supabaseRequest(
    'GET',
    '/rest/v1/email_templates?type=eq.welcome&select=subject,body&limit=1'
  );
  const tpl = Array.isArray(tplRows) && tplRows.length > 0 ? tplRows[0] : null;
  const rawSubject = tpl?.subject || FALLBACK_SUBJECT;
  const rawBody    = tpl?.body    || FALLBACK_BODY;

  // 2. Fetch user email from Auth admin API
  const { data: adminUser, ok: userOk } = await supabaseRequest(
    'GET',
    `/auth/v1/admin/users/${userId}`
  );
  if (!userOk || !adminUser?.email) {
    return res.status(404).json({ error: 'User not found or email unavailable' });
  }
  const recipientEmail = adminUser.email;

  // 3. Replace template tokens
  const vars = { display_name: displayName };
  const subject = replaceTokens(rawSubject, vars);
  const body    = replaceTokens(rawBody, vars);

  // 4. Build branded email HTML
  const html = buildEmailHtml(body);

  // 5. Send via Resend
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: "The Performer's Lab <notifications@performers-lab.com>",
      to: recipientEmail,
      subject,
      html,
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    return res.status(500).json({ error: 'Email delivery failed', detail });
  }

  return res.status(200).json({ success: true });
}

function replaceTokens(str, vars) {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

function buildEmailHtml(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070707;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#070707;padding:48px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:600px;background:#0d0d0d;border-radius:8px;border:1px solid rgba(201,169,110,0.28);overflow:hidden;">

      <!-- Gold header bar -->
      <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#c9a96e,transparent);"></td></tr>

      <!-- Header -->
      <tr><td style="padding:28px 36px 20px;border-bottom:1px solid rgba(240,237,230,0.08);">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;color:#f0ede6;letter-spacing:0.04em;">
          The Performer's <span style="color:#c9a96e;">Lab</span>
        </p>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px 36px;font-size:15px;color:#f0ede6;line-height:1.75;font-weight:300;">
        ${bodyContent}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 36px;border-top:1px solid rgba(240,237,230,0.08);">
        <p style="margin:0;font-size:11px;color:rgba(240,237,230,0.28);line-height:1.6;">
          <a href="https://alittlesoundadvice.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">Sound Advice <span style="font-size:10px;">Vocal Studio</span></a>
          &nbsp;&middot;&nbsp;
          <a href="https://performers-lab.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">performers-lab.com</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
