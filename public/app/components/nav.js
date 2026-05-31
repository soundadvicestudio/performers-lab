const NAV_STYLES_ID = 'app-nav-styles';

function injectStyles() {
  if (document.getElementById(NAV_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = NAV_STYLES_ID;
  style.textContent = `
    .app-nav {
      position: sticky; top: 0; z-index: 100;
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 2.5rem; height: 56px;
      background: rgba(7,7,7,0.96); backdrop-filter: blur(12px);
      border-bottom: 0.5px solid var(--border);
    }
    .nav-brand {
      font-family: 'Cormorant Garamond', serif; font-size: 17px; font-weight: 400;
      color: var(--text); letter-spacing: 0.04em; text-decoration: none;
    }
    .nav-brand span { color: var(--gold); }
    .nav-right { display: flex; align-items: center; gap: 1.5rem; }
    .nav-greeting { font-size: 12px; color: var(--text-dim); font-weight: 300; }
    .nav-greeting strong { color: var(--text-muted); font-weight: 500; }
    .nav-signout {
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-dim); background: none; border: none; cursor: pointer;
      font-family: 'Raleway', sans-serif; font-weight: 600; transition: color 0.2s;
    }
    .nav-signout:hover { color: var(--gold); }
    .nav-admin-btn {
      font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--gold); border: 0.5px solid var(--border-gold);
      padding: 5px 12px; border-radius: 2px;
      font-family: 'Raleway', sans-serif; font-weight: 600;
      text-decoration: none; transition: all 0.2s;
    }
    .nav-admin-btn:hover { background: var(--gold-dim); border-color: var(--gold); }
    .nav-link {
      font-size: 11px; font-weight: 500; letter-spacing: 0.04em;
      color: var(--text-dim); text-decoration: none; transition: color 0.2s;
    }
    .nav-link:hover { color: var(--text); }
    @media (max-width: 600px) {
      .app-nav { padding: 0 1.25rem; }
      .nav-greeting { display: none; }
      .nav-link { display: none; }
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initNav(supabase, { userName, isAdmin }) {
  injectStyles();

  const container = document.getElementById('app-nav');
  if (!container) return;

  container.innerHTML = `
    <nav class="app-nav">
      <a href="/app/dashboard.html" class="nav-brand">The Performer's <span>Lab</span></a>
      <div class="nav-right">
        <div class="nav-greeting">Signed in as <strong id="nav-name">${escapeHtml(userName)}</strong></div>
        <a href="/app/profile.html" class="nav-link">Edit Profile</a>
        <a href="/app/membership.html" class="nav-link">Membership</a>
        <a href="/admin" class="nav-admin-btn"${isAdmin ? '' : ' style="display:none;"'}>Admin Panel</a>
        <button class="nav-signout" id="nav-signout-btn">Sign out</button>
      </div>
    </nav>
  `;

  document.getElementById('nav-signout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/app/login.html';
  });
}
