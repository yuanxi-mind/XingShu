'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAppearance, appearanceForTheme, DEFAULT_APPEARANCE, projectUiKey } = require('./load-ts.cjs')('src/renderer/src/uiPreferences.ts');
const read = value => {
  const old = global.localStorage;
  global.localStorage = { getItem: () => value };
  try { return readAppearance(); } finally { global.localStorage = old; }
};

test('B design is the first-run default and handles damaged storage', () => {
  for (const value of [null, 'invalid', 'null']) assert.deepEqual(read(value), DEFAULT_APPEARANCE);
});

test('one-time B migration preserves custom typography and background', () => {
  const migrated = read(JSON.stringify({ theme: 'dark', background: 'grid', font: 'songti', fontSize: 21, backgroundColor: '#abcdef' }));
  assert.equal(migrated.theme, 'light'); assert.equal(migrated.designVersion, 2);
  assert.equal(migrated.font, 'songti'); assert.equal(migrated.fontSize, 21);
  assert.equal(migrated.background, 'grid'); assert.equal(migrated.backgroundColor, '#abcdef');
  assert.equal(read(JSON.stringify({ theme: 'dark', backgroundColor: '#121416' })).backgroundColor, DEFAULT_APPEARANCE.backgroundColor);
});

test('later theme choice survives reload; default canvas follows theme', () => {
  const dark = appearanceForTheme(DEFAULT_APPEARANCE, 'dark');
  assert.equal(dark.backgroundColor, '#161c30');
  assert.deepEqual(read(JSON.stringify(dark)), dark);
  assert.deepEqual(appearanceForTheme(dark, 'light'), DEFAULT_APPEARANCE);
  assert.equal(appearanceForTheme({ ...dark, backgroundColor: '#123456' }, 'light').backgroundColor, '#123456');
});

test('a new project never falls back to another project or home appearance', () => {
  const old = global.localStorage;
  const dark = appearanceForTheme(DEFAULT_APPEARANCE, 'dark');
  const data = new Map([['tongzhou-appearance', JSON.stringify(dark)], [projectUiKey('tongzhou-appearance', 'A'), JSON.stringify({ ...dark, font: 'songti' })]]);
  global.localStorage = { getItem: (key) => data.get(key) ?? null };
  try {
    assert.equal(readAppearance(projectUiKey('tongzhou-appearance', 'A')).font, 'songti');
    assert.deepEqual(readAppearance(projectUiKey('tongzhou-appearance', 'B')), DEFAULT_APPEARANCE);
  } finally { global.localStorage = old; }
});
