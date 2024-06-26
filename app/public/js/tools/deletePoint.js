/* global Microdraw */
/* global paper */

window.ToolDeletePoint = { deletePoint : (function() {
  var tool = {

    /**
     * @param {object} point The point where you clicked (x,y)
     * @returns {void}
     */
    // eslint-disable-next-line max-statements
    mouseDown : function mouseDown(point) {
      var hitResult = paper.project.hitTest(point, {
        tolerance : Microdraw.tolerance/paper.view.zoom,
        stroke : true,
        segments : true,
        fill : true,
        handles : true
      });
      // let prevRegion;
      Microdraw.newRegionFlag = false;

      if( hitResult ) {
        var i, re;
        for( i = 0; i < Microdraw.ImageInfo[Microdraw.currentImage].Regions.length; i += 1 ) {
          if( Microdraw.ImageInfo[Microdraw.currentImage].Regions[i].path === hitResult.item ) {
            re = Microdraw.ImageInfo[Microdraw.currentImage].Regions[i];
            break;
          }
        }

        // select path
        if( Microdraw.region && Microdraw.region !== re ) {
          Microdraw.region.path.selected = false;
          // prevRegion = Microdraw.region;
        }
        Microdraw.selectRegion(re);

        if( hitResult.type === 'segment' ) {
          hitResult.segment.remove();
          Microdraw.commitMouseUndo();
        }
      } else if( Microdraw.region ) {
        Microdraw.region.path.selected = false;
        Microdraw.region = null;
      }
      paper.view.draw();
    },

    /**
         * @function click
         * @desc add an additional point to the selected annotation
         * @param {string} prevTool The previous tool to which the selection goes back
         * @returns {void}
         */
    click : function click() {
      Microdraw.navEnabled = false;
      Microdraw.handle = null;
    }
  };


  return tool;
}())};
