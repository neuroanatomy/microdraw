/* global Microdraw, paper */
/* eslint max-lines: ["error", 500] */
'use strict';

const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

// The RectangleAnnotation tool: drag a rectangle, then give it a text and a
// colour. The text is drawn above its top-right corner.
/* eslint-disable max-statements -- each test follows one scenario */
describe('Rectangle annotations', () => {
  const project = U.createPublicAnnotationProject('e2erectangle');
  const pageUrl = () => U.url(`/data?source=/test_data/cat.json&project=${project.shortname}&slice=0`);
  const fileID = '/test_data/cat.json&slice=0';
  let context;
  let page;

  const inShadow = (sel) => page.evaluateHandle((s) => Microdraw.dom.querySelector(s), sel);
  const click = async (sel) => { await (await inShadow(sel)).click(); };
  const drag = async ([x0, y0], [x1, y1]) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
  };

  // the regions, the labels drawn and the panel
  const state = () => page.evaluate(() => {
    const panel = Microdraw.dom.querySelector('#rectangle-annotation-panel');
    const overlay = paper.project.layers.find((l) => l.data.isOverlay);
    const view = (p) => {
      const v = paper.view.projectToView(p);

      return [Math.round(v.x), Math.round(v.y)];
    };

    return {
      regions: Microdraw.ImageInfo[0].Regions.map((r) => ({
        name: r.name,
        text: r.path.data.text,
        color: r.path.strokeColor && r.path.strokeColor.toCSS(true),
        fillAlpha: r.path.fillColor && r.path.fillColor.alpha,
        segments: r.path.segments.length,
        topRight: view(r.path.bounds.topRight)
      })),
      labels: overlay
        ? overlay.children.filter((i) => i.data.labelOf).map((i) => ({
          content: i.content, color: i.fillColor.toCSS(true), anchor: view(i.point)
        }))
        : [],
      unfinished: overlay ? overlay.children.filter((i) => !i.data.labelOf).length : 0,
      panel: getComputedStyle(panel).display !== 'none' && {
        text: panel.querySelector('input[type="text"]').value,
        color: panel.querySelector('input[type="color"]').value,
        buttons: [...panel.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.action)
      }
    };
  });

  const fill = (text, color) => page.evaluate((t, c) => {
    const panel = Microdraw.dom.querySelector('#rectangle-annotation-panel');
    panel.querySelector('input[type="text"]').value = t;
    panel.querySelector('input[type="color"]').value = c;
  }, text, color);

  const button = (action) => click(`#rectangle-annotation-panel button[data-action="${action}"]`);

  before(async () => {
    await U.removeProject(project.shortname);
    await U.insertProject(project);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.logIn(page);
    await H.openData(page, pageUrl());
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
    }
  });

  it('asks for a text and a colour once a rectangle is drawn', async () => {
    await click('#rectangleAnnotation');
    await drag([400, 200], [600, 350]);
    const s = await state();
    assert.deepEqual(s.panel, { text: '', color: '#ff0000', buttons: ['add', 'cancel'] });
    assert.deepEqual(s.regions, [], 'no region before Add');
    assert.equal(s.unfinished, 1);
  }).timeout(U.shortTimeout);

  it('adds nothing on Cancel, or on a click without a drag', async () => {
    await button('cancel');
    await page.mouse.click(500, 300);
    const s = await state();
    assert.deepEqual([s.regions, s.unfinished, s.panel], [[], 0, false]);
  }).timeout(U.shortTimeout);

  it('adds the rectangle, with its text above its top-right corner', async () => {
    await drag([400, 200], [600, 350]);
    await fill('Lesion', '#00ff00');
    await button('add');
    const s = await state();
    assert.equal(s.panel, false);
    assert.equal(s.unfinished, 0);
    const [{ topRight, ...region }] = s.regions;
    assert.deepEqual(region, { name: 'rectangleAnnotation', text: 'Lesion', color: '#00ff00', fillAlpha: 0.001, segments: 4 });
    assert.lengthOf(s.labels, 1);
    assert.deepEqual([s.labels[0].content, s.labels[0].color], ['Lesion', '#00ff00']);
    assert.closeTo(s.labels[0].anchor[0], topRight[0], 1);
    assert.closeTo(s.labels[0].anchor[1], topRight[1] - 5, 1);
    assert.isTrue(await page.evaluate(() => Microdraw._isPaperRegionsOrderOk()));
  }).timeout(U.shortTimeout);

  it('is undone and redone in one step, with its label', async () => {
    await page.evaluate(() => Microdraw.cmdUndo());
    let s = await state();
    assert.deepEqual([s.regions.length, s.labels.length], [0, 0]);
    await page.evaluate(() => Microdraw.cmdRedo());
    s = await state();
    assert.deepEqual([s.regions.length, s.labels.length], [1, 1]);
  }).timeout(U.shortTimeout);

  it('is saved, and loaded again with its text and colour', async () => {
    await H.waitForSave(page, () => click('#save'));
    const [doc] = await U.findAnnotations({ fileID, project: project.shortname, backup: { $exists: false } });
    assert.equal(doc.annotation.name, 'rectangleAnnotation');
    assert.equal(doc.annotation.path[0], 'Path');
    assert.deepEqual(doc.annotation.path[1].data, { text: 'Lesion' });
    await H.openData(page, pageUrl());
    const s = await state();
    assert.deepEqual([s.regions[0].text, s.regions[0].color, s.regions[0].fillAlpha], ['Lesion', '#00ff00', 0.001]);
    assert.equal(s.labels[0].content, 'Lesion');
    assert.isNull(await page.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'loading is no change');
  }).timeout(U.mediumTimeout);

  it('is edited by clicking it with Select: text and colour, one undo step', async () => {
    await click('#select');
    await page.mouse.click(500, 280);
    assert.deepEqual((await state()).panel, { text: 'Lesion', color: '#00ff00', buttons: ['update', 'cancel'] });
    await fill('Tumour', '#ffff00');
    await button('update');
    let s = await state();
    assert.deepEqual([s.regions[0].text, s.regions[0].color, s.panel], ['Tumour', '#ffff00', false]);
    assert.deepEqual([s.labels[0].content, s.labels[0].color], ['Tumour', '#ffff00']);
    await page.evaluate(() => Microdraw.cmdUndo());
    s = await state();
    assert.deepEqual([s.labels[0].content, s.labels[0].color], ['Lesion', '#00ff00']);
  }).timeout(U.shortTimeout);

  it('is edited by clicking its label', async () => {
    const [x, y] = (await state()).regions[0].topRight;
    const box = await page.evaluate(() => {
      const { left, top } = Microdraw.dom.querySelector('#paperjs-container').getBoundingClientRect();

      return [left, top];
    });
    await page.mouse.click(box[0] + x - 10, box[1] + y - 9);
    assert.equal((await state()).panel.text, 'Lesion');
    await button('cancel');
  }).timeout(U.shortTimeout);

  // the corners of the first region on screen, in page coordinates, from the
  // top left one clockwise
  const corners = () => page.evaluate(() => {
    const { left, top } = Microdraw.dom.querySelector('#paperjs-container').getBoundingClientRect();
    const [{ path }] = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
    const points = path.segments.map((s) => {
      const v = paper.view.projectToView(s.point);

      return [Math.round(v.x + left), Math.round(v.y + top)];
    });
    const sum = ([x, y]) => x + y;
    const first = points.indexOf(points.reduce((a, b) => (sum(b) < sum(a) ? b : a)));
    const turned = points.map((p, i) => points[(first + i) % 4]);

    return path.clockwise ? turned : [turned[0], turned[3], turned[2], turned[1]];
  });
  const assertCorners = (actual, [left, top, right, bottom]) => {
    const expected = [[left, top], [right, top], [right, bottom], [left, bottom]];
    actual.flat().forEach((v, i) => assert.closeTo(v, expected.flat()[i], 2, JSON.stringify(actual)));
  };

  it('is resized by dragging a corner with Select, and stays a rectangle', async () => {
    await click('#select');
    const [[left, top], , [right, bottom]] = await corners();
    // the top right corner: the bottom left one stays
    await drag([right, top], [right + 40, top - 30]);
    assertCorners(await corners(), [left, top - 30, right + 40, bottom]);
    let s = await state();
    assert.equal(s.panel, false, 'a corner does not open the panel');
    assert.closeTo(s.labels[0].anchor[0], s.regions[0].topRight[0], 1, 'the label follows');
    assert.closeTo(s.labels[0].anchor[1], s.regions[0].topRight[1] - 5, 1);
    // one undo step for the whole drag
    await page.evaluate(() => Microdraw.cmdUndo());
    assertCorners(await corners(), [left, top, right, bottom]);
    s = await state();
    assert.deepEqual([s.regions.length, s.labels.length], [1, 1]);
  }).timeout(U.shortTimeout);

  it('is only moved with Move, by a corner too, and its panel does not open', async () => {
    await click('#move');
    const [[left, top], , [right, bottom]] = await corners();
    await drag([right, top], [right + 40, top - 30]);
    assertCorners(await corners(), [left + 40, top - 30, right + 40, bottom - 30]);
    assert.equal((await state()).panel, false);
    await page.evaluate(() => Microdraw.cmdUndo());
    assertCorners(await corners(), [left, top, right, bottom]);
  }).timeout(U.shortTimeout);

  it('can be dragged across the opposite corner, and never to nothing', async () => {
    await click('#select');
    const [[left, top], , [right, bottom]] = await corners();
    await drag([right, bottom], [left - 50, top - 40]);
    assertCorners(await corners(), [left - 50, top - 40, left, top]);
    // onto the opposite corner: a small rectangle is left, which can be resized again
    await drag([left - 50, top - 40], [left, top]);
    const size = await page.evaluate(() => {
      const { width, height } = Microdraw.ImageInfo[0].Regions[0].path.bounds;

      return [width * paper.view.zoom, height * paper.view.zoom];
    });
    size.forEach((v) => assert.closeTo(v, 4, 0.5));
    await page.evaluate(() => {
      Microdraw.cmdUndo();
      Microdraw.cmdUndo();
    });
    assertCorners(await corners(), [left, top, right, bottom]);
  }).timeout(U.shortTimeout);

  it('keeps its right angles when resized after a rotation', async () => {
    const result = await page.evaluate(() => {
      const [{ path }] = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
      const original = path.exportJSON();
      path.rotate(30);
      const tool = Microdraw.tools.rectangleAnnotation;
      const anchor = path.segments[3].point.clone();
      Microdraw.mouseUndo = null;
      tool.press(Microdraw.ImageInfo[0].Regions[0], { segment: path.segments[1] });
      tool.resize(path.segments[1].point.add(new paper.Point(37, -11)));
      tool.resizing = null;
      const side = (i) => path.segments[(i + 1) % 4].point.subtract(path.segments[i].point);
      const angles = [0, 1, 2, 3].map((i) => Math.round(Math.abs(side(i).getDirectedAngle(side((i + 1) % 4)))));
      const anchorMoved = path.segments[3].point.getDistance(anchor);
      path.importJSON(original);

      return { angles, anchorMoved };
    });
    assert.deepEqual(result.angles, [90, 90, 90, 90]);
    assert.closeTo(result.anchorMoved, 0, 1e-6);
  }).timeout(U.shortTimeout);

  const sizeFields = () => page.evaluate(() => ['width', 'height']
    .map((side) => Number(Microdraw.dom.querySelector(`#rectangle-annotation-panel input[data-size="${side}"]`).value)));
  const typeSize = (side, value) => page.evaluate((s, v) => {
    Microdraw.dom.querySelector(`#rectangle-annotation-panel input[data-size="${s}"]`).value = v;
  }, side, value);
  // the size of the first region in pixels of the image (cat.json: 480 wide)
  const imageSize = () => page.evaluate(() => {
    const [{ path }] = Microdraw.ImageInfo['0'].Regions;
    const scale = Microdraw.viewer.source.width / Microdraw.magicV;
    const side = (i) => path.segments[i].point.getDistance(path.segments[(i + 1) % 4].point) * scale;
    const sides = [side(0), side(1)];

    return path.segments[0].point.x === path.segments[1].point.x ? sides.reverse() : sides;
  });

  it('shows its width and height in image pixels, and takes typed ones', async () => {
    await click('#select');
    const original = await corners();
    const [width, height] = await imageSize();
    await page.mouse.click(500, 280);
    assert.deepEqual(await sizeFields(), [Math.round(width), Math.round(height)]);
    await typeSize('width', '200');
    await typeSize('height', '50');
    await button('update');
    const typed = await imageSize();
    assert.closeTo(typed[0], 200, 0.01);
    assert.closeTo(typed[1], 50, 0.01);
    const [topLeft] = await corners();
    assert.deepEqual(topLeft, original[0], 'the top left corner stays');
    const s = await state();
    assert.closeTo(s.labels[0].anchor[0], s.regions[0].topRight[0], 1, 'the label follows');
    await page.evaluate(() => Microdraw.cmdUndo());
    assertCorners(await corners(), [...original[0], ...original[2]]);
  }).timeout(U.shortTimeout);

  it('changes only the size typed; an empty or zero one changes nothing', async () => {
    const [width, height] = await imageSize();
    await page.mouse.click(500, 280);
    await typeSize('width', '100');
    await typeSize('height', '0');
    await button('update');
    const typed = await imageSize();
    assert.closeTo(typed[0], 100, 0.01);
    assert.closeTo(typed[1], height, 1e-6);
    await page.evaluate(() => Microdraw.cmdUndo());
    const exact = () => page.evaluate(() => Microdraw.ImageInfo['0'].Regions[0].path.exportJSON());
    const before = await exact();
    await page.mouse.click(500, 280);
    await typeSize('width', '');
    await button('update');
    assert.equal(await exact(), before, 'the rounded values shown change nothing');
    assert.closeTo((await imageSize())[0], width, 1e-6);
  }).timeout(U.shortTimeout);

  it('shows the new size in an open panel while a corner is dragged', async () => {
    await page.mouse.click(500, 280);
    const [width, height] = await sizeFields();
    // moved aside, so that it does not cover the corner
    await page.evaluate(() => {
      Object.assign(Microdraw.dom.querySelector('#rectangle-annotation-panel').style, { left: '0px', top: '300px', transform: 'none' });
    });
    const [, , [right, bottom]] = await corners();
    await drag([right, bottom], [right + 30, bottom + 20]);
    const after = await sizeFields();
    assert.isAbove(after[0], width);
    assert.isAbove(after[1], height);
    await button('cancel');
    await page.evaluate(() => {
      Microdraw.cmdUndo();
      Microdraw.dom.querySelector('#rectangle-annotation-panel').removeAttribute('style');
    });
  }).timeout(U.shortTimeout);

  it('gives a rectangle just drawn the size typed, and keeps a rotated one at right angles', async () => {
    await click('#rectangleAnnotation');
    await drag([620, 380], [700, 440]);
    await typeSize('width', '120');
    await typeSize('height', '40');
    await button('add');
    const result = await page.evaluate(() => {
      const [, reg] = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
      const scale = Microdraw.viewer.source.width / Microdraw.magicV;
      const size = [reg.path.bounds.width * scale, reg.path.bounds.height * scale].map(Math.round);
      // rotated by a quarter turn and a bit: the width is the side nearer to horizontal
      reg.path.rotate(100);
      const tool = Microdraw.tools.rectangleAnnotation;
      tool.edit(reg);
      const input = (s) => Microdraw.dom.querySelector(`#rectangle-annotation-panel input[data-size="${s}"]`);
      const shown = [input('width').value, input('height').value];
      input('width').value = '70';
      tool.update();
      const side = (i) => reg.path.segments[(i + 1) % 4].point.subtract(reg.path.segments[i].point);
      const angles = [0, 1, 2, 3].map((i) => Math.round(Math.abs(side(i).getDirectedAngle(side((i + 1) % 4)))));
      const lengths = [side(0).length, side(1).length].map((l) => Math.round(l * scale)).sort((a, b) => a - b);
      Microdraw.cmdUndo();
      Microdraw.cmdUndo();

      return { size, shown, angles, lengths };
    });
    assert.deepEqual(result, { size: [120, 40], shown: ['40', '120'], angles: [90, 90, 90, 90], lengths: [70, 120] });
    assert.equal((await state()).regions.length, 1);
  }).timeout(U.shortTimeout);

  it('is edited by a click with its own tool, and Enter confirms', async () => {
    await click('#rectangleAnnotation');
    await page.mouse.click(500, 280);
    await click('#rectangle-annotation-panel input[type="text"]');
    await page.keyboard.press('End');
    await page.keyboard.type(' 2');
    await page.keyboard.press('Enter');
    const s = await state();
    assert.deepEqual([s.regions.length, s.labels[0].content, s.panel], [1, 'Lesion 2', false]);
  }).timeout(U.shortTimeout);

  it('moves with its label', async () => {
    const [before] = (await state()).labels;
    await click('#move');
    await drag([500, 280], [560, 320]);
    const [after] = (await state()).labels;
    assert.closeTo(after.anchor[0] - before.anchor[0], 60, 8);
    assert.closeTo(after.anchor[1] - before.anchor[1], 40, 8);
    assert.equal((await state()).panel, false, 'Move does not edit');
  }).timeout(U.shortTimeout);

  it('keeps its label, colour and name through zoom, hide, label choice and paste', async () => {
    const s = await page.evaluate(() => {
      const [reg] = Microdraw.ImageInfo[0].Regions;
      const labels = () => paper.project.layers.find((l) => l.data.isOverlay).children;
      const height = () => labels()[0].bounds.height * paper.view.zoom;
      const before = height();
      Microdraw.viewer.viewport.zoomBy(2, null, true);
      Microdraw.viewer.viewport.applyConstraints(true);
      Microdraw.viewer.forceRedraw();
      Microdraw.transform();
      const zoomed = height();
      Microdraw.setRegionHidden(reg, true);
      const hidden = labels().length;
      Microdraw.setRegionHidden(reg, false);
      Microdraw.changeRegionName(reg, Microdraw.ontology.labels[1].name);
      Microdraw.region = reg;
      Microdraw.cmdCopy();
      Microdraw.cmdPaste();
      const [, pasted] = Microdraw.ImageInfo[Microdraw.currentImage].Regions;

      return {
        sameSize: Math.abs(zoomed - before) < 0.5,
        hidden,
        name: reg.name,
        pasted: [pasted.name, pasted.path.data.text, pasted.path.strokeColor.toCSS(true), pasted.path.fillColor.alpha],
        labels: labels().length
      };
    });
    assert.deepEqual(s, {
      sameSize: true,
      hidden: 0,
      name: 'rectangleAnnotation',
      pasted: ['rectangleAnnotation', 'Lesion 2', '#00ff00', 0.001],
      labels: 2
    });
  }).timeout(U.shortTimeout);

  it('shows its text in the Regions list', async () => {
    await click('#color');
    const rows = await page.evaluate(() => {
      window.RegionsList.render(true);

      return [...Microdraw.dom.querySelectorAll('#regions-table .region-text')].map((el) => el.textContent);
    });
    assert.deepEqual(rows, ['Lesion 2', 'Lesion 2']);
    await click('#labels-close');
  }).timeout(U.shortTimeout);

  it('is not changed by the geometry tools', async () => {
    const same = await page.evaluate(() => {
      const [reg] = Microdraw.ImageInfo[0].Regions;
      const before = reg.path.exportJSON();
      Microdraw.selectRegion(reg);
      Microdraw.simplify();
      Microdraw.tools.toBezier.polygonToBezier();

      return reg.path.exportJSON() === before;
    });
    assert.isTrue(same);
  }).timeout(U.shortTimeout);

  it('leaves with its label when deleted', async () => {
    const counts = await page.evaluate(() => {
      Microdraw.selectRegion(Microdraw.ImageInfo[0].Regions[1]);
      Microdraw.cmdDeleteSelected();

      return [Microdraw.ImageInfo[0].Regions.length, paper.project.layers.find((l) => l.data.isOverlay).children.length];
    });
    assert.deepEqual(counts, [1, 1]);
  }).timeout(U.shortTimeout);

  it('is drawn on the embed page with its colour and text', async () => {
    const embed = await context.newPage();
    await embed.setViewport({ width: U.width, height: U.height });
    await embed.goto(U.url(`/data?source=/test_data/cat.json&project=${project.shortname}&slice=0&embed=1`));
    await embed.waitForFunction(() => window.paper && paper.project
      && paper.project.layers.some((l) => l.data.isOverlay && l.children.length), { timeout: U.shortTimeout });
    const s = await embed.evaluate(() => {
      const { children: [item] } = paper.project.activeLayer;
      const [label] = paper.project.layers.find((l) => l.data.isOverlay).children;

      return [item.strokeColor.toCSS(true), item.fillColor.alpha, label.content];
    });
    assert.deepEqual(s, ['#00ff00', 0.001, 'Lesion']);
    await embed.close();
  }).timeout(U.mediumTimeout);
});
