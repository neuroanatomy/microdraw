/* global Microdraw */
/* global paper */

window.ToolSplitRegion = {splitRegion: (function() {
  const tool = {
    _tol: 1e-6, // tolerance

    _findHitItem: function (point) {
      const hitResult = paper.project.hitTest(point, {
        tolerance : Microdraw.tolerance/paper.view.zoom,
        stroke: true,
        segments: true,
        fill: true,
        handles: true
      });
      if(!hitResult) {

        return;
      }
      let re;
      for( let i = 0; i < Microdraw.ImageInfo[Microdraw.currentImage].Regions.length; i += 1 ) {
        if( Microdraw.ImageInfo[Microdraw.currentImage].Regions[i].path === hitResult.item ) {
          re = Microdraw.ImageInfo[Microdraw.currentImage].Regions[i];
          break;
        }
      }

      return re;
    },

    _selectPathToSplit: function (item) {
      let prevRegion = null;
      if( Microdraw.region && Microdraw.region !== item ) {
        Microdraw.region.path.selected = false;
        prevRegion = Microdraw.region;
      }
      Microdraw.selectRegion(item);

      return prevRegion;
    },

    /**
     * Remove region from data structure and paperjs
     * @param {object} region Region to remove
     * @returns {void}
     */
    _removeRegion(region) {
      Microdraw.removeRegion(region);
      Microdraw.region.path.remove();
    },

    _zeros: function (m, n) {
      const M = [];
      for (let i = 0; i < m; i++) {
        M.push([]);
        for (let j = 0; j < n; j++) {
          M[i][j] = 0;
        }
      }

      return M;
    },

    _intersectArea: function (childi, childj) {
      const [path1, path2] = [
        (new paper.Path({insert: false})).importJSON(childi),
        (new paper.Path({insert: false})).importJSON(childj)
      ];
      const intersection = path1.intersect(path2);
      const [path1Area, path2Area, intersectArea] = [path1.area, path2.area, intersection.area];
      const [overlap1, overlap2] = [intersectArea/path1Area, intersectArea/path2Area];

      return [
        Math.abs(1 - Math.abs(overlap1)) < tool._tol ? 1 : 0,
        Math.abs(1 - Math.abs(overlap2)) < tool._tol ? 1 : 0
      ];
    },

    _overlaps: function (children) {
      const overlap = tool._zeros(children.length, children.length);

      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          [overlap[i][j], overlap[j][i]] = tool._intersectArea(children[i], children[j]);
        }
      }

      return overlap;
    },

    // eslint-disable-next-line max-statements
    _addRegionsFromNewPath(newPath, prevColor) {
      const obj = JSON.parse(newPath.exportJSON());
      const {children} = obj[1];
      const overlap = tool._overlaps(children);

      Microdraw.newRegionFlag = false;

      // remove the split path (result of the divide function)
      newPath.remove();

      // include each of the parts of the split path independently

      // scan the overlap matrix for each children
      for (let i = 0; i < children.length; i++) {

        // if its row is empty, then it's a new region
        if (overlap[i].every((val) => val === 0)) {
          let resultPath = new paper.Path({insert: false});
          resultPath.importJSON(children[i]);

          // look for a columns with overlap 1: they're the holes
          for (let j = 0; j < children.length; j++) {
            if (overlap[j][i] === 1) {
              const hole = new paper.Path({insert: false});
              hole.importJSON(children[j]).reorient();
              resultPath = resultPath.subtract(hole);
            }
          }

          paper.project.activeLayer.addChild(resultPath);

          // add the independent part as a new region
          Microdraw.newRegion({
            name: Microdraw.region.name,
            path: resultPath
          });
          // newReg.path.fillColor = prevColor;
        }
      }
    },

    _updateDisplay () {
      Microdraw.selectRegion(Microdraw.region);
      paper.view.draw();
    },

    // eslint-disable-next-line max-statements
    _splitRegion (point) {
      const hitItem = tool._findHitItem(point);
      if(!hitItem) {

        return;
      }

      /* selected region is prevRegion region is the region that should be split based on prevRegion
      newRegionPath is outlining that part of region which has not been overlaid by prevRegion
      i.e. newRegion is what was region and prevRegion color should go to the other part */
      const prevRegion = tool._selectPathToSplit(hitItem);
      if(!prevRegion) {
        return;
      }

      const {fillColor: prevColor} = prevRegion.path;
      const newPath = Microdraw.region.path.divide(prevRegion.path);

      // remove both regions from the active layer
      tool._removeRegion(Microdraw.region);
      tool._removeRegion(prevRegion);

      // add the new regions
      tool._addRegionsFromNewPath(newPath, prevColor);
    },

    /**
     * @function mouseDown
     * @param {object} point The point where you click (x,y)
     * @returns {void}
     */
    mouseDown: function mouseDown(point) {
      Microdraw.newRegionFlag = false;
      tool._splitRegion(point);
      tool._updateDisplay();
      Microdraw.commitMouseUndo();
      Microdraw.backToSelect();
    },

    /**
         * @function mouseUp
         * @returns {void}
         */
    // eslint-disable-next-line no-empty-function
    mouseUp: function mouseUp() {
    },

    /*
         * @function click
         * @param {string} prevTool The previous tool to which the selection goes back
         * @returns {void}
         */
    // eslint-disable-next-line no-empty-function
    click: function click() {
    }
  };

  return tool;
}())};
