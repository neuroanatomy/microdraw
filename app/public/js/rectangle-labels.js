/* global paper */

/*
  The text of the rectangle annotations: regions named "rectangleAnnotation",
  closed paths that keep their text in `data.text` and whose colour is their
  stroke colour. Only the path is saved. Its label is drawn from it, above its
  top-right corner, in a layer of its own: the active layer holds the regions
  only, in their paint order. Labels are locked, so that paper.js' hitTest
  skips them, and keep the same size on screen at any zoom. Used by the viewer
  (microdraw.js) and the embed page (embed-page.js).
*/
window.RectangleLabels = (function () {
  const NAME = 'rectangleAnnotation';
  const FONT_SIZE = 14; // px on screen
  const GAP = 5; // px on screen, between the rectangle and its label

  const findLayer = () => paper.project.layers.find((layer) => layer.data.isOverlay);

  /**
   * The layer above the regions, for what is drawn but is not a region: the
   * labels, and the rectangle being drawn
   * @returns {object} A paper.js layer, which is not the active one
   */
  const overlay = () => {
    let layer = findLayer();
    if (!layer) {
      const active = paper.project.activeLayer;
      layer = new paper.Layer({data: {isOverlay: true}});
      active.activate();
    }

    return layer;
  };

  const newLabel = (path) => {
    const {zoom} = paper.view;
    const {right, top} = path.bounds;
    const label = new paper.PointText({
      insert: false,
      point: [right, top - (GAP / zoom)],
      content: path.data.text,
      fillColor: path.strokeColor,
      fontSize: FONT_SIZE / zoom,
      fontFamily: 'sans-serif',
      justification: 'right'
    });
    label.locked = true;
    label.data = {labelOf: path.id};

    return label;
  };

  /**
   * Draw the labels again, after the rectangles or the zoom changed
   * @param {Array} paths The paths of the rectangle annotations of the slice;
   * those not drawn or hidden have no label
   * @returns {void}
   */
  const sync = (paths) => {
    if (paths.length === 0 && !findLayer()) {
      return;
    }
    const layer = overlay();
    layer.children.filter((item) => item.data.labelOf).forEach((item) => item.remove());
    paths
      .filter((path) => path.data.text && path.isInserted() && path.visible && path.opacity > 0)
      .forEach((path) => layer.addChild(newLabel(path)));
  };

  /**
   * @param {object} point A point, in project coordinates
   * @returns {number|undefined} The id of the path whose label is at `point`
   */
  const pathIdAt = (point) => {
    const layer = findLayer();
    const label = layer && layer.children.find((item) => item.data.labelOf && item.bounds.contains(point));

    return label ? label.data.labelOf : undefined; // eslint-disable-line no-undefined
  };

  return {NAME, overlay, sync, pathIdAt};
}());
