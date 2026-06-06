import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

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

  const { direction } = req.body || {};
  if (direction !== 'upgrade' && direction !== 'downgrade') {
    return res.status(400).json({ error: 'direction must be upgrade or downgrade' });
  }

  const { data: memberships } = await supabaseRequest(
    'GET',
    `/rest/v1/memberships?user_id=eq.${caller.id}&select=stripe_subscription_id,plan&limit=1`
  );
  const membership = memberships?.[0];
  if (!membership?.stripe_subscription_id) {
    return res.status(400).json({ error: 'No active subscription found' });
  }

  if (direction === 'upgrade' && membership.plan === 'premium') {
    return res.status(400).json({ error: 'Already on Premium' });
  }
  if (direction === 'downgrade' && membership.plan !== 'premium') {
    return res.status(400).json({ error: 'Not on Premium' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscription = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);
  const itemId = subscription.items?.data?.[0]?.id;
  if (!itemId) return res.status(500).json({ error: 'Could not find subscription item' });

  const targetPriceId = direction === 'upgrade'
    ? process.env.STRIPE_PREMIUM_PRICE_ID
    : process.env.STRIPE_STANDARD_PRICE_ID;

  if (!targetPriceId) return res.status(500).json({ error: 'Target price not configured' });

  const updateParams = direction === 'upgrade'
    ? {
        items: [{ id: itemId, price: targetPriceId }],
        proration_behavior: 'always_invoice',
      }
    : {
        items: [{ id: itemId, price: targetPriceId }],
        proration_behavior: 'none',
        cancel_at_period_end: false,
      };

  await stripe.subscriptions.update(membership.stripe_subscription_id, updateParams);

  return res.status(200).json({
    success: true,
    effective: direction === 'upgrade' ? 'immediate' : 'period_end',
  });
}
