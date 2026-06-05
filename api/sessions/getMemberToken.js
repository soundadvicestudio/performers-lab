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

  const { eventId } = req.body || {};
  if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

  const { data: eventRows } = await supabaseRequest(
    'GET', `/rest/v1/events?id=eq.${eventId}&select=id,type,daily_room_url,status,member_id&limit=1`
  );
  const event = eventRows?.[0];
  if (!event) return res.status(400).json({ error: 'Event not found' });
  if (event.type !== 'private') return res.status(400).json({ error: 'Not a private session' });
  if (event.member_id !== caller.id) return res.status(403).json({ error: 'Not authorized for this session' });
  if (!event.daily_room_url) return res.status(400).json({ error: 'Room not yet created for this session' });
  if (event.status !== 'live') return res.status(400).json({ error: 'Session is not live' });

  const roomName = event.daily_room_url.split('/').pop();

  if (!process.env.DAILY_API_KEY) return res.status(500).json({ error: 'DAILY_API_KEY not configured' });

  const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { room_name: roomName, is_owner: false } }),
  });
  if (!tokenRes.ok) {
    console.error('[getMemberToken] Daily.co token error:', await tokenRes.text());
    return res.status(502).json({ error: 'Failed to create participant token' });
  }
  const { token: meetingToken } = await tokenRes.json();

  return res.status(200).json({ token: meetingToken, roomUrl: event.daily_room_url });
}
