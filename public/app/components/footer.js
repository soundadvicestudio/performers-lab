const FOOTER_STYLES_ID = 'app-footer-styles';

function injectStyles() {
  if (document.getElementById(FOOTER_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = FOOTER_STYLES_ID;
  style.textContent = `
    .app-footer {
      border-top: 0.5px solid var(--border);
      padding: 1.5rem 2.5rem;
      margin-top: 3rem;
    }
    .footer-inner {
      max-width: 900px; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 1rem;
    }
    .footer-left {
      font-size: 11px; color: var(--text-dim); font-weight: 300; letter-spacing: 0.02em;
    }
    .footer-left a { color: var(--text-dim); text-decoration: none; transition: color 0.2s; }
    .footer-left a:hover { color: var(--gold); }
    .footer-sa-studio { font-size: 10px; opacity: 0.75; }
    .footer-right { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
    .footer-right a {
      font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--text-dim); text-decoration: none; transition: color 0.2s;
    }
    .footer-right a:hover { color: var(--gold); }
    @media (max-width: 600px) {
      .app-footer { padding: 1.5rem 1.25rem; }
      .footer-inner { flex-direction: column; align-items: flex-start; }
    }
  `;
  document.head.appendChild(style);
}

export function initFooter() {
  injectStyles();

  const container = document.getElementById('app-footer');
  if (!container) return;

  container.innerHTML = `
    <footer class="app-footer">
      <div class="footer-inner">
        <div class="footer-left">
          The Performer's Lab &middot; by
          <a href="https://alittlesoundadvice.com" target="_blank" rel="noopener">Sound Advice <span class="footer-sa-studio">Vocal Studio</span></a>
        </div>
        <div class="footer-right">
          <a href="/app/dashboard.html">Dashboard</a>
          <a href="/app/profile.html">Profile</a>
          <a href="/app/community.html">Community</a>
          <a href="/app/resources.html">Resources</a>
        </div>
      </div>
    </footer>
  `;
}
