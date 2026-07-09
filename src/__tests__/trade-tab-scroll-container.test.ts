import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const tradePage = readFileSync(new URL('../ui/pages/TradePage.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const tradeCss = readFileSync(new URL('../components/trade-v4/trade-v4.css', import.meta.url), 'utf8');

assert.ok(tradePage.includes('tradeScrollRef'), 'TradePage owns a real scroll container ref');
assert.ok(tradePage.includes('data-testid="trade-tab-scroll-container"'), 'Trade tab scroll container is test-addressable');
assert.ok(tradePage.includes('data-testid="trade-tab-layout"'), 'Trade tab layout wrapper is test-addressable');
assert.ok(tradePage.includes('TRADE_TAB_SCROLL_CONTAINER_AUDIT'), 'TradePage emits the required scroll-container audit');
assert.ok(tradePage.includes('viewportHeight'), 'Trade scroll audit includes viewport height');
assert.ok(tradePage.includes('appHeaderHeight'), 'Trade scroll audit includes app header height');
assert.ok(tradePage.includes('tabNavHeight'), 'Trade scroll audit includes tab nav height');
assert.ok(tradePage.includes('aiCommandCenterHeight'), 'Trade scroll audit includes AI Command Center height');
assert.ok(tradePage.includes('tradeScrollContainerClientHeight'), 'Trade scroll audit includes client height');
assert.ok(tradePage.includes('tradeScrollContainerScrollHeight'), 'Trade scroll audit includes scroll height');
assert.ok(tradePage.includes('canScrollVertically'), 'Trade scroll audit includes vertical scroll capability');
assert.ok(tradePage.includes('bottomPaddingPx'), 'Trade scroll audit includes bottom padding');
assert.ok(tradePage.includes('ai_command_center_update'), 'AI Command Center updates retrigger the scroll audit');

const mainContentRule = appCss.match(/\.main-content\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(mainContentRule.includes('display: flex'), 'Main content uses flex layout so AI header and active tab share viewport height');
assert.ok(mainContentRule.includes('flex-direction: column'), 'Main content stacks AI Command Center above the active tab');
assert.ok(mainContentRule.includes('min-height: 0'), 'Main content can shrink inside the app shell');
assert.ok(mainContentRule.includes('overflow: hidden'), 'Main content keeps body-level scrolling disabled');

const tradeRootRule = appCss.match(/\.trade-tab-root\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(tradeRootRule.includes('flex: 1 1 auto'), 'Trade tab root consumes remaining height below AI Command Center');
assert.ok(tradeRootRule.includes('min-height: 0'), 'Trade tab root can shrink inside flex layout');
assert.ok(tradeRootRule.includes('overflow-y: auto'), 'Trade tab root is the general vertical scroll container');
assert.ok(tradeRootRule.includes('overflow-x: hidden'), 'Trade tab root does not create full-app horizontal scroll');
assert.ok(tradeRootRule.includes('padding-bottom: calc(140px'), 'Trade tab root protects lower controls from viewport/taskbar clipping');
assert.ok(tradeRootRule.includes('overscroll-behavior: contain'), 'Trade tab root contains wheel/trackpad scroll behavior');

const tradeLayoutRule = appCss.match(/\.trade-tab-layout\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(tradeLayoutRule.includes('min-height: max-content'), 'Trade tab layout grows to content height');

const gridOverrideRule = appCss.match(/\.trade-tab-root \.trade-v4-grid-v3\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(gridOverrideRule.includes('height: auto'), 'Trade V4 grid stops forcing a clipped 100% height inside Trade tab scroll');
assert.ok(gridOverrideRule.includes('max-height: none'), 'Trade V4 grid is not capped inside the Trade tab scroll root');
assert.ok(gridOverrideRule.includes('overflow: visible'), 'Trade V4 grid lets the Trade tab root own vertical overflow');

const bodyOverrideRule = appCss.match(/\.trade-tab-root \.trade-v4-body-v3\s*\{[^}]+\}/)?.[0] ?? '';
assert.ok(bodyOverrideRule.includes('flex: 0 0 auto'), 'Trade V4 body contributes content height to the outer scroll root');
assert.ok(bodyOverrideRule.includes('min-height: 760px'), 'Trade V4 body keeps internal panels tall enough to preserve their own scroll windows');
assert.ok(bodyOverrideRule.includes('overflow: visible'), 'Trade V4 body does not clip lower Trade content');

assert.ok(tradeCss.includes('.panel-scroll-v4'), 'Panel scroll CSS still exists');
assert.ok(tradeCss.includes('.table-scroll-both'), 'Table scroll CSS still exists');
assert.ok(tradeCss.includes('.top-candidates-scroll'), 'Top Candidates internal scroll CSS still exists');
assert.ok(tradeCss.includes('.trade-v4-left'), 'Left sidebar scroll CSS still exists');
assert.ok(tradeCss.match(/\.trade-v4-left\s*\{[^}]+overflow-y: auto/), 'Left sidebar keeps internal vertical scroll');

console.log('Trade tab scroll container regression tests PASSED.');
