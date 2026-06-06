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

        const priceId = subscription.items?.data?.[0]?.price?.id;
        let planPatch = {};
        if (priceId === process.env.STRIPE_FOUNDING_PRICE_ID) planPatch = { plan: 'founding' };
        else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID) planPatch = { plan: 'standard' };
        else if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID) planPatch = { plan: 'premium' };

        if (subscription.cancel_at_period_end) {
          const patchResult = await supabaseRequest(
            'PATCH',
            `/rest/v1/memberships?stripe_subscription_id=eq.${subscription.id}`,
            {
              status:    'cancelling',
              cancel_at: subscription.cancel_at
                ? new Date(subscription.cancel_at * 1000).toISOString()
                : null,
              ...planPatch,
            }
          );
          console.log('[webhook] patch response:', JSON.stringify(patchResult));
        } else {
          const patchResult = await supabaseRequest(
            'PATCH',
            `/rest/v1/memberships?stripe_subscription_id=eq.${subscription.id}`,
            { status: 'active', cancel_at: null, ...planPatch }
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

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const priceId = subscription.items?.data?.[0]?.price?.id;
        if (priceId !== process.env.STRIPE_PREMIUM_PRICE_ID) break;

        const { data: memberships } = await supabaseRequest(
          'GET',
          `/rest/v1/memberships?stripe_customer_id=eq.${invoice.customer}&select=user_id&limit=1`
        );
        const memberId = memberships?.[0]?.user_id;
        if (!memberId) break;

        const periodStart = new Date(invoice.period_start * 1000);
        const billingPeriodStart = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}-01`;

        await supabaseRequest(
          'POST',
          '/rest/v1/session_credits?on_conflict=member_id,billing_period_start',
          { member_id: memberId, billing_period_start: billingPeriodStart, used: false, used_order_id: null },
          { 'Prefer': 'resolution=ignore-duplicates,return=representation' }
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
