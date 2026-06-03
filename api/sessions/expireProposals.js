import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Any proposal where the requested slot is now in the past is definitely expired
  const now = new Date().toISOString();
  const { data: expiredOrders } = await supabaseRequest(
    'GET',
    `/rest/v1/service_orders?proposal_status=eq.pending&proposed_slot_start=lt.${now}&select=id,member_id,session_duration_minutes`
  );

  const orders = expiredOrders || [];
  let expiredCount = 0;

  for (const order of orders) {
    await supabaseRequest('PATCH', `/rest/v1/service_orders?id=eq.${order.id}`, {
      proposal_status: 'expired',
    });

    const { data: profData } = await supabaseRequest(
      'GET', `/rest/v1/profiles?user_id=eq.${order.member_id}&select=display_name&limit=1`
    );
    const displayName = profData?.[0]?.display_name || 'Member';

    await supabaseRequest('POST', '/rest/v1/notifications', {
      user_id: order.member_id,
      type: 'proposal_expired',
      title: 'Session proposal expired',
      body: 'A proposed session time has expired. Jonathan will be in touch to find a new time.',
      link: '/app/services.html?tab=orders',
      read: false,
    });

    await supabaseRequest('POST', '/rest/v1/notifications', {
      user_id: ADMIN_ID,
      type: 'proposal_expired',
      title: 'Session proposal expired',
      body: `${displayName}'s session proposal expired. Follow up to reschedule.`,
      link: '/admin',
      read: false,
    });

    expiredCount++;
  }

  return res.status(200).json({ ok: true, expired: expiredCount });
}
