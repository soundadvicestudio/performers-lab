import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

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
        const session       = event.data.object;
        const userId        = session.client_reference_id;
        const stripeCustomerId  = session.customer;
        const stripeSubId   = session.subscription;
        const priceId       = session.metadata?.price_id;
        const discountCodeDbId = session.metadata?.discount_code_id;

        const plan = priceId === process.env.STRIPE_FOUNDING_PRICE_ID ? 'founding' : 'standard';

        await supabaseRequest(
          'POST',
          '/rest/v1/memberships?on_conflict=user_id',
          {
            user_id:                userId,
            status:                 'active',
            stripe_customer_id:     stripeCustomerId,
            stripe_subscription_id: stripeSubId,
            plan,
          },
          { 'Prefer': 'resolution=merge-duplicates' }
        );

        // Increment the discount code's uses_count if one was applied
        if (discountCodeDbId) {
          const { data: codes } = await supabaseRequest(
            'GET',
            `/rest/v1/discount_codes?id=eq.${discountCodeDbId}&select=uses_count`
          );
          const code = codes?.[0];
          if (code) {
            await supabaseRequest(
              'PATCH',
              `/rest/v1/discount_codes?id=eq.${discountCodeDbId}`,
              { uses_count: code.uses_count + 1 }
            );
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('[webhook] subscription.updated sub_id:', subscription.id);
        console.log('[webhook] cancel_at_period_end:', subscription.cancel_at_period_end);
        if (subscription.cancel_at_period_end) {
          const patchResult = await supabaseRequest(
            'PATCH',
            `/rest/v1/memberships?stripe_subscription_id=eq.${subscription.id}`,
            {
              status:    'cancelling',
              cancel_at: subscription.cancel_at
                ? new Date(subscription.cancel_at * 1000).toISOString()
                : null,
            }
          );
          console.log('[webhook] patch response:', JSON.stringify(patchResult));
        } else {
          const patchResult = await supabaseRequest(
            'PATCH',
            `/rest/v1/memberships?stripe_subscription_id=eq.${subscription.id}`,
            { status: 'active', cancel_at: null }
          );
          console.log('[webhook] patch response:', JSON.stringify(patchResult));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabaseRequest(
          'PATCH',
          `/rest/v1/memberships?stripe_subscription_id=eq.${subscription.id}`,
          { status: 'cancelled' }
        );
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await supabaseRequest(
          'PATCH',
          `/rest/v1/memberships?stripe_customer_id=eq.${invoice.customer}`,
          { status: 'past_due' }
        );
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
