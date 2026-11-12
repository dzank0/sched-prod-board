// sched-prod incident board: live list (R1), Ack per row (R2), loader (R3), 2 s refresh (R4), local times (R5).
import { ack, fetchIncidents } from './api.js';
import { formatLocal } from './time.js';

const REFRESH_MS = 2000;
const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const rows = new Map(); // incident id -> <li>, kept across refreshes so marks and buttons survive (R2 + R4)
const acked = new Map(); // incident id -> ackedAt, page memory only (the API has no ack-state call)
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

function onAck(id, button) {
  return async () => {
    button.disabled = true;
    try {
      const reply = await ack(id);
      acked.set(id, reply.ackedAt);
      button.replaceWith(ackedMark(reply.ackedAt));
    } catch (err) {
      console.error(err);
      button.disabled = false;
    }
  };
}

function createRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id });
  li.append(el('span', { class: 'id' }), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'), el('span', { class: 'act' }));
  const act = li.querySelector('.act');
  if (acked.has(i.id)) act.append(ackedMark(acked.get(i.id)));
  else {
    const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    button.addEventListener('click', onAck(i.id, button));
    act.append(button);
  }
  return li;
}

function updateRow(li, i) {
  li.className = `row ${i.severity}`;
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

function render(incidents) {
  const seen = new Set();
  let cursor = list.firstElementChild;
  for (const i of incidents) {
    seen.add(i.id);
    let li = rows.get(i.id);
    if (!li) rows.set(i.id, (li = createRow(i)));
    updateRow(li, i);
    // Move a row only when it is out of place, so rows already on screen are never re-created.
    if (li !== cursor) list.insertBefore(li, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const [id, li] of rows) if (!seen.has(id)) { li.remove(); rows.delete(id); }
  const empty = board.querySelector('[data-testid="empty"]');
  if (!incidents.length && !empty) board.append(el('p', { 'data-testid': 'empty', class: 'empty' }, 'No incidents tonight.'));
  if (incidents.length && empty) empty.remove();
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
