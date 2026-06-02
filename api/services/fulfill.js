import { supabaseRequest } from '../lib/supabaseAdmin.js';

const ADMIN_ID = '6abb9d4d-ed5f-456e-aebb-aa76c8696c44';

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
  const caller = await userRes.json();

  // Admin check
  const { data: adminCheck } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${caller.id}&select=is_admin`
  );
  if (!adminCheck?.[0]?.is_admin) {
    return res.status(403).json({ error: 'Forbidden — admin only' });
  }

  // Parse JSON body (file already uploaded to storage client-side)
  const { orderId, fileUrl, fileName, deliveryUrl, notes } = req.body || {};

  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
  if (!fileUrl && !deliveryUrl) {
    return res.status(400).json({ error: 'Please provide a file or delivery link' });
  }

  // Validate order
  const { data: orders } = await supabaseRequest(
    'GET',
    `/rest/v1/service_orders?id=eq.${orderId}&select=id,service_id,member_id,status`
  );
  const order = orders?.[0];
  if (!order) return res.status(400).json({ error: 'Order not found' });
  if (order.status === 'fulfilled' || order.status === 'cancelled') {
    return res.status(400).json({ error: `Order already ${order.status}` });
  }

  const memberId = order.member_id;

  // Fetch service name
  const { data: services } = await supabaseRequest(
    'GET',
    `/rest/v1/services?id=eq.${order.service_id}&select=name`
  );
  const serviceName = services?.[0]?.name || 'Service';

  // Fetch member display_name
  const { data: profiles } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${memberId}&select=display_name`
  );
  const displayName = profiles?.[0]?.display_name || 'Member';

  // Fetch member email
  const emailRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${memberId}`, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const { email: memberEmail } = await emailRes.json();

  // INSERT service_deliveries (file already in storage — just record the path)
  console.log('[fulfill] inserting service_deliveries for order', orderId, { fileUrl, fileName, deliveryUrl, notes });
  const deliveryInsert = await supabaseRequest('POST', '/rest/v1/service_deliveries', {
    order_id: orderId,
    file_url: fileUrl || null,
    file_name: fileName || null,
    delivery_url: deliveryUrl || null,
    notes: notes || null,
    fulfilled_by: ADMIN_ID,
  }, { 'Prefer': 'return=representation' });
  console.log('delivery INSERT result:', JSON.stringify(deliveryInsert));

  if (!deliveryInsert.ok) {
    console.error('delivery INSERT failed:', JSON.stringify(deliveryInsert.data));
    return res.status(500).json({
      error: 'Failed to create delivery record',
      detail: deliveryInsert.data,
    });
  }

  // PATCH service_orders status
  await supabaseRequest(
    'PATCH',
    `/rest/v1/service_orders?id=eq.${orderId}`,
    { status: 'fulfilled' }
  );

  // Notify member
  await supabaseRequest('POST', '/rest/v1/notifications', {
    user_id: memberId,
    type: 'order_fulfilled',
    title: 'Your order is ready',
    body: `Your ${serviceName} has been delivered. Download it from My Orders.`,
    link: '/app/my-orders.html',
    read: false,
  });

  // Email member
  if (memberEmail) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "The Performer's Lab <notifications@performers-lab.com>",
        to: [memberEmail],
        subject: `Your order is ready — ${serviceName}`,
        html: buildFulfillmentEmail(displayName, serviceName),
      }),
    });
  }

  return res.status(200).json({ ok: true });
}

function buildFulfillmentEmail(displayName, serviceName) {
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
            <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:#f0ede6;letter-spacing:0.02em;">Your Order Is Ready</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Your <strong style="color:#f0ede6;font-weight:600;">${serviceName}</strong> is complete and ready to access.</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(240,237,230,0.85);line-height:1.7;font-weight:300;">Log in to your account and visit My Orders to access your delivery.</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="https://performers-lab.com/app/my-orders.html"
                 style="display:inline-block;background:#c9a96e;color:#070707;text-decoration:none;padding:12px 28px;border-radius:2px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                View My Orders →
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
