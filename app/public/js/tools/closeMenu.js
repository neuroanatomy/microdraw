/* eslint-disable no-unused-vars */
/* global Microdraw */
/* global paper */

window.ToolCloseMenu = { closeMenu : (function() {
  var tool = {

    /**
     * @desc closeMenu. close the side menu
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click : function click(prevTool) {
      Microdraw.toggleMenu();
      Microdraw.backToPreviousTool(prevTool);
    }
  };

  return tool;
}())};
