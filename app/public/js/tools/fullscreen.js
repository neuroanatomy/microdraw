/* global Microdraw */

window.ToolFullscreen = { fullscreen : (function() {
  var tool = {
    _prevStyle: {},

    _configureParentElement: () => {
      if(document.querySelector("#microdraw")) {
        tool._displayMode = "project";
        tool._parentElement = document.querySelector("#microdraw");
      } else {
        tool._displayMode = "data";
        tool._parentElement = document.querySelector("#content");
      }
    },

    _enterFullscreen: () => {
      tool._prevStyle.height = tool._parentElement.style.height;

      tool._parentElement.style.position = "fixed";
      tool._parentElement.style.top = 0;
      tool._parentElement.style.left = 0;
      tool._parentElement.style.height = "100%";

      if(tool._displayMode === "project") {
        document.querySelector("#resizeButton").style.display = "none";
      }

      // the toolbar can be dragged by its header (M4e)
      Microdraw.dom.querySelector("body").setAttribute("data-fullscreen", "true");
    },

    _exitFullscreen: () => {
      tool._parentElement.style.position = "";
      tool._parentElement.style.top = "";
      tool._parentElement.style.left = "";
      tool._parentElement.style.height = tool._prevStyle.height;

      if(tool._displayMode === "project") {
        document.querySelector("#resizeButton").style.display = "";
      }

      // a toolbar dragged in full screen goes back to its side (M4e)
      Microdraw.dom.querySelector("body").removeAttribute("data-fullscreen");
      Microdraw.dockFreeToolbar();
    },

    /**
     * @function click
     * @desc Toggle the full screen
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click : function click(prevTool) {
      tool._configureParentElement();
      const isFullscreen = tool._parentElement.style.position === "fixed";
      if(isFullscreen) {
        tool._exitFullscreen();
      } else {
        tool._enterFullscreen();
      }
      Microdraw.resizeAnnotationOverlay();
      Microdraw.backToPreviousTool(prevTool);
    }
  };

  return tool;
}())};
