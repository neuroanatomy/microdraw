/* global Microdraw */

window.ToolForeward = {foreward: (function() {
  var tool = {

    /**
     * @desc Move the selected region one step foreward. One undo step
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
      Microdraw.moveRegion(region, regions.indexOf(region) + 1);

      Microdraw.backToSelect();
    }
  };

  return tool;
}())};
