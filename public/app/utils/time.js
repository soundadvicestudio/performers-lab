export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function startRelativeTimers(intervalMs = 60000, timezone) {
  const tz = timezone || 'America/Chicago';

  function formatTitle(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short',
    });
    const parts = fmt.formatToParts(d);
    const get = type => parts.find(p => p.type === type)?.value ?? '';
    const date = `${get('month')} ${get('day')}, ${get('year')}`;
    const time = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
    const tzName = get('timeZoneName');
    return `${date} at ${time} (${tzName})`;
  }

  function update() {
    document.querySelectorAll('[data-timestamp]').forEach(el => {
      el.textContent = relativeTime(el.dataset.timestamp);
      el.title = formatTitle(el.dataset.timestamp);
      el.style.cursor = 'help';
    });
  }
  update();
  return setInterval(update, intervalMs);
}
