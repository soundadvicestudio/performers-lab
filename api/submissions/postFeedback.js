import { supabaseRequest } from '../lib/supabaseAdmin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { admin_user_id, submission_id, content, is_edit } = req.body || {};

  if (!admin_user_id || !submission_id || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!UUID_RE.test(admin_user_id) || !UUID_RE.test(submission_id)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  // ── Verify admin ───────────────────────────────────────────────────────
  const { data: profileRows } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${admin_user_id}&select=is_admin&limit=1`
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (!profile?.is_admin) return res.status(403).json({ error: 'Not authorized' });

  // ── Load submission ────────────────────────────────────────────────────
  const { data: subRows } = await supabaseRequest(
    'GET',
    `/rest/v1/submissions?id=eq.${submission_id}&select=*&limit=1`
  );
  const submission = Array.isArray(subRows) ? subRows[0] : null;
  if (!submission) return res.status(404).json({ error: 'Submission not found' });

  // ── Edit existing feedback ─────────────────────────────────────────────
  if (is_edit) {
    const { ok } = await supabaseRequest(
      'PATCH',
      `/rest/v1/feedback?submission_id=eq.${submission_id}`,
      { content }
    );
    if (!ok) return res.status(500).json({ error: 'Failed to update feedback' });
    return res.status(200).json({ success: true, action: 'updated' });
  }

  // ── Insert new feedback ────────────────────────────────────────────────
  const { data: feedbackRows, ok: insertOk } = await supabaseRequest(
    'POST',
    '/rest/v1/feedback?select=id',
    { submission_id, coach_id: admin_user_id, content },
    { 'Prefer': 'return=representation' }
  );
  if (!insertOk) return res.status(500).json({ error: 'Failed to save feedback' });
  const feedbackId = Array.isArray(feedbackRows) ? feedbackRows[0]?.id : null;

  // ── Update submission status ───────────────────────────────────────────
  await supabaseRequest(
    'PATCH',
    `/rest/v1/submissions?id=eq.${submission_id}`,
    { status: 'Feedback Given' }
  );

  // ── In-app notification ────────────────────────────────────────────────
  await supabaseRequest('POST', '/rest/v1/notifications', {
    user_id: submission.member_id,
    type: 'new_feedback',
    title: 'Your coaching feedback is ready',
    body: `Feedback for "${submission.song_title}" has been posted.`,
    link: `/app/submission.html?id=${submission_id}`,
    read: false,
  });

  // ── Email notification ─────────────────────────────────────────────────
  const { data: memberAuth } = await supabaseRequest(
    'GET',
    `/auth/v1/admin/users/${submission.member_id}`
  );
  const memberEmail = memberAuth?.email;

  if (memberEmail) {
    const emailHtml = buildEmailHtml(submission.song_title, submission_id);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "The Performer's Lab <notifications@performers-lab.com>",
        to: memberEmail,
        subject: "Your coaching feedback is ready — The Performer's Lab",
        html: emailHtml,
      }),
    });
  }

  return res.status(200).json({ success: true, action: 'created', feedbackId });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildEmailHtml(songTitle, submissionId) {
  const viewUrl = `https://performers-lab.com/app/submission.html?id=${submissionId}`;
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
        <h2 style="margin:8px 0 0;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#c9a96e;">Your feedback is ready</h2>
      </td></tr>
      <tr><td style="padding:28px 36px;font-size:15px;color:#f0ede6;line-height:1.75;font-weight:300;">
        <p style="margin:0 0 16px;">Your coaching feedback for <strong style="color:#f0ede6;">${esc(songTitle)}</strong> has been posted.</p>
        <p style="margin:0;">Head to The Performer's Lab to read your personalized notes and put them to work.</p>
      </td></tr>
      <tr><td style="padding:0 36px 28px;">
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${viewUrl}"
             style="display:inline-block;background:#c9a96e;color:#070707;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none;">
            Read My Feedback →
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
