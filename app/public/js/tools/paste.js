/* global Microdraw */

window.ToolPaste = { paste : (function() {
  const tool = {

    /**
         * @function click
         * @desc paste. Paste selected annotation
         * @param {string} prevTool The previous tool to which the selection goes back
         * @returns {void}
         */
    click : function click() {
      Microdraw.cmdPaste();
      Microdraw.backToSelect();
    }
  };

  return tool;
}())};
