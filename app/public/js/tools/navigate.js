/* global Microdraw */

window.ToolNavigate = { navigate : (function() {
  var tool = {

    /**
     * @function click
     * @desc navigate the canvas
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click : function click() {
      Microdraw.navEnabled = true;
      Microdraw.handle = null;
    }
  };

  return tool;
}())};
