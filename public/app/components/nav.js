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
    .nav-bell {
      position: relative; display: flex; align-items: center;
      color: var(--text-dim); text-decoration: none; transition: color 0.2s;
      line-height: 1;
    }
    .nav-bell:hover { color: var(--text-muted); }
    .nav-notif-count {
      position: absolute; top: -6px; right: -8px;
      background: var(--gold); color: #000;
      font-size: 10px; font-weight: 700; letter-spacing: 0; line-height: 1;
      min-width: 16px; height: 16px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      padding: 0 3px; font-family: 'Raleway', sans-serif;
    }
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
        <a href="/app/notifications.html" class="nav-bell" aria-label="Notifications">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span id="nav-notif-count" class="nav-notif-count" style="display:none;"></span>
        </a>
        <a href="/app/messages.html" class="nav-bell" id="nav-msg-link" aria-label="Messages" style="display:none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span id="nav-msg-count" class="nav-notif-count"></span>
        </a>
        <a href="/admin" class="nav-admin-btn"${isAdmin ? '' : ' style="display:none;"'}>Admin Panel</a>
        <button class="nav-signout" id="nav-signout-btn">Sign out</button>
      </div>
    </nav>
  `;

  document.getElementById('nav-signout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/app/login.html';
  });

  wireNotifications(supabase);
  wireMessages(supabase);
}

function updateBell(count) {
  const el = document.getElementById('nav-notif-count');
  if (!el) return;
  if (count <= 0) {
    el.style.display = 'none';
    el.textContent = '';
  } else {
    el.textContent = count > 99 ? '99+' : String(count);
    el.style.display = 'flex';
  }
}

async function wireNotifications(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false);

  updateBell(count || 0);

  supabase.channel('nav-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${user.id}`,
    }, () => {
      const el = document.getElementById('nav-notif-count');
      const current = el ? (parseInt(el.textContent, 10) || 0) : 0;
      updateBell(current + 1);
    })
    .subscribe();

  window.addEventListener('notifications-cleared', () => updateBell(0));
}

function updateMsgBadge(count) {
  const link = document.getElementById('nav-msg-link');
  const badge = document.getElementById('nav-msg-count');
  if (!link || !badge) return;
  if (count <= 0) {
    link.style.display = 'none';
    badge.textContent = '';
  } else {
    badge.textContent = count > 99 ? '99+' : String(count);
    link.style.display = 'flex';
  }
}

async function wireMessages(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Load all conversation IDs for this user
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`);

  const convIds = (convs || []).map(c => c.id);

  if (convIds.length > 0) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convIds)
      .neq('sender_id', user.id)
      .eq('read', false);

    updateMsgBadge(count || 0);
  }

  const myConvIds = new Set(convIds);

  // Realtime: new message from another user in any of my conversations
  supabase.channel('nav-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      payload => {
        const msg = payload.new;
        if (msg.sender_id === user.id) return;
        if (!myConvIds.has(msg.conversation_id)) return;
        const badge = document.getElementById('nav-msg-count');
        const current = badge ? (parseInt(badge.textContent, 10) || 0) : 0;
        updateMsgBadge(current + 1);
      })
    .subscribe();

  window.addEventListener('messages-cleared', () => updateMsgBadge(0));
  window.addEventListener('messages-count-update', e => updateMsgBadge(e.detail?.count || 0));
}
