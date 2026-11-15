/* global Microdraw */

window.ToolFront = {front: (function() {
  var tool = {

    /**
     * @desc Move the selected region to the front. One undo step
     * (Microdraw.moveRegion, T002 3.5; before, the order tools had none).
     * @returns {void}
     */
    click : function click() {
      const {currentImage, region} = Microdraw;
      if(region === null) {
        console.log("ERROR: no region selected");

        return;
      }
      const {Regions: regions} = Microdraw.ImageInfo[currentImage];
      Microdraw.moveRegion(region, regions.length - 1);

      Microdraw.backToSelect();
    }
  };

  return tool;
}())};
