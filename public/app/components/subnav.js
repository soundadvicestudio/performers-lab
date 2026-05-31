const SUBNAV_STYLES_ID = 'app-subnav-styles';

const TABS = [
  {
    label: 'Dashboard',
    href: '/app/dashboard.html',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  },
  {
    label: 'Community',
    href: '/app/community.html',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  },
  {
    label: 'Live Lab',
    href: '/app/events.html',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  },
  {
    label: 'Resources',
    href: '/app/resources.html',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  },
  {
    label: 'Submit',
    href: '/app/submit.html',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  },
];

function injectStyles() {
  if (document.getElementById(SUBNAV_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = SUBNAV_STYLES_ID;
  style.textContent = `
    .app-subnav {
      position: sticky; top: 56px; z-index: 90;
      background: var(--bg-2);
      border-bottom: 0.5px solid var(--border);
    }
    .subnav-inner {
      max-width: 900px; margin: 0 auto;
      display: flex; align-items: stretch;
      padding: 0 2rem;
    }
    .subnav-tab {
      display: flex; align-items: center;
      padding: 0 1rem; height: 42px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--text-dim); text-decoration: none;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
      white-space: nowrap;
    }
    .subnav-tab:hover { color: var(--text-muted); }
    .subnav-tab.active { color: var(--gold); border-bottom-color: var(--gold); }
    .subnav-icon { display: none; }

    @media (max-width: 700px) {
      .app-subnav {
        position: fixed; bottom: 0; top: auto; left: 0; right: 0; z-index: 200;
        border-bottom: none; border-top: 0.5px solid var(--border);
        background: rgba(13,13,13,0.97); backdrop-filter: blur(12px);
      }
      .subnav-inner { padding: 0; max-width: 100%; }
      .subnav-tab {
        flex: 1; flex-direction: column; justify-content: center; align-items: center;
        height: 60px; gap: 4px; padding: 0;
        font-size: 9px; letter-spacing: 0.07em;
        border-bottom: none; border-top: 2px solid transparent;
      }
      .subnav-tab.active { color: var(--gold); border-top-color: var(--gold); border-bottom-color: transparent; }
      .subnav-icon { display: flex; align-items: center; justify-content: center; }
      body { padding-bottom: 60px; }
    }
  `;
  document.head.appendChild(style);
}

export function initSubnav(activeTab) {
  injectStyles();

  const container = document.getElementById('app-subnav');
  if (!container) return;

  container.className = 'app-subnav';
  container.innerHTML = `
    <div class="subnav-inner">
      ${TABS.map(tab => `
        <a href="${tab.href}" class="subnav-tab${tab.label === activeTab ? ' active' : ''}">
          <span class="subnav-icon">${tab.icon}</span>
          <span class="subnav-label">${tab.label}</span>
        </a>
      `).join('')}
    </div>
  `;
}
