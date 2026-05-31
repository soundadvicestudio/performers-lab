// Direct REST API wrapper for Supabase — no @supabase/supabase-js client.
// The JS client initializes a WebSocket for Realtime on construction, which
// crashes in Vercel Node.js 20 serverless functions. Plain fetch avoids it.

const BASE = () => process.env.SUPABASE_URL;
const KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function supabaseRequest(method, path, body = null, extraHeaders = {}) {
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: {
      'apikey':        KEY(),
      'Authorization': `Bearer ${KEY()}`,
      'Content-Type':  'application/json',
      ...extraHeaders,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}
