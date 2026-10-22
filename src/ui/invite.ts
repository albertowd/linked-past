// Manual signaling UI: the host hands out invite codes and pastes reply codes; a guest pastes
// an invite and sends back the reply. Codes travel however friends like (chat, message...).

import { t } from '../i18n.js';
import type { GuestLink } from '../net/guest.js';
import type { HostLink, Invite } from '../net/host.js';
import { CodeError, isIPv4 } from '../net/rtc.js';
import { h, label } from './dom.js';

const codeBox = (value = '', readOnly = false) =>
  h('textarea', { class: 'code', rows: 4, spellcheck: false, readOnly, value, autocomplete: 'off' });

function copyButton(box: HTMLTextAreaElement) {
  const btn = h('button', { class: 'btn small', type: 'button' }, label(t.invite.copy, {}, 1));
  btn.onclick = async () => {
    box.select();
    try {
      await navigator.clipboard.writeText(box.value);
    } catch {
      return; // clipboard blocked: the code stays selected for Ctrl/Cmd+C
    }
    btn.replaceChildren(label(t.invite.copied, { color: '#78f878' }, 1));
    setTimeout(() => btn.replaceChildren(label(t.invite.copy, {}, 1)), 1500);
  };
  return btn;
}

const codeError = (e: unknown) =>
  e instanceof CodeError ? (t.connect[e.code as keyof typeof t.connect] ?? t.errors[e.code] ?? e.code) : String(e);

function addressField() {
  const input = h('input', { class: 'address', placeholder: t.invite.address, inputMode: 'decimal', maxLength: 15 });
  const field = h('label', { class: 'address-field' }, input, h('small', { class: 'hint' }, t.invite.addressHelp));
  return { field, value: () => (isIPv4(input.value) ? input.value.trim() : undefined) };
}

function inviteCard(invite: Invite) {
  const reply = codeBox();
  const err = h('p', { class: 'error' });
  const state = h('p', { class: 'hint' });
  const connect = h('button', { class: 'btn primary small', type: 'button' }, label(t.invite.connect, {}, 1));
  const render = () => {
    const who = invite.guestName ? `${invite.guestName}: ` : '';
    state.textContent = who + t.invite.states[invite.state];
    const done = invite.state !== 'waiting';
    reply.disabled = done;
    connect.disabled = done;
  };
  connect.onclick = async () => {
    err.textContent = '';
    try {
      await invite.accept(reply.value);
    } catch (e) {
      err.textContent = codeError(e);
    }
  };
  invite.onChange(render);
  render();
  const box = codeBox(invite.code, true);
  return h(
    'div',
    { class: 'invite' },
    h('p', {}, t.invite.step1),
    box,
    h('div', { class: 'row' }, copyButton(box)),
    h('p', {}, t.invite.step2),
    reply,
    h('div', { class: 'row' }, connect),
    state,
    err,
  );
}

export function inviteDialog(host: HostLink, close: () => void): HTMLElement {
  const list = h('div', { class: 'invites' });
  const address = addressField();
  const more = h('button', { class: 'btn', type: 'button' }, label(t.invite.another, {}, 1));
  const create = async () => {
    more.disabled = true;
    const pending = h('p', { class: 'hint' }, t.invite.generating);
    list.prepend(pending);
    try {
      pending.replaceWith(inviteCard(await host.invite(address.value())));
    } finally {
      more.disabled = false;
    }
  };
  more.onclick = () => void create();
  // Show the open invites again, then make a fresh one if none is waiting for a reply.
  for (const inv of host.invites.filter((i) => i.state === 'waiting' || i.state === 'connecting').reverse())
    list.append(inviteCard(inv));
  if (!list.children.length) void create();
  return h(
    'div',
    { class: 'connect-dialog' },
    label(t.invite.title, { color: '#f8d830' }, 2),
    list,
    h('div', { class: 'row' }, more),
    address.field,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, label(t.controls.close))),
  );
}

export function joinDialog(guest: GuestLink, close: () => void): HTMLElement {
  const invite = codeBox();
  const reply = codeBox('', true);
  const err = h('p', { class: 'error' });
  const from = h('p', { class: 'hint' });
  const address = addressField();
  const step2 = h(
    'div',
    { class: 'hidden' },
    h('p', {}, t.join.step2),
    reply,
    h('div', { class: 'row' }, copyButton(reply)),
  );
  const make = h('button', { class: 'btn primary', type: 'button' }, label(t.join.makeReply, {}, 1));
  make.onclick = async () => {
    err.textContent = '';
    make.disabled = true;
    try {
      reply.value = await guest.join(invite.value, address.value());
      from.textContent = guest.hostName ? `${t.join.from} ${guest.hostName}` : '';
      step2.classList.remove('hidden');
    } catch (e) {
      err.textContent = codeError(e);
    } finally {
      make.disabled = false;
    }
  };
  return h(
    'div',
    { class: 'connect-dialog' },
    label(t.join.title, { color: '#f8d830' }, 2),
    h('p', {}, t.join.step1),
    invite,
    h('div', { class: 'row' }, make),
    from,
    err,
    step2,
    address.field,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, label(t.controls.close))),
  );
}
