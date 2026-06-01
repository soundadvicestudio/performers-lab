import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

const PRICE_MAP = {
  '307638c7-2c0a-4cdc-a881-b28282488e93': {
    standard: process.env.STRIPE_SVC_AUDITION_PRICE_ID,
    expedited: process.env.STRIPE_SVC_AUDITION_EXP_PRICE_ID,
  },
  'd1a82e91-9c7e-4161-8b6f-56e230ed0cb7': {
    standard: process.env.STRIPE_SVC_SHEETMUSIC_PRICE_ID,
    expedited: process.env.STRIPE_SVC_SHEETMUSIC_EXP_PRICE_ID,
  },
  '5602aaf2-fcfe-46cc-b14e-35cf35022132': {
    standard: process.env.STRIPE_SVC_ACCOMPANIMENT_PRICE_ID,
    expedited: process.env.STRIPE_SVC_ACCOMPANIMENT_EXP_PRICE_ID,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Verify JWT
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  const user = await userRes.json();

  const { serviceId, expedited, notes, referenceFileUrl, referenceDriveUrl } = req.body;

  if (!serviceId) return res.status(400).json({ error: 'Missing serviceId' });

  const prices = PRICE_MAP[serviceId];
  if (!prices) return res.status(400).json({ error: 'Invalid service' });

  // Validate service exists, is active, and is a deliverable
  const { data: services } = await supabaseRequest(
    'GET',
    `/rest/v1/services?id=eq.${serviceId}&active=eq.true&type=eq.deliverable&select=id`
  );
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'Service not available' });
  }

  const priceId = expedited ? prices.expedited : prices.standard;
  if (!priceId) return res.status(400).json({ error: 'Price not configured' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://performers-lab.com/app/checkout-success.html?type=service&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://performers-lab.com/app/services.html',
      metadata: {
        serviceId,
        memberId: user.id,
        expedited: String(Boolean(expedited)),
        notes: notes || '',
        referenceFileUrl: referenceFileUrl || '',
        referenceDriveUrl: referenceDriveUrl || '',
      },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[services/createCheckout]', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
