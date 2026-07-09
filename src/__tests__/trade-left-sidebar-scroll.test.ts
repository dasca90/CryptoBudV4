import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../components/trade-v4/TradeV4Page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../components/trade-v4/trade-v4.css', import.meta.url), 'utf8');

assert.ok(page.includes('leftSidebarScrollRef'), 'TradeV4 left sidebar owns a real scroll ref');
assert.ok(page.includes('TRADE_LEFT_SIDEBAR_SCROLL_AUDIT'), 'TradeV4 emits a left-sidebar scroll audit');
assert.ok(page.includes('data-testid="left-sidebar-scroll"'), 'Left sidebar scroll container is test-addressable');
assert.ok(page.includes('data-testid="left-sidebar-bottom-sentinel"'), 'Left sidebar has a bottom sentinel');
assert.ok(page.includes('onWheel={handleLeftSidebarWheel}'), 'Left sidebar bridges wheel events from nested controls');
assert.ok(page.includes('findNestedScrollableWheelTarget'), 'Left sidebar detects nested scroll targets before falling back to sidebar scroll');
assert.ok(page.includes('sidebar.scrollTop += event.deltaY'), 'Left sidebar wheel bridge advances the sidebar scroll position');
assert.ok(page.includes('event.preventDefault()'), 'Left sidebar wheel bridge prevents form controls from swallowing wheel scroll');

const gridRule = css.match(/\.trade-v4-grid-v3\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(gridRule.includes('height: 100%'), 'TradeV4 grid uses parent tab height instead of viewport height');
assert.ok(!gridRule.includes('height: 100vh'), 'TradeV4 grid does not overrun the tab with 100vh');
assert.ok(gridRule.includes('min-height: 0'), 'TradeV4 grid can shrink inside the app shell');

const sidebarRule = css.match(/\.trade-v4-left\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(sidebarRule.includes('overflow-y: auto'), 'TradeV4 left sidebar is the vertical scroll container');
assert.ok(sidebarRule.includes('min-height: 0'), 'TradeV4 left sidebar can shrink inside flex layout');
assert.ok(sidebarRule.includes('max-height: 100%'), 'TradeV4 left sidebar is constrained to visible tab height');
assert.ok(sidebarRule.includes('scroll-padding-bottom: 160px'), 'TradeV4 left sidebar protects bottom scroll target');
assert.ok(sidebarRule.includes('overscroll-behavior: contain'), 'TradeV4 left sidebar contains scroll behavior');
assert.ok(css.includes('.trade-v4-left-bottom-sentinel'), 'TradeV4 left sidebar bottom sentinel has CSS');

console.log('Trade left sidebar scroll regression tests PASSED.');
