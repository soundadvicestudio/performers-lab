import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_SERVICE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[services/webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;

  // Guard: not a service, quote, or session checkout
  if (!session.metadata?.serviceId && !session.metadata?.quoteId) {
    return res.status(200).json({ received: true });
  }

  // ── Quote accepted ─────────────────────────────────────────────────────────
  if (session.metadata?.quoteId && !session.metadata?.serviceId) {
    try {
      const { quoteId } = session.metadata;

      await supabaseRequest(
        'PATCH',
        `/rest/v1/service_quotes?id=eq.${quoteId}`,
        {
          status: 'accepted',
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
        }
      );

      await supabaseRequest('POST', '/rest/v1/notifications', {
        user_id: ADMIN_ID,
        type: 'quote_accepted',
        title: 'Quote accepted',
        body: 'A member accepted your quote and payment was received.',
        link: '/admin',
        read: false,
      });

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[services/webhook] quote processing error:', err.message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ── Session booking ────────────────────────────────────────────────────────
  if (session.metadata?.orderType === 'session') {
    try {
      const { serviceId, memberId, duration, slotStart, slotEnd, goals, repertoire, focusAreas } = session.metadata;

      const { data: profiles } = await supabaseRequest(
        'GET',
        `/rest/v1/profiles?user_id=eq.${memberId}&select=display_name`
      );
      const displayName = profiles?.[0]?.display_name || 'A member';

      const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${memberId}`, {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      const { email: memberEmail } = await emailRes.json();

      const formattedDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(slotStart)) + ' CT';

      await supabaseRequest('POST', '/rest/v1/service_orders', {
        service_id: serviceId,
        member_id: memberId,
        status: 'pending_approval',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent,
        cancellation_policy_agreed: true,
        session_duration_minutes: parseInt(duration, 10),
        proposed_slot_start: slotStart,
        proposed_slot_end: slotEnd,
        expedited: false,
        notes: `Goals: ${goals}\n\nRepertoire: ${repertoire}\n\nFocus: ${focusAreas}`,
      });

      await supabaseRequest('POST', '/rest/v1/notifications', {
        user_id: ADMIN_ID,
        type: 'new_session_request',
        title: 'New session booking request',
        body: `${displayName} requested a ${duration}-min session on ${formattedDate}`,
        link: '/admin',
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
            subject: `Session booking received — ${formattedDate}`,
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
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">Session Request Received</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Your booking request for a <strong style="color:#f0ede6;font-weight:600;">${duration}-minute coaching session</strong> on <strong style="color:#f0ede6;font-weight:600;">${formattedDate}</strong> has been received.</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Jonathan will confirm your session within 24 hours. You'll receive an email and notification when it's confirmed.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/services.html?tab=orders"
                 style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                View My Orders →
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
</html>`,
          }),
        });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[services/webhook] session processing error:', err.message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ── Service order ──────────────────────────────────────────────────────────
  try {
    const { serviceId, memberId, expedited, notes, referenceFileUrl, referenceDriveUrl } = session.metadata;

    // Fetch service name
    const { data: services } = await supabaseRequest(
      'GET',
      `/rest/v1/services?id=eq.${serviceId}&select=name`
    );
    const serviceName = services?.[0]?.name || 'Service';

    // Fetch member display_name
    const { data: profiles } = await supabaseRequest(
      'GET',
      `/rest/v1/profiles?user_id=eq.${memberId}&select=display_name`
    );
    const displayName = profiles?.[0]?.display_name || 'A member';

    // Fetch member email
    const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${memberId}`, {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    const { email: memberEmail } = await emailRes.json();

    const isExpedited = expedited === 'true';

    // INSERT service_orders
    await supabaseRequest('POST', '/rest/v1/service_orders', {
      service_id: serviceId,
      member_id: memberId,
      status: 'pending_approval',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      cancellation_policy_agreed: true,
      reference_file_url: referenceFileUrl || null,
      reference_drive_url: referenceDriveUrl || null,
      expedited: isExpedited,
      notes: notes || null,
    });

    // Notify admin
    await supabaseRequest('POST', '/rest/v1/notifications', {
      user_id: ADMIN_ID,
      type: 'new_service_order',
      title: 'New service order',
      body: `${displayName} ordered ${serviceName}`,
      link: '/admin',
      read: false,
    });

    // Send confirmation email to member
    if (memberEmail) {
      const turnaroundLine = isExpedited
        ? 'Expedited turnaround selected — your order will be delivered within 4 days.'
        : 'Standard turnaround — your order will be delivered within 7 days.';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'The Performer\'s Lab <notifications@performers-lab.com>',
          to: [memberEmail],
          subject: `Your order has been received — ${serviceName}`,
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
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">Order Received</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Your order for <strong style="color:#f0ede6;font-weight:600;">${serviceName}</strong> has been received.</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">${turnaroundLine}</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">We'll be in touch if we need anything from you. You can track your order status at <a href="https://performers-lab.com/app/my-orders.html" style="color:#c9a96e;text-decoration:none;">performers-lab.com/app/my-orders.html</a>.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/my-orders.html"
                 style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                View My Orders →
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
</html>`,
        }),
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[services/webhook] processing error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
