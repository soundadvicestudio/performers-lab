import { supabaseRequest } from '../lib/supabaseAdmin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { admin_user_id, event_id } = req.body || {};

  if (!admin_user_id || !event_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!UUID_RE.test(admin_user_id) || !UUID_RE.test(event_id)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  // ── Verify admin ───────────────────────────────────────────────────────
  const { data: profileRows } = await supabaseRequest(
    'GET',
    `/rest/v1/profiles?user_id=eq.${admin_user_id}&select=is_admin&limit=1`
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (!profile?.is_admin) return res.status(403).json({ error: 'Not authorized' });

  // ── Verify event exists ────────────────────────────────────────────────
  const { data: eventRows } = await supabaseRequest(
    'GET',
    `/rest/v1/events?id=eq.${event_id}&select=id,title,status&limit=1`
  );
  const event = Array.isArray(eventRows) ? eventRows[0] : null;
  if (!event) return res.status(404).json({ error: 'Event not found' });

  // ── Create Daily.co room ───────────────────────────────────────────────
  if (!process.env.DAILY_API_KEY) {
    return res.status(500).json({ error: 'DAILY_API_KEY is not configured' });
  }

  const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      privacy: 'public',
      properties: {
        enable_chat: false,
        enable_screenshare: true,
        start_video_off: false,
        start_audio_off: false,
      },
    }),
  });

  if (!dailyRes.ok) {
    const errText = await dailyRes.text();
    console.error('Daily.co error:', errText);
    return res.status(502).json({ error: 'Failed to create Daily.co room', details: errText });
  }

  const dailyData = await dailyRes.json();
  const room_url = dailyData.url;

  if (!room_url) {
    return res.status(502).json({ error: 'Daily.co did not return a room URL' });
  }

  // ── Generate host meeting token ────────────────────────────────────────
  let host_token = null;
  try {
    const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          room_name: dailyData.name,
          is_owner: true,
          enable_screenshare: true,
          start_video_off: false,
          start_audio_off: false,
        },
      }),
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      host_token = tokenData.token || null;
    } else {
      console.error('Daily.co meeting token error:', await tokenRes.text());
    }
  } catch (e) {
    console.error('Daily.co meeting token exception:', e.message);
  }

  // ── Update event row ───────────────────────────────────────────────────
  const { ok: patchOk } = await supabaseRequest(
    'PATCH',
    `/rest/v1/events?id=eq.${event_id}`,
    { daily_room_url: room_url, status: 'live' }
  );

  if (!patchOk) {
    return res.status(500).json({ error: 'Room created but failed to update event record' });
  }

  return res.status(200).json({ success: true, room_url, host_token });
}
