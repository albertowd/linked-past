import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Atlas } from '../src/game/harvest.js';
import { fold, PixelFont } from '../src/ui/font.js';

test('fold maps text onto the uppercase game alphabet', () => {
  assert.equal(fold('Échange à Hyrule'), 'ECHANGE A HYRULE');
  assert.equal(fold('Grüße, Öl, Äpfel'), 'GRUESSE, OEL, AEPFEL');
  assert.equal(fold('ça va?'), 'CA VA?');
});

test('glyph widths are proportional; unknown characters advance a space', () => {
  const narrow = Array(64).fill(0);
  narrow[0] = 1; // one pixel in column 0
  const wide = Array(64).fill(0);
  wide[6] = 1; // rightmost pixel in column 6
  const atlas = { version: 3, glyphs: { I: narrow, W: wide }, icons: {} } as unknown as Atlas;
  const font = new PixelFont(atlas);
  assert.equal(font.measure('I'), 2);
  assert.equal(font.measure('W'), 8);
  assert.equal(font.measure('i w'), 2 + 4 + 8, 'lowercase folds; space is 4px');
  assert.ok(font.measure('X') > 4, 'fallback X exists for regions without one');
  assert.ok(font.measure('!') > 0, 'punctuation is provided');
});

test('Japanese folds to katakana and keeps dakuten as marks', () => {
  assert.equal(fold('ぼうけん'), 'ボウケン');
  assert.equal(fold('パーティ'), 'パーテイ', 'small kana the cartridge lacks become full size');
  assert.equal(fold('ｶﾞﾝﾅﾝ、ＯＫ。'), 'ガンナン,OK.');
});

test('kanji cannot be drawn, so labels fall back to plain text', () => {
  const kana = Array(64).fill(0);
  kana[6] = 1;
  const atlas = { version: 3, glyphs: { カ: kana, ン: kana }, icons: {} } as unknown as Atlas;
  const font = new PixelFont(atlas);
  assert.ok(font.canRender('ガン 12!'), 'kana, marks, digits and punctuation');
  assert.ok(font.canRender('Link'), 'every Latin letter has a fallback');
  assert.ok(!font.canRender('勇者'));
  assert.equal(font.measure('ガ'), font.measure('カ') + 2, 'dakuten tucks into the corner');
});
