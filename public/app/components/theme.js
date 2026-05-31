export const themes = {
  gold: {
    '--gold':        '#c9a96e',
    '--gold-light':  '#d4b87e',
    '--gold-dim':    'rgba(201,169,110,0.14)',
    '--border-gold': 'rgba(201,169,110,0.28)',
    '--bg':          '#070707',
    '--bg-2':        '#0d0d0d',
    '--bg-3':        '#131313',
    '--bg-4':        '#181818',
    '--text':        '#f0ede6',
    '--text-muted':  'rgba(240,237,230,0.58)',
    '--text-dim':    'rgba(240,237,230,0.28)',
    '--border':      'rgba(240,237,230,0.08)',
    '--border-mid':  'rgba(240,237,230,0.14)',
  }
};

export function applyTheme(themeName = 'gold') {
  const vars = themes[themeName] || themes.gold;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
}
