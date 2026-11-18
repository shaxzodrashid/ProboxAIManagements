// Telegram runs this document offline. The private widget queries are its only data source.
export const sessionWidgetHtml = `
<style>
  body { color: var(--tg-theme-text-color); }
  .card { padding: 10px; border: 1px solid var(--tg-theme-section-separator-color);
    border-radius: 12px; background: var(--tg-theme-secondary-bg-color); }
  .bar, .line, .controls { display: flex; align-items: center; gap: 8px; }
  .bar, .line { justify-content: space-between; }
  .controls { flex-wrap: wrap; margin-top: 8px; }
  .brand { font-size: 12px; font-weight: 700; color: var(--tg-theme-accent-text-color); }
  .meta, time { color: var(--tg-theme-subtitle-text-color); font-size: 12px; }
  h3, p { margin: 4px 0; }
  h3, .clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clip { min-width: 0; }
  .state { flex-shrink: 0; font-size: 12px; font-weight: 700; }
  .running { color: var(--tg-theme-accent-text-color); }
  .failed, .interrupted { color: var(--tg-theme-destructive-text-color); }
  .row { padding: 6px 0; border-bottom: 1px solid var(--tg-theme-section-separator-color); }
  button { min-height: 38px; }
  .dot { display: inline-block; margin-right: 4px; }
  .running .dot { animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .running .dot { animation: none; } }
</style>
<section class="card" aria-label="ProboxAI sessions">
  <div class="bar"><span class="brand">ProboxAI</span><span class="meta" id="mode"></span></div>
  <div id="view"><p>Loading sessions…</p></div>
  <div class="controls" id="controls"></div>
  <p class="meta" id="feedback" aria-live="polite"></p>
</section>
<script>
  const bridge = window.TelegramWidget;
  const get = (id) => document.getElementById(id);
  const labels = {
    QUEUED: ['◷', 'Queued'], RUNNING: ['●', 'Running'], COMPLETED: ['✓', 'Completed'],
    FAILED: ['!', 'Failed'], INTERRUPTED: ['Ⅱ', 'Interrupted'],
    PAUSED: ['Ⅱ', 'Paused'], ARCHIVED: ['◇', 'Archived']
  };
  let session = bridge && bridge.chatData;
  const tracker = Boolean(session);
  let page = 0, busy = false, model = null, expanded = false, timer;

  function put(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }
  function status(parent, value, unconfirmed) {
    const state = put(parent, 'span', '', 'state ' + value.toLowerCase());
    const label = labels[value] || ['·', 'Unknown'];
    put(state, 'span', label[0], 'dot');
    put(state, 'span', unconfirmed ? 'Stop unconfirmed' : label[1]);
  }
  function control(label, action) {
    const button = put(get('controls'), 'button', label);
    button.addEventListener('click', action);
  }
  function duration(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    return Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm';
  }
  function age(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() / 1000 - timestamp) / 60));
    if (!minutes) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
    return Math.floor(minutes / 1440) + 'd ago';
  }
  function elapsed() {
    if (!model?.begin) return '';
    const end = model.end || Math.floor(Date.now() / 1000);
    return duration(Math.max(0, end - model.begin)) + ' elapsed';
  }
  function render() {
    const view = get('view');
    get('mode').textContent = session ? 'Session tracker' : 'Recent sessions';
    if (!model) return;
    view.textContent = '';
    get('controls').textContent = '';
    if (session) {
      const row = put(view, 'div', '', 'line');
      put(row, 'h3', model.title, 'clip');
      status(row, model.status, model.unconfirmed);
      put(view, 'p', model.project + ' · #' + session.slice(0, 8), 'meta clip');
      put(view, 'p', model.status === 'RUNNING' && model.activity[0] ? model.activity[0][0] : model.summary);
      if (model.begin) put(view, 'time', elapsed()).id = 'elapsed';
      if (model.note) put(view, 'p', model.note, 'meta');
      if (expanded) {
        put(view, 'p', 'Recent activity', 'brand');
        model.activity.forEach(([label, at]) => {
          const item = put(view, 'div', '', 'line row');
          put(item, 'span', label);
          put(item, 'time', new Date(at * 1000).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit'
          }));
        });
        if (!model.activity.length) put(view, 'p', 'No activity recorded yet.', 'meta');
      }
      control(expanded ? 'Hide details' : 'Details', () => {
        expanded = !expanded;
        render();
      });
      if (!tracker) control('All sessions', () => load(null, page));
    } else {
      if (!model.rows.length) put(view, 'p', page ? 'No accessible sessions on this page.' : 'No accessible sessions here yet.');
      model.rows.forEach(([id, title, project, state, at, unconfirmed]) => {
        const row = put(view, 'div', '', 'row');
        const top = put(row, 'div', '', 'line');
        put(top, 'strong', title, 'clip');
        status(top, state, unconfirmed);
        put(row, 'p', project + ' · ' + age(at), 'meta clip');
        const button = put(row, 'button', 'Details');
        button.addEventListener('click', () => load(id, page));
      });
      if (page) control('Previous', () => load(null, page - 1));
      if (model.more) control('Next', () => load(null, page + 1));
    }
    control('Refresh', () => load(session, page));
  }

  async function load(target, index) {
    if (!bridge || busy) return;
    busy = true;
    clearTimeout(timer);
    try {
      const answer = await bridge.request(target ? 'session:' + target : 'recent:' + index);
      if (!answer.result) throw new Error('Empty widget response');
      const result = JSON.parse(answer.result);
      if (result.error) {
        if (result.error === 'unavailable') {
          model = null;
          get('view').textContent = 'Session data is unavailable.';
          get('controls').textContent = '';
          if (!tracker && target) control('All sessions', () => load(null, page));
          control('Refresh', () => load(target, index));
        }
        get('feedback').textContent = result.error === 'retry' ? 'Refresh delayed.' : '';
        return;
      }
      if (target ? !Array.isArray(result.activity) : !Array.isArray(result.rows))
        throw new Error('Invalid widget response');
      const unchanged = target && target === session && JSON.stringify(model) === answer.result;
      if (target !== session) expanded = false;
      session = target;
      page = index;
      model = result;
      get('feedback').textContent = '';
      if (!unchanged) render();
      else if (get('elapsed')) get('elapsed').textContent = elapsed();
    } catch {
      get('feedback').textContent = 'Update unavailable. Try Refresh or /status.';
    } finally {
      busy = false;
      schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (bridge?.isActive && session) {
      const live = ['RUNNING', 'QUEUED'].includes(model?.status);
      timer = setTimeout(() => load(session, page), live ? 6500 : 15000);
    }
  }
  if (bridge) {
    bridge.onEvent('activated', () => load(session, page));
    bridge.onEvent('deactivated', () => clearTimeout(timer));
    bridge.ready();
    control('Refresh', () => load(session, page));
    load(session, page);
  }
</script>`;
