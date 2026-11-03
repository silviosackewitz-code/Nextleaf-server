import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAppearance, themes, fonts } from '../src/appearance.ts';

test('appearance defaults safely and validates each stored setting independently', () => {
  for (const raw of [null, '{', 'null', '[]', '42', '{"theme":"unknown","font":false}']) {
    assert.deepEqual(readAppearance(raw), { theme: 'dark', font: 'plex' });
  }
  assert.deepEqual(readAppearance('{"theme":"terminal","font":"unknown"}'), { theme: 'terminal', font: 'plex' });
  assert.deepEqual(readAppearance('{"theme":null,"font":"jetbrains"}'), { theme: 'dark', font: 'jetbrains' });
  assert.deepEqual(readAppearance('{"theme":"industrial","font":"cascadia"}'), { theme: 'industrial', font: 'jetbrains' });
  assert.deepEqual(fonts, ['plex', 'jetbrains']);
  for (const theme of themes) for (const font of fonts) {
    assert.deepEqual(readAppearance(JSON.stringify({ theme, font })), { theme, font });
  }
});

test('theme text and primary buttons meet WCAG AA contrast', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/appearance.css', import.meta.url), 'utf8');
  function luminance(hex: string) {
    const channels = hex.match(/../g)!.map(c => parseInt(c, 16) / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  function contrast(a: string, b: string) {
    const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b);
    return (hi + .05) / (lo + .05);
  }
  for (const theme of themes) {
    const block = css.split(`[data-theme='${theme}']{`)[1].split('}')[0];
    const colors = Object.fromEntries([...block.matchAll(/--([a-z-]+):#([a-f0-9]{6})(?=;)/g)]
      .map(match => [match[1], match[2]]));
    for (const foreground of ['ink', 'muted', 'accent', 'danger']) {
      for (const background of ['bg', 'panel', 'field', 'hover']) {
        assert(contrast(colors[foreground], colors[background]) >= 4.5,
          `${theme}: ${foreground} on ${background}`);
      }
    }
    assert(contrast(colors['on-accent'], colors['accent-fill']) >= 4.5, theme + ' button');
  }
});
