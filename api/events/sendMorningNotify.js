import { supabaseRequest } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

    const { data: events } = await supabaseRequest(
      'GET',
      `/rest/v1/events?starts_at=gte.${encodeURIComponent(now.toISOString())}&starts_at=lte.${encodeURIComponent(windowEnd)}&morning_notify_sent=eq.false&status=eq.upcoming&select=*`
    );

    if (!events?.length) {
      return res.status(200).json({ message: 'No events today' });
    }

    let eventsProcessed = 0;
    let totalMembersNotified = 0;
    let totalEmailsSent = 0;

    for (const event of events) {
      // Fetch only members who RSVPed AND enabled Notify Me
      const { data: rsvps } = await supabaseRequest(
        'GET',
        `/rest/v1/event_rsvps?event_id=eq.${event.id}&notify=eq.true&select=user_id`
      );

      if (!rsvps?.length) {
        await supabaseRequest('PATCH', `/rest/v1/events?id=eq.${event.id}`, { morning_notify_sent: true });
        eventsProcessed++;
        continue;
      }

      const userIds = rsvps.map(r => r.user_id).join(',');
      const { data: profiles } = await supabaseRequest(
        'GET',
        `/rest/v1/profiles?user_id=in.(${userIds})&select=user_id,email_notify_events,timezone,display_name`
      );
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.user_id] = p; });

      for (const rsvp of rsvps) {
        const member = profileMap[rsvp.user_id];
        if (!member) continue;

        // Always send in-platform notification
        try {
          await supabaseRequest('POST', '/rest/v1/notifications', {
            user_id: member.user_id,
            type: 'event_morning',
            title: `Today: ${event.title}`,
            body: 'Your session is today. Get ready!',
            link: `/app/event.html?id=${event.id}`,
            read: false,
          });
          totalMembersNotified++;
        } catch (err) {
          console.error(`Failed to send morning notification to ${member.user_id}:`, err);
        }

        // Email — skipped only if explicitly opted out
        if (member.email_notify_events !== false) {
          try {
            const { data: authUser } = await supabaseRequest(
              'GET',
              `/auth/v1/admin/users/${member.user_id}`
            );
            const email = authUser?.email;
            if (email) {
              const ctTime = formatCT(event.starts_at);
              const localLine = member.timezone && member.timezone !== 'America/Chicago'
                ? `That's ${formatLocal(event.starts_at, member.timezone)} your time.`
                : null;
              const html = buildMorningEmail(
                member.display_name || 'there',
                event.title,
                ctTime,
                localLine,
                event.id
              );
              const resendRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: "The Performer's Lab <notifications@performers-lab.com>",
                  to: email,
                  subject: `Today: ${event.title}`,
                  html,
                }),
              });
              if (resendRes.ok) totalEmailsSent++;
              await new Promise(r => setTimeout(r, 50));
            }
          } catch (err) {
            console.error(`Failed to send morning email to ${member.user_id}:`, err);
          }
        }
      }

      await supabaseRequest('PATCH', `/rest/v1/events?id=eq.${event.id}`, { morning_notify_sent: true });
      eventsProcessed++;
    }

    return res.status(200).json({
      processed: eventsProcessed,
      notified: totalMembersNotified,
      emailsSent: totalEmailsSent,
    });
  } catch (err) {
    console.error('sendMorningNotify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function formatCT(isoString) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(isoString)) + ' CT';
}

function formatLocal(isoString, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  }).format(new Date(isoString));
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMorningEmail(displayName, eventTitle, ctTime, localLine, eventId) {
  const joinUrl = `https://performers-lab.com/app/event.html?id=${eventId}`;
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
        <h2 style="margin:8px 0 0;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#c9a96e;">It's session day, ${esc(displayName)}.</h2>
      </td></tr>
      <tr><td style="padding:28px 36px;font-size:15px;color:#f0ede6;line-height:1.75;font-weight:300;">
        <p style="margin:0 0 12px;"><strong style="color:#f0ede6;">${esc(eventTitle)}</strong> is today at ${esc(ctTime)}.</p>
        ${localLine ? `<p style="margin:0 0 12px;color:rgba(240,237,230,0.58);font-size:14px;">${esc(localLine)}</p>` : ''}
        <p style="margin:0;">We'll see you there.</p>
      </td></tr>
      <tr><td style="padding:0 36px 28px;">
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${joinUrl}" style="display:inline-block;background:#c9a96e;color:#070707;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none;">Join the Session →</a>
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
