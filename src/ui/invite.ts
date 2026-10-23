// Manual signaling UI. The host shows one room QR code for everyone; it opens the game ready to
// join. Each friend then shows the host a request code, and the host shows back an answer code.
// Codes travel as QR codes (scanned with the camera) or as text, however friends like.

import { t } from '../i18n.js';
import type { GuestLink } from '../net/guest.js';
import type { Admission, HostLink } from '../net/host.js';
import { CodeError, isIPv4, roomLink } from '../net/rtc.js';
import { h, label } from './dom.js';
import { qrCode, scanButton } from './qr.js';

const codeBox = (value = '', readOnly = false) =>
  h('textarea', { class: 'code', rows: 3, spellcheck: false, readOnly, value, autocomplete: 'off' });

function copyButton(box: HTMLTextAreaElement, text = () => box.value, name = t.invite.copy) {
  const btn = h('button', { class: 'btn small', type: 'button' }, label(name, {}, 1));
  btn.onclick = async () => {
    box.select();
    try {
      await navigator.clipboard.writeText(text());
    } catch {
      return; // clipboard blocked: the code stays selected for Ctrl/Cmd+C
    }
    btn.replaceChildren(label(t.invite.copied, { color: '#78f878' }, 1));
    setTimeout(() => btn.replaceChildren(label(name, {}, 1)), 1500);
  };
  return btn;
}

/** Links to localhost only open on this computer, so a QR code of one is useless to friends. */
const LOCAL_ONLY = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const codeError = (e: unknown) =>
  e instanceof CodeError ? (t.connect[e.code as keyof typeof t.connect] ?? t.errors[e.code] ?? e.code) : String(e);

function addressField() {
  const input = h('input', { class: 'address', placeholder: t.invite.address, inputMode: 'decimal', maxLength: 15 });
  const field = h('label', { class: 'address-field' }, input, h('small', { class: 'hint' }, t.invite.addressHelp));
  return { field, value: () => (isIPv4(input.value) ? input.value.trim() : undefined) };
}

/** One friend being let in: their name, the answer for them to scan, and how it is going. */
function admissionCard(a: Admission) {
  const state = h('p', { class: 'hint' });
  const answer = h('div', { class: 'answer' });
  const box = codeBox(a.answer, true);
  const render = () => {
    state.textContent = `${a.guestName ?? '?'}: ${t.invite.states[a.state]}`;
    // The answer is only useful until they have read it.
    answer.classList.toggle('hidden', a.state !== 'waiting');
  };
  a.onChange(render);
  answer.append(qrCode(a.answer), box, h('div', { class: 'row' }, copyButton(box)));
  render();
  return h('div', { class: 'invite' }, state, answer);
}

/** Body of the host's sidebar card: the room QR code, and letting each friend in. */
export function inviteCard(host: HostLink): HTMLElement {
  const roomQr = h('div', {});
  const linkBox = Object.assign(codeBox('', true), { rows: 1 });
  void host.roomCode().then((code) => {
    linkBox.value = roomLink(code);
    roomQr.replaceChildren(qrCode(linkBox.value));
  });
  const request = codeBox();
  const err = h('p', { class: 'error' });
  const list = h('div', { class: 'invites' });
  const address = addressField();
  const add = h('button', { class: 'btn primary small', type: 'button' }, label(t.invite.connect, {}, 1));
  add.onclick = async () => {
    err.textContent = '';
    if (!request.value.trim()) return;
    add.disabled = true;
    const pending = h('p', { class: 'hint' }, t.invite.generating);
    list.prepend(pending);
    try {
      const card = admissionCard(await host.admit(request.value, address.value()));
      pending.replaceWith(card);
      request.value = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'center' }); // the friend scans it next
    } catch (e) {
      pending.remove();
      err.textContent = codeError(e);
    } finally {
      add.disabled = false;
    }
  };
  return h(
    'div',
    { class: 'connect-body' },
    h('p', {}, t.invite.step1),
    roomQr,
    h('p', { class: 'hint' }, LOCAL_ONLY ? t.invite.localOnly : t.invite.qrHelp),
    linkBox,
    h(
      'div',
      { class: 'row' },
      copyButton(linkBox, () => linkBox.value, t.invite.copyLink),
    ),
    h('p', {}, t.invite.step2),
    request,
    h(
      'div',
      { class: 'row' },
      scanButton(
        request,
        (msg) => (err.textContent = msg),
        () => add.click(),
      ),
      add,
    ),
    err,
    list,
    address.field,
  );
}

/**
 * Body of a guest's sidebar card: their request code for the host, and reading back the answer.
 * `invitedBy` is the host's name when the game was opened from their room link. `refresh` makes
 * a new request code after the connection to the host is lost.
 */
export function joinCard(guest: GuestLink, invitedBy?: string): { el: HTMLElement; refresh: () => void } {
  const requestQr = h('div', {});
  const request = codeBox('', true);
  const answer = codeBox();
  const err = h('p', { class: 'error' });
  const address = addressField();
  const make = async () => {
    err.textContent = '';
    answer.value = '';
    requestQr.replaceChildren(h('p', { class: 'hint' }, t.invite.generating));
    request.value = await guest.makeRequest(address.value());
    requestQr.replaceChildren(qrCode(request.value));
  };
  void make();
  const connect = h('button', { class: 'btn primary small', type: 'button' }, label(t.join.connect, {}, 1));
  connect.onclick = async () => {
    err.textContent = '';
    try {
      await guest.answer(answer.value);
    } catch (e) {
      err.textContent = codeError(e);
    }
  };
  const fresh = h(
    'button',
    { class: 'btn small', type: 'button', onclick: () => void make() },
    label(t.join.newCode, {}, 1),
  );
  const el = h(
    'div',
    { class: 'connect-body' },
    invitedBy === undefined ? '' : h('p', { class: 'hint' }, `${t.join.from} ${invitedBy || '?'}`),
    h('p', {}, t.join.step1),
    requestQr,
    request,
    h('div', { class: 'row' }, copyButton(request), fresh),
    h('p', {}, t.join.step2),
    answer,
    h(
      'div',
      { class: 'row' },
      scanButton(
        answer,
        (msg) => (err.textContent = msg),
        () => connect.click(),
      ),
      connect,
    ),
    err,
    address.field,
  );
  return { el, refresh: () => void make() };
}
