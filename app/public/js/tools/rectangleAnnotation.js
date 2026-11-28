/* global Microdraw, RectangleLabels */
/* global paper */
/* eslint max-lines: ["error", 400] */

// eslint-disable-next-line max-statements -- the panel's helpers and the tool, as the other tools
window.ToolRectangleAnnotation = {rectangleAnnotation: (function() {
  const {dom} = Microdraw;
  const MIN_SIZE = 4; // px on screen: anything smaller is a click, not a rectangle
  const STROKE_WIDTH = 2;
  // not seen, but not 0: paper.js' hitTest ignores a fill of alpha 0
  const FILL_ALPHA = 0.001;

  const panel = () => dom.querySelector('#rectangle-annotation-panel');
  const textInput = () => panel().querySelector('input[type="text"]');
  const colorInput = () => panel().querySelector('input[type="color"]');

  const setColor = (path, color) => {
    path.strokeColor = color;
    // the image is seen through it, and a click inside hits it
    const fill = new paper.Color(color);
    fill.alpha = FILL_ALPHA;
    path.fillColor = fill;
  };

  const sizeInput = (side) => panel().querySelector(`input[data-size="${side}"]`);

  // width and height are typed and shown in pixels of the full image, which is
  // Microdraw.magicV paper.js units wide: they don't change with the zoom
  const pixelsPerUnit = () => Microdraw.viewer.source.width / Microdraw.magicV;

  // the sides from the top left corner: the width is the one nearer to
  // horizontal (the rectangle may have been rotated)
  const sidesOf = (path) => {
    const points = path.segments.map((s) => s.point);
    const sums = points.map((p) => p.x + p.y);
    const first = sums.indexOf(Math.min(...sums));
    const side = (step) => points[(first + step) % 4].subtract(points[first]);
    const [next, previous] = [side(1), side(3)];
    const nextIsWidth = Math.abs(next.x) * previous.length >= Math.abs(previous.x) * next.length;

    return {first, nextIsWidth, width: nextIsWidth ? next : previous, height: nextIsWidth ? previous : next};
  };

  const shownSize = {}; // as the fields were filled, to know which were changed

  const showSize = (path) => {
    const sides = sidesOf(path);
    ['width', 'height'].forEach((side) => {
      shownSize[side] = String(Math.round(sides[side].length * pixelsPerUnit()));
      sizeInput(side).value = shownSize[side];
    });
  };

  // the sizes typed, in paper.js units: only those changed (the fields are
  // rounded) to at least 1 pixel
  const typedSize = () => Object.fromEntries(['width', 'height']
    .map((side) => [side, sizeInput(side).value, shownSize[side]])
    .filter(([, value, shown]) => value !== shown && Number(value) >= 1)
    .map(([side, value]) => [side, Number(value) / pixelsPerUnit()]));

  // give a rectangle new sizes: its top left corner stays, and its directions
  const setSize = (path, size) => {
    const {first, nextIsWidth, width, height} = sidesOf(path);
    const corner = path.segments[first].point.clone();
    const sized = (side, length) => (length ? side.normalize(length) : side);
    const [w, h] = [sized(width, size.width), sized(height, size.height)];
    const [next, previous] = nextIsWidth ? [w, h] : [h, w];
    [next, next.add(previous), previous].forEach((side, i) => {
      path.segments[(first + i + 1) % 4].point = corner.add(side);
    });
  };

  const openPanel = ({path, text, color, isNew}) => {
    // one annotation panel at a time: they share their place on screen
    dom.querySelector('#text-annotation-panel').style.display = 'none';
    textInput().value = text;
    showSize(path);
    if (color) {
      colorInput().value = color;
    }
    panel().querySelector('[data-action="add"]').style.display = isNew ? 'inline-block' : 'none';
    panel().querySelector('[data-action="update"]').style.display = isNew ? 'none' : 'inline-block';
    panel().style.display = 'flex';
  };

  // true if the drag drew something larger than a click
  const isDrawn = (path) => Boolean(path) && Math.min(path.bounds.width, path.bounds.height) >= MIN_SIZE / paper.view.zoom;

  // a corner grabbed: the opposite corner stays, and the rectangle keeps the
  // directions of its sides (it may have been rotated)
  const newResize = (path, index) => {
    const corner = (i) => path.segments[(index + i) % 4].point.clone();
    const anchor = corner(2);
    const axis = (i) => {
      const side = corner(i).subtract(anchor);

      return {direction: side.normalize(), sign: Math.sign(side.length)};
    };

    // the corners beside the grabbed one: one on each side from the anchor
    return {path, index, anchor, a: axis(1), b: axis(3)};
  };

  // how far along a side the pointer is, from the anchor; never so close to 0
  // that the rectangle is lost (it may cross over to the other side)
  const sideLength = (offset, axis) => {
    const length = offset.dot(axis.direction);
    const min = MIN_SIZE / paper.view.zoom;

    return Math.abs(length) < min ? min * (Math.sign(length) || axis.sign) : length;
  };

  const tool = {
    resizing: null, // the corner being dragged, with Select
    start: null, // the corner where the drag started
    pending: null, // the rectangle drawn, not yet added: no region, never saved
    editedUid: null, // the region the panel edits
    editedPath: null, // and its path

    /**
     * Close the panel, and forget the rectangle not yet added
     * @returns {void}
     */
    cancel: () => {
      if (tool.pending) {
        tool.pending.remove();
      }
      tool.pending = null;
      tool.start = null;
      tool.editedUid = null;
      tool.editedPath = null;
      panel().style.display = 'none';
    },

    /**
     * A press with Select: on a corner of a rectangle annotation, the
     * drag that may follow resizes it; elsewhere on its outline or its text,
     * its panel opens
     * @param {object} reg The rectangle annotation hit
     * @param {object} hitResult The hit result of paper.js
     * @returns {void}
     */
    press: (reg, hitResult) => {
      if (hitResult.segment) {
        tool.resizing = newResize(reg.path, hitResult.segment.index);
      } else {
        tool.edit(reg);
      }
    },

    /**
     * Move the grabbed corner to `point`. The two corners beside it follow, so
     * that it stays a rectangle. One undo step for the whole drag.
     * @param {object} point Where the pointer is
     * @returns {boolean} true if a corner is grabbed
     */
    // eslint-disable-next-line max-statements
    resize: (point) => {
      if (!tool.resizing) {
        return false;
      }
      const {path, index, anchor, a, b} = tool.resizing;
      const offset = point.subtract(anchor);
      const sideA = a.direction.multiply(sideLength(offset, a));
      const sideB = b.direction.multiply(sideLength(offset, b));
      Microdraw.commitMouseUndo();
      [sideA.add(sideB), sideA, null, sideB].forEach((side, i) => {
        if (side) {
          path.segments[(index + i) % 4].point = anchor.add(side);
        }
      });

      // an open panel shows the new size
      if (panel().style.display !== 'none' && tool.editedPath === path) {
        showSize(path);
      }

      return true;
    },

    /**
     * Show the text, colour and size of a rectangle annotation, to change them
     * @param {object} reg A rectangle annotation of the current slice
     * @returns {void}
     */
    edit: (reg) => {
      tool.cancel();
      tool.editedUid = reg.uid;
      tool.editedPath = reg.path;
      openPanel({path: reg.path, text: reg.path.data.text || '', color: reg.path.strokeColor.toCSS(true), isNew: false});
    },

    // the rectangle drawn becomes a region, with its text and colour
    // eslint-disable-next-line max-statements
    add: () => {
      const path = tool.pending;
      if (!path) {
        return tool.cancel();
      }
      Microdraw.saveUndo(Microdraw.getUndo());
      setSize(path, typedSize());
      path.data = {text: textInput().value.trim()};
      setColor(path, colorInput().value);
      paper.project.activeLayer.addChild(path);
      tool.pending = null;
      Microdraw.selectRegion(Microdraw.newRegion({path, name: RectangleLabels.NAME}));
      tool.cancel();
    },

    // eslint-disable-next-line max-statements
    update: () => {
      // by uid: undo or a live update may have replaced the region since
      const reg = Microdraw.ImageInfo[Microdraw.currentImage].Regions.find((r) => r.uid === tool.editedUid);
      const text = textInput().value.trim();
      const color = colorInput().value;
      const size = typedSize();
      if (reg && (text !== reg.path.data.text || color !== reg.path.strokeColor.toCSS(true) || Object.keys(size).length)) {
        Microdraw.saveUndo(Microdraw.getUndo());
        setSize(reg.path, size);
        reg.path.data.text = text;
        setColor(reg.path, color);
        Microdraw.regionsChanged();
        paper.view.draw();
      }
      tool.cancel();
    },

    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        tool[tool.pending ? 'add' : 'update']();
      } else if (event.key === 'Escape') {
        tool.cancel();
      }
    },

    /**
     * @function mouseDown
     * @param {object} point The point where you click (x,y)
     * @returns {void}
     */
    mouseDown: (point) => {
      tool.cancel();
      if (Microdraw.region) {
        Microdraw.region.path.selected = false;
        Microdraw.region = null;
      }
      tool.start = point;
    },

    /**
     * @function mouseDrag
     * @param {object} point The point where you moved to (x,y)
     * @returns {void}
     */
    mouseDrag: (point) => {
      if (!tool.start) {
        return;
      }
      if (tool.pending) {
        tool.pending.remove();
      }
      tool.pending = new paper.Path.Rectangle({from: tool.start, to: point, insert: false});
      tool.pending.strokeWidth = STROKE_WIDTH;
      tool.pending.strokeScaling = false;
      setColor(tool.pending, colorInput().value);
      RectangleLabels.overlay().addChild(tool.pending);
    },

    /**
     * @function mouseUp
     * @desc After a drag, ask for the text and colour, and show the size. A click on a rectangle
     * annotation edits it.
     * @returns {void}
     */
    // eslint-disable-next-line max-statements
    mouseUp: () => {
      const {start} = tool;
      if (!start) {
        return;
      }
      tool.start = null;
      if (isDrawn(tool.pending)) {
        openPanel({path: tool.pending, text: '', isNew: true});

        return textInput().focus();
      }
      tool.cancel();
      const reg = Microdraw.rectangleAt(start);
      if (reg) {
        Microdraw.selectRegion(reg);
        tool.edit(reg);
      }
    },

    // a drag interrupted by another tool is dropped; a rectangle already drawn
    // waits for its text
    onDeselect: () => {
      if (tool.start) {
        tool.cancel();
      }
    },

    /**
     * @function click
     * @returns {void}
     */
    click: () => {
      Microdraw.navEnabled = false;
    }
  };

  return tool;
}())};
