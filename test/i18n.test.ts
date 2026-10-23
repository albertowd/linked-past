import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRADABLE_BOTTLES } from '../src/shared/index.js';

// i18n touches document.documentElement when switching; give it a stand-in.
Object.assign(globalThis, { document: { documentElement: {} } });
Object.defineProperty(globalThis, 'navigator', { value: { language: 'de-DE' }, configurable: true });
const i18n = await import('../src/i18n.js');

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test('every catalog has exactly the English keys', () => {
  const expected = keys(i18n.catalogs.en).sort();
  for (const locale of ['fr', 'de', 'ja'] as const)
    assert.deepEqual(keys(i18n.catalogs[locale]).sort(), expected, locale);
});

test('every locale names every tradable bottle and error', () => {
  for (const locale of ['en', 'fr', 'de', 'ja'] as const) {
    i18n.setLocale(locale);
    assert.equal(i18n.t.potions.length, TRADABLE_BOTTLES.length, locale);
    assert.ok(i18n.t.errors.rom_proof_failed, locale);
  }
});

test('locale switch changes strings and the browser default', () => {
  i18n.setLocale('fr');
  assert.equal(i18n.t.chat, 'Discussion');
  i18n.setLocale('de');
  assert.equal(i18n.t.players, 'Spieler');
  assert.equal(i18n.browserLocale(), 'de');
});
