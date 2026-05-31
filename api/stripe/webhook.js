import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Verify Stripe signature against the raw request body
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId            = session.client_reference_id;
        const stripeCustomerId  = session.customer;
        const stripeSubId       = session.subscription;
        const priceId           = session.metadata?.price_id;
        const discountCodeDbId  = session.metadata?.discount_code_id;

        const plan = priceId === process.env.STRIPE_FOUNDING_PRICE_ID ? 'founding' : 'standard';

        await supabase
          .from('memberships')
          .upsert(
            {
              user_id:                userId,
              status:                 'active',
              stripe_customer_id:     stripeCustomerId,
              stripe_subscription_id: stripeSubId,
              plan,
            },
            { onConflict: 'user_id' }
          );

        // Increment the discount code's uses_count if one was applied
        if (discountCodeDbId) {
          const { data: code } = await supabase
            .from('discount_codes')
            .select('uses_count')
            .eq('id', discountCodeDbId)
            .single();

          if (code) {
            await supabase
              .from('discount_codes')
              .update({ uses_count: code.uses_count + 1 })
              .eq('id', discountCodeDbId);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabase
          .from('memberships')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await supabase
          .from('memberships')
          .update({ status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer);
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] event processing error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
