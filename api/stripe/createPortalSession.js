import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customerId } = req.body;

  if (!customerId) {
    return res.status(400).json({ error: 'Missing customerId' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: 'https://performers-lab.com/app/membership.html',
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[createPortalSession]', err.message);
    return res.status(500).json({ error: 'Failed to create billing portal session' });
  }
}
