'use strict';

/*
  UI kit step 9b: the viewer's tool buttons are native
  <button type="button" class="nwl-tool-button"> (they were .mui divs), so Tab
  reaches them and Enter or Space clicks them, with no script. A pressed tool
  carries aria-pressed="true", set by mui.js with the class mui-pressed, and
  nwl-components' widgets.css gives it --nwl-bg-pressed.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

// the tools of a group, by id, with their aria-pressed
const ariaPressed = (page, group) => page.evaluate((g) => Object.fromEntries(Array.from(window.Microdraw.dom.querySelectorAll(`${g} .nwl-tool-button`))
  .map((el) => [el.id, el.getAttribute('aria-pressed')])), group);

const active = (page) => page.evaluate(() => {
  const el = window.Microdraw.dom.activeElement;
  const cs = el && getComputedStyle(el);

  return el && { id: el.id, outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
});

// counts the calls to Microdraw.clickTool, by tool
const spyClickTool = (page) => page.evaluate(() => {
  const original = window.Microdraw.clickTool;
  window.__clicks = [];
  window.Microdraw.clickTool = (tool) => { window.__clicks.push(tool); original(tool); };
});

let context;
let page;

// Tab to the next tool, press the key; the selected tool and the click tools' aria-pressed
const tabAndPress = async (key) => {
  await page.keyboard.press('Tab');
  await page.keyboard.press(key);

  return page.evaluate(() => ({
    focus: window.Microdraw.dom.activeElement.id,
    tool: window.Microdraw.selectedTool,
    pressed: Array.from(window.Microdraw.dom.querySelectorAll('#clickTool [aria-pressed="true"]')).map((el) => el.id)
  }));
};

const click = async (sel) => { await (await page.evaluateHandle((s) => window.Microdraw.dom.querySelector(s), sel)).click(); };

describe('Tool buttons (UI kit step 9b)', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, U.url(DATA_URL));
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('are buttons that do not submit, and only the toggles have aria-pressed', async () => {
    const tools = await page.evaluate(() => Array.from(window.Microdraw.dom.querySelectorAll('.mui')).map((el) => ({
      id: el.id, tag: el.tagName, type: el.getAttribute('type'), pressed: el.getAttribute('aria-pressed')
    })));
    assert.equal(tools.length, 42);
    assert.deepEqual(tools.filter((t) => t.tag !== 'BUTTON' || t.type !== 'button'), []);
    const toggles = tools.filter((t) => t.pressed !== null).map((t) => t.id);
    const expected = [
      'fullscreen', 'bubble', 'script', 'navigate', 'select', 'move', 'draw', 'drawPolygon', 'drawLine',
      'addPoint', 'deletePoint', 'addRegion', 'subtractRegion', 'splitRegion', 'rotate', 'flipRegion', 'textAnnotation'
    ];
    assert.deepEqual(toggles, expected);
  }).timeout(U.shortTimeout);

  it('reaches the tools with Tab, and shows the keyboard focus', async () => {
    await page.evaluate(() => { document.activeElement.blur(); }); // Tab from the start of the page
    let reached = null;
    for (let i = 0; i < 30 && !reached; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop
      reached = await page.evaluate(() => {
        const el = window.Microdraw.dom.activeElement;

        return el && el.classList.contains('nwl-tool-button') ? el.id : null;
      });
    }
    assert.equal(reached, 'display-minimize');
    // --nwl-focus: #e8e8e8, nwl-components 3.0.0's default (#fff before it)
    assert.deepEqual(await active(page), { id: 'display-minimize', outline: 'solid 2px rgb(232, 232, 232)' });
  }).timeout(U.shortTimeout);

  it('selects a tool with Space and with Enter, once each, as a click does', async () => {
    await spyClickTool(page);
    await page.evaluate(() => { window.Microdraw.dom.querySelector('#navigate').focus(); });
    assert.deepEqual(await tabAndPress('Space'), { focus: 'select', tool: 'select', pressed: ['select'] });
    assert.deepEqual(await tabAndPress('Enter'), { focus: 'move', tool: 'move', pressed: ['move'] });
    assert.deepEqual(await page.evaluate(() => window.__clicks), ['select', 'move']);
  }).timeout(U.shortTimeout);

  it('presses the clicked tool and releases the others of its group', async () => {
    await click('#draw');
    const clickTools = await ariaPressed(page, '#clickTool');
    assert.deepEqual(Object.entries(clickTools).filter(([, v]) => v === 'true'), [['draw', 'true']]);
    assert.equal(Object.values(clickTools).filter((v) => v === 'false').length, 13);
  }).timeout(U.shortTimeout);

  it('releases chat and script both when the pressed one is clicked again (chose3state)', async () => {
    await click('#script');
    assert.deepEqual(await ariaPressed(page, '#text'), { bubble: 'false', script: 'true' });
    await click('#script');
    assert.deepEqual(await ariaPressed(page, '#text'), { bubble: 'false', script: 'false' });
    await click('#bubble');
    assert.deepEqual(await ariaPressed(page, '#text'), { bubble: 'true', script: 'false' });
  }).timeout(U.shortTimeout);

  it('gives the pressed tool --nwl-bg-pressed, and none to the others', async () => {
    await page.mouse.move(5, U.height - 5); // no hover on a tool
    const bg = await page.evaluate(() => {
      const d = window.Microdraw.dom;
      const probe = document.createElement('div');
      probe.style.background = 'var(--nwl-bg-pressed)';
      document.body.appendChild(probe);
      const pressed = getComputedStyle(probe).backgroundColor;
      probe.remove();

      return {
        pressed,
        draw: getComputedStyle(d.querySelector('#draw')).backgroundColor,
        navigate: getComputedStyle(d.querySelector('#navigate')).backgroundColor
      };
    });
    // --nwl-bg-pressed: #404040, nwl-components 3.0.0's default (#555 before it)
    assert.deepEqual(bg, { pressed: 'rgb(64, 64, 64)', draw: 'rgb(64, 64, 64)', navigate: 'rgba(0, 0, 0, 0)' });
  }).timeout(U.shortTimeout);
});
