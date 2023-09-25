/* global Microdraw */

window.ToolDelete = { delete : (function() {
  var tool = {

    /**
     * @desc add an additional point to the selected annotation
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click : function click(prevTool) {
      Microdraw.cmdDeleteSelected();
      Microdraw.backToPreviousTool(prevTool);
    }
  };

  return tool;
}())};
