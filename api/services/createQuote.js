import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  const caller = await userRes.json();

  const { action } = req.body;

  if (action === 'send') return handleSend(req, res, caller);
  if (action === 'checkout') return handleCheckout(req, res, caller);
  return res.status(400).json({ error: 'Missing or invalid action. Must be "send" or "checkout".' });
}

// ── ADMIN SENDS A QUOTE ─────────────────────────────────────────────────────

async function handleSend(req, res, caller) {
  // Admin only
  const { data: adminCheck } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${caller.id}&select=is_admin`
  );
  if (!adminCheck?.[0]?.is_admin) {
    return res.status(403).json({ error: 'Forbidden — admin only' });
  }

  const { memberId, title, description, price, serviceId } = req.body;

  if (!memberId || !title || !description || !price) {
    return res.status(400).json({ error: 'Missing required fields: memberId, title, description, price' });
  }

  // Validate member exists
  const { data: memberProfiles } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${memberId}&select=display_name`
  );
  if (!memberProfiles?.length) return res.status(400).json({ error: 'Member not found' });
  const displayName = memberProfiles[0].display_name || 'Member';

  // Fetch member email
  const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${memberId}`, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const { email: memberEmail } = await emailRes.json();

  // Create Stripe price (audit trail — a price object exists in Stripe for this quote)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    await stripe.prices.create({
      unit_amount: Number(price),
      currency: 'usd',
      product: process.env.STRIPE_QUOTE_PRODUCT_ID,
    });
  } catch (err) {
    console.error('[createQuote/send] Stripe price create error:', err.message);
    return res.status(500).json({ error: 'Failed to create price' });
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

  // INSERT service_quotes
  const { ok: insertOk } = await supabaseRequest('POST', '/rest/v1/service_quotes', {
    member_id: memberId,
    sent_by: ADMIN_ID,
    service_id: serviceId || null,
    title,
    description,
    price: Number(price),
    status: 'pending',
    expires_at: expiresAt,
    expiry_warned: false,
  });
  if (!insertOk) return res.status(500).json({ error: 'Failed to save quote' });

  // Notify member
  await supabaseRequest('POST', '/rest/v1/notifications', {
    user_id: memberId,
    type: 'new_quote',
    title: 'You have a new quote',
    body: `Jonathan sent you a quote for ${title}. It expires in 14 days.`,
    link: '/app/my-orders.html',
    read: false,
  });

  // Email member
  if (memberEmail) {
    const expiry = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const priceDisplay = formatPriceCents(Number(price));
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "The Performer's Lab <notifications@performers-lab.com>",
        to: [memberEmail],
        subject: `You have a new quote — ${title}`,
        html: buildQuoteEmail(displayName, title, description, priceDisplay, expiry),
      }),
    });
  }

  return res.status(200).json({ ok: true });
}

// ── MEMBER ACCEPTS A QUOTE (GET CHECKOUT URL) ───────────────────────────────

async function handleCheckout(req, res, caller) {
  const { quoteId } = req.body;
  if (!quoteId) return res.status(400).json({ error: 'Missing quoteId' });

  // Fetch quote
  const { data: quotes } = await supabaseRequest(
    'GET',
    `/rest/v1/service_quotes?id=eq.${quoteId}&status=eq.pending&select=*`
  );
  const quote = quotes?.[0];
  if (!quote) return res.status(400).json({ error: 'Quote not found or not pending' });

  // Verify caller owns this quote
  if (quote.member_id !== caller.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Check not expired
  if (new Date(quote.expires_at) <= new Date()) {
    return res.status(400).json({ error: 'Quote has expired' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const dynamicPrice = await stripe.prices.create({
      unit_amount: Number(quote.price),
      currency: 'usd',
      product: process.env.STRIPE_QUOTE_PRODUCT_ID,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: dynamicPrice.id, quantity: 1 }],
      success_url: `https://performers-lab.com/app/checkout-success.html?type=quote&session_id={CHECKOUT_SESSION_ID}&quoteId=${quoteId}`,
      cancel_url: 'https://performers-lab.com/app/my-orders.html',
      metadata: {
        quoteId,
        memberId: caller.id,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[createQuote/checkout]', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function formatPriceCents(cents) {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? '$' + dollars : '$' + dollars.toFixed(2);
}

function buildQuoteEmail(displayName, title, description, priceDisplay, expiry) {
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
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">New Quote for You</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Jonathan sent you a quote for <strong style="color:#f0ede6;font-weight:600;">${title}</strong>.</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">${description}</p>
            <p style="margin:0 0 24px;font-size:18px;color:#c9a96e;font-weight:600;">${priceDisplay}</p>
            <p style="margin:0 0 24px;font-size:13px;color:rgba(240,237,230,0.55);font-weight:300;">This quote expires on ${expiry}.</p>
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
