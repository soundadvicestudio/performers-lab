import { supabaseRequest } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  let warned = 0;
  let expired = 0;

  try {
    // ── Find quotes expiring within 24 hours (not yet warned) ─────────────────
    const { data: warningQuotes } = await supabaseRequest(
      'GET',
      `/rest/v1/service_quotes?status=eq.pending&expires_at=lte.${encodeURIComponent(in24h.toISOString())}&expires_at=gte.${encodeURIComponent(now.toISOString())}&expiry_warned=eq.false&select=*`
    );

    for (const quote of (warningQuotes || [])) {
      // Fetch member email
      const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${quote.member_id}`, {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      const { email: memberEmail } = await emailRes.json();

      // Fetch member display_name
      const { data: profiles } = await supabaseRequest(
        'GET',
        `/rest/v1/profiles?user_id=eq.${quote.member_id}&select=display_name`
      );
      const displayName = profiles?.[0]?.display_name || 'Member';

      // In-platform notification
      try {
        await supabaseRequest('POST', '/rest/v1/notifications', {
          user_id: quote.member_id,
          type: 'quote_expiring',
          title: 'Quote expiring soon',
          body: `Your quote for ${quote.title} expires in less than 24 hours.`,
          link: '/app/my-orders.html',
          read: false,
        });
      } catch (err) {
        console.error(`[quoteExpiry] notification failed for ${quote.member_id}:`, err.message);
      }

      // Email
      if (memberEmail) {
        try {
          const expiryFmt = new Date(quote.expires_at).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
          const priceDisplay = formatPriceCents(quote.price);
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: "The Performer's Lab <notifications@performers-lab.com>",
              to: [memberEmail],
              subject: `Your quote expires tomorrow — ${quote.title}`,
              html: buildExpiryEmail(displayName, quote.title, priceDisplay, expiryFmt),
            }),
          });
        } catch (err) {
          console.error(`[quoteExpiry] email failed for ${quote.member_id}:`, err.message);
        }
      }

      // Mark warned
      await supabaseRequest(
        'PATCH',
        `/rest/v1/service_quotes?id=eq.${quote.id}`,
        { expiry_warned: true }
      );
      warned++;
    }

    // ── Mark expired quotes ────────────────────────────────────────────────────
    const { data: expiredQuotes } = await supabaseRequest(
      'GET',
      `/rest/v1/service_quotes?status=eq.pending&expires_at=lte.${encodeURIComponent(now.toISOString())}&select=id`
    );

    for (const quote of (expiredQuotes || [])) {
      await supabaseRequest(
        'PATCH',
        `/rest/v1/service_quotes?id=eq.${quote.id}`,
        { status: 'expired' }
      );
      expired++;
    }

    return res.status(200).json({ ok: true, warned, expired });
  } catch (err) {
    console.error('[quoteExpiry] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function formatPriceCents(cents) {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? '$' + dollars : '$' + dollars.toFixed(2);
}

function buildExpiryEmail(displayName, title, priceDisplay, expiryFmt) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#070707;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#070707;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid rgba(201,169,110,0.28);border-radius:6px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid rgba(201,169,110,0.18);background:linear-gradient(180deg,rgba(201,169,110,0.08) 0%,transparent 100%);">
            <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9a96e;font-weight:600;">The Performer's Lab</p>
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">Your Quote Expires Tomorrow</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Your quote for <strong style="color:#f0ede6;font-weight:600;">${title}</strong> (${priceDisplay}) expires on ${expiryFmt}.</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Accept or decline it before it expires.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/my-orders.html"
                 style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                Review Your Quote →
              </a>
            </td></tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid rgba(240,237,230,0.06);">
            <p style="margin:0;font-size:12px;color:rgba(240,237,230,0.28);line-height:1.7;">
              <a href="https://alittlesoundadvice.com" style="color:rgba(240,237,230,0.28);text-decoration:none;">
                <strong style="font-weight:600;">Sound Advice</strong> <span style="font-size:11px;">Vocal Studio</span>
              </a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
