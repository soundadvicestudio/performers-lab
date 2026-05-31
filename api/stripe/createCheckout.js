import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { priceId, discountCode, userId, email } = req.body;

  if (!priceId || !userId || !email) {
    return res.status(400).json({ error: 'Missing required fields: priceId, userId, email' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    let couponId = null;
    let discountCodeDbId = null;

    if (discountCode) {
      const { data: codes } = await supabaseRequest(
        'GET',
        `/rest/v1/discount_codes?code=eq.${encodeURIComponent(discountCode)}&active=eq.true&select=id,discount_type,amount,max_uses,uses_count,expires_at`
      );

      const code = Array.isArray(codes) && codes.length > 0 ? codes[0] : null;

      const valid =
        code &&
        (code.expires_at === null || new Date(code.expires_at) > new Date()) &&
        (code.max_uses === null || code.uses_count < code.max_uses);

      if (!valid) {
        return res.status(400).json({ error: 'Invalid or expired discount code' });
      }

      const couponParams =
        code.discount_type === 'percent'
          ? { percent_off: code.amount, duration: 'forever' }
          : { amount_off: Math.round(code.amount * 100), currency: 'usd', duration: 'once' };

      const coupon = await stripe.coupons.create(couponParams);
      couponId = coupon.id;
      discountCodeDbId = code.id;
    }

    const metadata = { price_id: priceId };
    if (discountCodeDbId) metadata.discount_code_id = discountCodeDbId;

    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId,
      success_url: 'https://performers-lab.com/app/checkout-success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://performers-lab.com/app/checkout.html',
      metadata,
    };

    if (couponId) {
      sessionParams.discounts = [{ coupon: couponId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[createCheckout]', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
