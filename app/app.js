// sched-prod incident board: live list (R1), Ack in the incident panel (R2, product decision 2026-11-12),
// loader (R3), 2 s refresh (R4), local times (R5).
import { ack, fetchIncidents } from './api.js';
import { formatLocal } from './time.js';

const REFRESH_MS = 2000;
const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const panel = document.querySelector('[data-testid="incident-panel"]');
const rows = new Map(); // incident id -> <li>, kept across refreshes: rows are never re-created or removed while listed
const incidents = new Map(); // incident id -> latest data
const acked = new Map(); // incident id -> ackedAt, page memory only (the API has no ack-state call)
let selected = null; // the incident the panel names; bound to the id, not to a screen position
let loaded = false;

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function ackedMark(at) {
  const mark = el('span', { 'data-testid': 'acked', class: 'acked' }, 'acked ');
  mark.append(el('time', { datetime: at, title: at }, formatLocal(at)));
  return mark;
}

// The panel: names one incident and holds its Ack. It does not move when rows land on top.
function renderPanel() {
  const i = incidents.get(selected);
  if (!i) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.dataset.id = i.id;
  panel.querySelector('.p-id').textContent = i.id;
  panel.querySelector('.p-sev').textContent = i.severity;
  panel.querySelector('.p-what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const t = panel.querySelector('.p-time');
  t.setAttribute('datetime', i.openedAt);
  t.title = i.openedAt;
  t.textContent = formatLocal(i.openedAt);
  const button = panel.querySelector('[data-testid="panel-ack"]');
  const state = panel.querySelector('.p-state');
  if (acked.has(i.id)) {
    button.disabled = true;
    button.textContent = `Acked ${i.id}`;
    state.textContent = `acked ${formatLocal(acked.get(i.id))}`;
  } else if (!button.classList.contains('busy')) {
    button.disabled = false;
    button.textContent = `Ack ${i.id}`;
    state.textContent = '';
  }
}

function select(id) {
  if (selected) rows.get(selected)?.setAttribute('aria-selected', 'false');
  selected = id;
  rows.get(id)?.setAttribute('aria-selected', 'true');
  renderPanel();
}

function closePanel() {
  if (selected) rows.get(selected)?.setAttribute('aria-selected', 'false');
  selected = null;
  renderPanel();
}

panel.querySelector('[data-testid="panel-ack"]').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const id = panel.dataset.id; // the incident the panel names, read at click time
  if (!id || acked.has(id)) return;
  button.disabled = true;
  button.classList.add('busy');
  try {
    const reply = await ack(id);
    acked.set(reply.id ?? id, reply.ackedAt);
    rows.get(id)?.querySelector('.act').replaceChildren(ackedMark(reply.ackedAt));
  } catch (err) {
    console.error(err);
  } finally {
    button.classList.remove('busy');
    renderPanel();
  }
});
panel.querySelector('.p-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) closePanel(); });

function createRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, tabindex: '0', role: 'button', 'aria-selected': 'false' });
  li.append(el('span', { class: 'id' }), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'), el('span', { class: 'act' }));
  if (acked.has(i.id)) li.querySelector('.act').append(ackedMark(acked.get(i.id)));
  li.addEventListener('click', () => select(i.id));
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i.id); } });
  return li;
}

function updateRow(li, i) {
  li.className = `row ${i.severity}`;
  li.setAttribute('aria-label', `${i.id} ${i.severity} ${i.summary}`);
  li.querySelector('.id').textContent = i.id;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = li.querySelector(':scope > time');
  if (time.getAttribute('datetime') !== i.openedAt) {
    time.setAttribute('datetime', i.openedAt);
    time.title = i.openedAt;
    time.textContent = formatLocal(i.openedAt);
  }
}

function render(list_) {
  const seen = new Set();
  let cursor = list.firstElementChild;
  for (const i of list_) {
    seen.add(i.id);
    incidents.set(i.id, i);
    let li = rows.get(i.id);
    if (!li) rows.set(i.id, (li = createRow(i)));
    updateRow(li, i);
    // New rows go in above the current one; rows already on screen are never moved or re-created.
    if (li !== cursor) list.insertBefore(li, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const [id, li] of rows) if (!seen.has(id)) { li.remove(); rows.delete(id); }
  const empty = board.querySelector('[data-testid="empty"]');
  if (!list_.length && !empty) board.append(el('p', { 'data-testid': 'empty', class: 'empty' }, 'No incidents tonight.'));
  if (list_.length && empty) empty.remove();
  renderPanel();
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    if (!loaded) {
      loaded = true;
      board.querySelector('[data-testid="loader"]')?.remove();
    }
  } catch (err) {
    console.error(err); // keep the last list on screen; try again on the next tick
  } finally {
    setTimeout(refresh, REFRESH_MS); // next refresh 2 s after this answer: requests never overlap
  }
}

refresh();
