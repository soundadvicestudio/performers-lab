// /api/env.js
// Serverless function that injects public env vars into the browser
// Called as <script src="/api/env"></script> in every app page
// Only exposes ANON key (safe) — never the service role key

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.__ENV__ = ${JSON.stringify({
    SUPABASE_URL:              process.env.SUPABASE_URL               || '',
    SUPABASE_ANON_KEY:         process.env.SUPABASE_ANON_KEY          || '',
    STRIPE_PUBLISHABLE_KEY:    process.env.STRIPE_PUBLISHABLE_KEY     || '',
    STRIPE_FOUNDING_PRICE_ID:  process.env.STRIPE_FOUNDING_PRICE_ID  || '',
    STRIPE_STANDARD_PRICE_ID:  process.env.STRIPE_STANDARD_PRICE_ID  || '',
    PREMIUM_ENABLED:           process.env.PREMIUM_ENABLED            || 'false',
  })};`);
}
