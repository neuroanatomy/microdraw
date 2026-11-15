/* global Microdraw */

window.ToolBack = {back: (function() {
  var tool = {

    /**
     * @desc Move the selected region to the back. One undo step
     * (Microdraw.moveRegion, T002 3.5; before, the order tools had none).
     * @returns {void}
     */
    click : function click() {
      const {region} = Microdraw;
      if(region === null) {
        console.log("ERROR: no region selected");

        return;
      }
      Microdraw.moveRegion(region, 0);

      Microdraw.backToSelect();
    }
  };

  return tool;
}())};
