/* global Microdraw */
/* global paper */

window.ToolAddRegion = { addRegion : (function() {
  var tool = {
    _findHitRegion: function (hitResult) {
      const hitRegion = Microdraw.ImageInfo[Microdraw.currentImage].Regions.find((region) => region.path === hitResult.item);

      return hitRegion;
    },

    _findPreviousRegion: function () {
      let prevRegion = null;

      if( Microdraw.region) {
        Microdraw.region.path.selected = false;
        prevRegion = Microdraw.region;
      }

      return prevRegion;
    },

    _configureNewRegion: function (prevRegion, newPath) {
      Microdraw.removeRegion(prevRegion);
      Microdraw.region.path.remove();
      Microdraw.region.path = newPath;
      Microdraw.selectRegion(Microdraw.region);
    },

    _updateViewAndCommitUndo: function () {
      paper.view.draw();
      Microdraw.commitMouseUndo();
      Microdraw.backToSelect();
    },

    _unite: function (hitResult) {
      const hitRegion = tool._findHitRegion(hitResult);
      const prevRegion = tool._findPreviousRegion();

      if( !prevRegion || !hitRegion || hitRegion === prevRegion) {
        return;
      }

      // select hitRegion
      Microdraw.selectRegion(hitRegion);

      // compute path resulting from the union of prevRegion and current region
      const newPath = hitRegion.path.unite(prevRegion.path);

      // replace prevRegion's path with new one
      tool._configureNewRegion(prevRegion, newPath);

      // update view and commit undo
      tool._updateViewAndCommitUndo();
    },

    /**
     * @param {object} point The point where you clicked (x,y)
     * @returns {void}
     */
    mouseDown : function (point) {
      const hitResult = paper.project.hitTest(point, {
        tolerance : Microdraw.tolerance/paper.view.zoom,
        stroke : true,
        segments : true,
        fill : true,
        handles : true
      });

      Microdraw.newRegionFlag = false;

      if( hitResult ) {
        tool._unite(hitResult);
      } else if( Microdraw.region ) {
        Microdraw.region.path.selected = false;
        Microdraw.region = null;
      }
      paper.view.draw();
    },

    /**
     * @desc add an additional point to the selected annotation
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    // eslint-disable-next-line no-unused-vars
    click : function click(prevTool) {
      Microdraw.navEnabled = false;
      Microdraw.handle = null;
    }
  };

  return tool;
}())};
