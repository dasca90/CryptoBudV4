import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const settingsPage = readFileSync(new URL('../ui/pages/SettingsPage.tsx', import.meta.url), 'utf8');

assert.ok(settingsPage.includes('settingsScrollRef'), 'Settings page owns a real scroll container ref');
assert.ok(settingsPage.includes('SETTINGS_SCROLL_CONTAINER_AUDIT'), 'Settings page emits scroll-container audit');
assert.ok(settingsPage.includes('data-testid="settings-scroll-container"'), 'Settings scroll container is test-addressable');
assert.ok(settingsPage.includes('settings-scroll-bottom-sentinel'), 'Settings page has bottom sentinel/spacer');

const settingsLayoutRule = css.match(/\.settings-layout\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(settingsLayoutRule.includes('overflow-y: auto'), 'settings-layout is the vertical scroll container');
assert.ok(settingsLayoutRule.includes('min-height: 0'), 'settings-layout can shrink inside app shell');
assert.ok(settingsLayoutRule.includes('scroll-padding-bottom: 180px'), 'settings-layout protects bottom scroll target');
assert.ok(settingsLayoutRule.includes('overscroll-behavior: contain'), 'settings-layout contains scroll behavior');
assert.ok(css.includes('.settings-scroll-bottom-sentinel'), 'bottom sentinel has CSS');
assert.ok(!/\.settings-row\s*\{[^}]*scrollbar-width/s.test(css), 'settings rows do not receive scroll-container styling');

console.log('Settings scroll container regression tests PASSED.');
