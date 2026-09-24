import { describe, expect, it } from 'vitest';
import { EN } from './strings.en.js';
import { ES } from './strings.es.js';
import { keysOf, setBlankStrings, setLang, t } from '../i18n.js';

describe('string tables', () => {
  it('have exactly the same keys', () => {
    expect(keysOf('es')).toEqual(keysOf('en'));
  });

  it('have no empty strings', () => {
    for (const [k, v] of Object.entries(EN)) expect(v.length, `en:${k}`).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(ES)) expect(v.length, `es:${k}`).toBeGreaterThan(0);
  });

  it('agree about which strings take which placeholders', () => {
    const holes = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
      expect(holes(ES[key]), `placeholders differ for ${key}`).toEqual(holes(EN[key]));
    }
  });

  it('are actually translated, not copied', () => {
    // Some strings are legitimately identical ('#', 'Club', 'No'). Most must not be.
    const same = (Object.keys(EN) as (keyof typeof EN)[]).filter((k) => EN[k] === ES[k]);
    expect(same.length).toBeLessThan(Object.keys(EN).length * 0.2);
  });
});

describe('t()', () => {
  it('returns the key itself when a key is missing', () => {
    setLang('en');
    expect(t('nope.not.a.key' as never)).toBe('nope.not.a.key');
  });

  it('fills placeholders', () => {
    setLang('en');
    expect(t('home.season', { n: 3 })).toBe('Season 3');
  });

  it('switches language', () => {
    setLang('es');
    expect(t('nav.squad')).toBe('Plantilla');
    setLang('en');
    expect(t('nav.squad')).toBe('Squad');
  });

  it('falls back to English for a key a language is missing', () => {
    setLang('es');
    expect(t('app.title')).toBe('Touchline');
    setLang('en');
  });

  it('blanks everything when asked, which is what proves the wordless path', () => {
    setBlankStrings(true);
    expect(t('nav.squad')).toBe('');
    expect(t('home.season', { n: 1 })).toBe('');
    setBlankStrings(false);
    expect(t('nav.squad')).toBe('Squad');
  });
});
