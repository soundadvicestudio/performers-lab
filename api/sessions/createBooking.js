import Stripe from 'stripe';
import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';
const VIRTUAL_SESSION_ID = '920fec9d-03e5-4ade-9ddc-e5d225c354e2';

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
  const userId = caller.id;

  const { serviceId, duration: rawDuration, slotStart, slotEnd, goals, repertoire, focusAreas, usingCredit, useCreditId } = req.body || {};
  const duration = useCreditId ? 30 : rawDuration;

  // Validate
  if (serviceId !== VIRTUAL_SESSION_ID) {
    return res.status(400).json({ error: 'Invalid service' });
  }
  if (duration !== 30 && duration !== 60) {
    return res.status(400).json({ error: 'Duration must be 30 or 60' });
  }
  if (!slotStart || !slotEnd) {
    return res.status(400).json({ error: 'Missing slotStart or slotEnd' });
  }
  const slotStartMs = new Date(slotStart).getTime();
  if (isNaN(slotStartMs)) {
    return res.status(400).json({ error: 'Invalid slotStart datetime' });
  }
  if (slotStartMs < Date.now() + 24 * 3600 * 1000) {
    return res.status(400).json({ error: 'Sessions must be booked at least 24 hours in advance.' });
  }

  // Conflict check
  const { data: existingOrders } = await supabaseRequest(
    'GET',
    `/rest/v1/service_orders?service_id=eq.${VIRTUAL_SESSION_ID}&status=not.in.(cancelled)&proposed_slot_start=not.is.null&select=proposed_slot_start,proposed_slot_end`
  );
  const newStart = new Date(slotStart).getTime();
  const newEnd = new Date(slotEnd).getTime();
  const bufMs = 30 * 60 * 1000;
  for (const order of (existingOrders || [])) {
    const exStart = new Date(order.proposed_slot_start).getTime();
    const exEnd = new Date(order.proposed_slot_end).getTime();
    if (newStart < exEnd + bufMs && newEnd > exStart) {
      return res.status(400).json({ error: 'This time slot is no longer available.' });
    }
  }

  // Fetch member display_name for notification
  const { data: profiles } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${userId}&select=display_name`
  );
  const displayName = profiles?.[0]?.display_name || 'A member';

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(slotStart)) + ' CT';

  const notes = `Goals: ${goals}\n\nRepertoire: ${repertoire}\n\nFocus: ${focusAreas}`;

  // ── Credit path ─────────────────────────────────────────────────────────────
  if (useCreditId || usingCredit === true) {
    let creditId;
    if (useCreditId) {
      const { data: creditRows } = await supabaseRequest(
        'GET',
        `/rest/v1/session_credits?id=eq.${useCreditId}&member_id=eq.${userId}&used=eq.false&select=id&limit=1`
      );
      if (!creditRows || !creditRows.length) {
        return res.status(400).json({ error: 'Session credit not available.' });
      }
      creditId = creditRows[0].id;
    } else {
      const today = new Date();
      const billingPeriodStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      const { data: credits } = await supabaseRequest(
        'GET',
        `/rest/v1/session_credits?member_id=eq.${userId}&used=eq.false&billing_period_start=eq.${billingPeriodStart}&select=id&limit=1`
      );
      if (!credits || !credits.length) {
        return res.status(400).json({ error: 'No session credit available.' });
      }
      creditId = credits[0].id;
    }

    const insertRes = await supabaseRequest('POST', '/rest/v1/service_orders', {
      service_id: serviceId,
      member_id: userId,
      status: 'pending_approval',
      cancellation_policy_agreed: true,
      session_duration_minutes: duration,
      proposed_slot_start: slotStart,
      proposed_slot_end: slotEnd,
      expedited: false,
      notes,
    }, { 'Prefer': 'return=representation' });

    if (!insertRes.ok) {
      console.error('[createBooking] order insert failed:', JSON.stringify(insertRes.data));
      return res.status(500).json({ error: 'Failed to create booking.' });
    }
    const orderId = insertRes.data?.[0]?.id;

    await supabaseRequest('PATCH', `/rest/v1/session_credits?id=eq.${creditId}`, {
      used: true,
      used_order_id: orderId,
    });

    await supabaseRequest('POST', '/rest/v1/notifications', {
      user_id: ADMIN_ID,
      type: 'new_session_request',
      title: 'New session booking request',
      body: `${displayName} requested a ${duration}-min session on ${formattedDate}`,
      link: '/admin',
      read: false,
    });

    return res.status(200).json({ ok: true, orderId });
  }

  // ── Stripe checkout path ─────────────────────────────────────────────────────
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env.STRIPE_SVC_COACHING_PRICE_ID, quantity: 1 }],
      success_url: 'https://performers-lab.com/app/checkout-success.html?type=session&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://performers-lab.com/app/services.html',
      metadata: {
        serviceId,
        memberId: userId,
        duration: String(duration),
        slotStart,
        slotEnd,
        goals,
        repertoire,
        focusAreas,
        orderType: 'session',
      },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[createBooking] stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
