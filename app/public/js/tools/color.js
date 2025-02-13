/* global Microdraw */

window.ToolColor = { color : (function() {
  const {dom} = Microdraw;
  var tool = {
    _findSelectedRegion: function () {
      const {currentImage, region} = Microdraw;
      const {Regions: regions} = Microdraw.ImageInfo[currentImage];
      let regionIndex = null;
      for(let i=0; i<regions.length; i+=1) {
        if(regions[i].uid === region.uid) {
          regionIndex = i;
          break;
        }
      }

      return regionIndex;
    },

    _handleStart: (obj) => {
      // eslint-disable-next-line max-statements
      const _start = (e) => {
        if (e.target.id !== "labelset-header") { return; }

        e.preventDefault();
        e.stopPropagation();

        tool._isDragging = true;
        const {top, left, width, height} = obj.getBoundingClientRect();

        if (e.type === "touchstart") {
          e = e.touches[0];
        }

        tool._offsetX = e.clientX - left - width/2;
        tool._offsetY = e.clientY - top - (height)/2;
        obj.classList.add('dragging');
      };

      obj.querySelector("#labelset-header").addEventListener('mousedown', _start);
      obj.querySelector("#labelset-header").addEventListener('touchstart', _start);
    },

    _handleMove: (obj) => {
      const _move = (e) => {
        if (!tool._isDragging) { return; }

        if (e.type === "touchmove") {
          e = e.touches[0];
        }
        obj.style.left = (e.clientX - tool._offsetX) + 'px';
        obj.style.top = (e.clientY - tool._offsetY) + 'px';
      };
      dom.addEventListener('mousemove', _move);
      dom.addEventListener('touchmove', _move);
    },

    _handleEnd: (obj) => {
      const _end = () => {
        if (!tool._isDragging) { return; }
        tool._isDragging = false;
        obj.classList.remove('dragging');
      };
      dom.addEventListener('mouseup', _end);
      dom.addEventListener('touchend', _end);
    },

    _detachLabelsetContainer: () => {
      const obj = dom.querySelector("#labelset-panel");
      obj.style.display = "none";
    },

    _attachLabelsetContainer: () => {
      const obj = dom.querySelector("#labelset-panel");
      dom.querySelector("body").appendChild(obj);
      obj.style.display = "block";

      obj.querySelector("span#labels-name").textContent = Microdraw.ontology.name;
      obj.querySelector("#labels-close").onclick = tool._detachLabelsetContainer;
      obj.querySelector("#label-list").innerHTML = "";

      tool._handleStart(obj);
      tool._handleMove(obj);
      tool._handleEnd(obj);
    },

    // eslint-disable-next-line max-statements
    _handleLabelDisplayClick: (e, l) => {
      const me = Microdraw;
      const {name: targetName} = l;

      // switch the visibility of the label
      e.target.classList.toggle("off");

      // find out what the new visibility is
      const invisible = e.target.classList.contains("off");

      // update the visibility in the Microdraw.ontology object
      for (let j=0; j < me.ontology.labels.length; j+=1) {
        const {name} = me.ontology.labels[j];
        if(name === targetName) {
          me.ontology.labels[j].visible = !invisible;
        }
      }

      // update the display of the regions
      const regions = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
      for(let j=0; j<regions.length; j+=1) {
        if(regions[j].name === targetName) {
          regions[j].path.opacity = invisible ? 0 : 1;
        }
      }
    },

    _handleLabelColorClick: (l, i) => {
      Microdraw.currentLabelIndex = i;
      const regionIndex = tool._findSelectedRegion();
      if(typeof regionIndex !== "undefined") {
        console.log(regionIndex);
        const {region} = Microdraw;
        if (typeof region !== "undefined") {
          Microdraw.changeRegionName(region, l.name);
        }
      }
      Microdraw.updateLabelDisplay();
      tool._detachLabelsetContainer();
    },

    // eslint-disable-next-line max-statements
    _attachLabel: (l, i) => {
      const obj = dom.querySelector("#labelset-panel");
      const la = obj.querySelector("#label-template").cloneNode(true);

      la.setAttribute("data-index", i);
      la.querySelector(".label-color").style["background-color"] = `rgb(${l.color[0]},${l.color[1]},${l.color[2]})`;
      la.querySelector(".label-name").textContent = l.name;
      if (Microdraw._isRegionVisible(l.name)) {
        la.querySelector(".label-display").classList.remove("off");
      } else {
        la.querySelector(".label-display").classList.add("off");
      }

      la.querySelector(".label-color").onclick = () => { tool._handleLabelColorClick(l, i); };
      la.querySelector(".label-display").onclick = (e) => { tool._handleLabelDisplayClick(e, l); };

      obj.querySelector("#label-list").appendChild(la);
      la.style.display = "block";
    },

    /**
     * @desc Select a color to draw with
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click: function (prevTool) {
      const me = Microdraw;
      tool._attachLabelsetContainer();
      for(let i = 0; i<me.ontology.labels.length; i += 1) {
        const l = me.ontology.labels[i];
        tool._attachLabel(l, i);
      }
      Microdraw.selectedTool = prevTool;
    }
  };

  return tool;
}())};
