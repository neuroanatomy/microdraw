/* eslint-disable max-lines -- long tool file, not split in a lint-only change; 2026-10-11 */
/* global Microdraw */

window.ToolLayers = { layers : (function() {
  const {dom} = Microdraw;
  const tool = {
    layers: [],
    rowTemplate: `
    <ul class="layer-item">
      <li><b><span style="width:70px">layer.name</span></b></li>
      <li><b class="layer-item"> Opacity (%):</b>
        <input class="layer-value" value="layer.opacity" onchange="Microdraw.tools.layers.changeOpacity(event)" />
        <input type="range" value="layer.opacity" min="0" max="100" oninput="Microdraw.tools.layers.changeOpacity(event)" style="width:100px"/>
        </li>
      <li><button onclick="Microdraw.tools.layers.deleteLayer(event)">Delete</button></li>
    </ul>
    `,
    rowTemplateFull: `
    <ul class="layer-item">
      <li><span style="width:300px;overflow-wrap:anywhere">layer.url</span></li>
      <li><b class="layer-item">Name:</b> <span style="width:70px">layer.name</span></li>
      <li><b class="layer-item"> Opacity (%):</b>
        <input class="layer-value" value="layer.opacity" onchange="Microdraw.tools.layers.changeOpacity(event)" />
        <input type="range" value="layer.opacity" min="0" max="100" oninput="Microdraw.tools.layers.changeOpacity(event)" style="width:100px"/>
        </li>
      <li><b class="layer-item">Position (%)</b>
        <input class="layer-value" value="0" onchange="Microdraw.tools.layers.changeX(event)" />
        <input class="layer-value" value="0" onchange="Microdraw.tools.layers.changeY(event)" />
        <button id="layer-position" onclick="Microdraw.tools.layers.changePosition(event)"></button></li>
      <li><b class="layer-item">Rotation (deg):</b> <input class="layer-value" value="0" onchange="Microdraw.tools.layers.changeRotation(event)" /></li>
      <li><b class="layer-item"> First slice:</b> <input class="layer-value" value="0" min="0" max="layer.maxSlice" onchange="Microdraw.tools.layers.changeFirstSlice(event)" /> (0 - layer.maxSlice)</li>
      <li><b class="layer-item"> Last slice:</b> <input class="layer-value" value="layer.maxSlice" min="0" max="layer.maxSlice" onchange="Microdraw.tools.layers.changeLastSlice(event)" /> (0 - layer.maxSlice)</li>
      <li><button onclick="Microdraw.tools.layers.deleteLayer(event)">Delete layer</button></li>
    </ul>
    `,
    fetchDZI: async (url) => {
      let dzi = null;

      try {
        // const _ = new URL(url);
        const response0 = await fetch(url, { method: 'HEAD' });
        if (response0.ok) {
          const response = await fetch(url);
          dzi = await response.json();
        }
      } catch (error) {
        console.log('Error:', error);
      }

      return dzi;
    },
    addRow: () => {
      dom.querySelector("#add-layer-panel").style.display = "block";
      dom.querySelector("#add-layer-button").style.display = "none";
      dom.querySelector("#layers-list").classList.add("small");
      console.log("addRow");
    },
    deleteLayer: (e) => {
      const div = e.target.closest("div.layer");

      // delete layer from layers array
      const index = tool.layers.findIndex((layer) => layer.el === div);
      if (index >= 0) {
        tool.layers.splice(index, 1);
      }

      // delete layer from UI
      div.remove();
      tool.updateURL();

      // reload the viewer
      const currentImageIndex = Microdraw.imageOrder.indexOf(Microdraw.currentImage);
      Microdraw.loadImage(currentImageIndex);
    },
    // eslint-disable-next-line max-statements
    changeOpacity: (e) => {
      const {value} = e.target;
      // closest parent element of type table
      const list = e.target.closest("#layers-list");
      const rows = list.querySelectorAll(".layer");
      const layerIndex = Array.from(rows).indexOf(e.target.closest(".layer"));

      if (e.target.type === "range") {
        e.target.parentElement.parentElement.querySelectorAll("input")[0].value = value;
      } else {
        e.target.parentElement.parentElement.querySelectorAll("input")[1].value = value;
      }

      tool.layers[layerIndex].opacity = value / 100;
      tool.updateURL();
      // the tiled image may not be in the world yet (it is added asynchronously)
      const item = Microdraw.viewer.world.getItemAt(layerIndex + 1);
      if (item) {
        item.setOpacity(value / 100);
      }
    },
    changeX: (e) => {
      let {value} = e.target;
      value /= 100;
      tool.layers[0].x = value;
      Microdraw.viewer.world.getItemAt(1).setPosition({x: value, y: tool.layers[0].y});
    },
    changeY: (e) => {
      let {value} = e.target;
      value /= 100;
      tool.layers[0].y = value;
      Microdraw.viewer.world.getItemAt(1).setPosition({x: tool.layers[0].x, y: value});
    },
    changeRotation: (e) => {
      const {value} = e.target;
      tool.layers[0].rotation = value;
      Microdraw.viewer.world.getItemAt(1).setRotation(value);
    },
    changeFirstSlice: (e) => {
      const {value} = e.target;
      tool.layers[0].firstSlice = Number(value);
    },
    changeLastSlice: (e) => {
      const {value} = e.target;
      tool.layers[0].lastSlice = Number(value);
    },

    /**
     * @desc Index of the layer's tile source matching the viewer's current slice
     * @param {object} layer A layer of tool.layers
     * @returns {number} Index into layer.imageSources.tileSources
     */
    _tileIndex: ({firstSlice, lastSlice, imageSources}) => {
      const currentImage = Microdraw.imageOrder.indexOf(Microdraw.currentImage);
      const lastViewerSlice = Microdraw.imageOrder.length - 1;
      let index = firstSlice;

      // with a single slice in the viewer there is no range to interpolate
      if (lastViewerSlice > 0) {
        index = Math.floor(firstSlice + currentImage * (lastSlice - firstSlice) / lastViewerSlice);
      }
      const maxIndex = imageSources.tileSources.length - 1;

      return Math.min(Math.max(index, 0), maxIndex);
    },
    _addLayerToViewer: (url, tileIndex, imageSources, opacity) => {
      let tileSource = imageSources.tileSources[tileIndex];
      if (!tileSource) {
        console.log("layers: no tile source for index", tileIndex);

        return;
      }
      if (tileSource[0] === "/") {
        const tmp = new URL(url);
        tileSource = tmp.origin + tileSource;
      }
      const options = {
        tileSource,
        opacity,
        compositeOperation: "source-over"
      };
      Microdraw.viewer.addTiledImage(options);
    },

    addLayer: (name, url, opacityPercent, dzi) => {
      const el = document.createElement("div");
      el.className = "layer";
      const rowInstance = tool.rowTemplate
        .replace("layer.name", () => tool._escapeHtml(name))
        .replace("layer.url", () => tool._escapeHtml(url))
        .replaceAll("layer.opacity", opacityPercent)
        .replaceAll("layer.maxSlice", dzi.tileSources.length - 1);
      el.innerHTML = rowInstance;
      dom.querySelector("#layers-list").appendChild(el);

      tool.layers.push({
        name,
        url,
        el,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: opacityPercent / 100,
        imageSources: dzi,
        firstSlice: 0,
        lastSlice: dzi.tileSources.length - 1
      });

      tool.updateLastLayer();
      tool.updateURL();
    },
    _updateLayersFromTable: () => {
      // update layer slice
      const arr = dom.querySelectorAll("#layers-panel table tr");
      for (let i = 1; i < arr.length; i++) {
        const tr = arr[i];
        const name = tr.querySelectorAll("span")[0].innerText;
        const url = tr.querySelectorAll("span")[1].innerText;
        const index = tool.layers.findIndex((layer) => layer.name === name && layer.url === url);
        const opacity = tr.querySelectorAll("input")[0].value / 100;
        tool.layers[index].opacity = opacity;
        Microdraw.viewer.world.getItemAt(index + 1).setOpacity(opacity);
      }
    },

    /**
     * @desc Update viewer layers with all available layers added
     * @returns {void}
     */
    updateAllLayers: () => {
      tool.layers.forEach((layer) => {
        tool._addLayerToViewer(layer.url, tool._tileIndex(layer), layer.imageSources, layer.opacity);
      });

      // update the layer
      tool._updateLayersFromTable();
    },

    /**
     * @desc Update viewer layers with the last layer added
     * @returns {void}
     */
    updateLastLayer: () => {
      // return if there's no layers
      if (tool.layers.length === 0) {
        return;
      }

      const layer = tool.layers[tool.layers.length - 1];
      tool._addLayerToViewer(layer.url, tool._tileIndex(layer), layer.imageSources, layer.opacity);

      // update the layer
      tool._updateLayersFromTable();
    },

    _escapeHtml: (text) => String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;"),

    /**
     * @desc Parse a JSON description of layers: an array of [name, url] or [name, url, opacityPercent]
     * @param {string} text Description of the layers
     * @returns {Array} Array of {name, url, opacity}, opacity in percent; empty if the text is not valid
     */
    parseLayers: (text) => {
      const toLayer = ([name, url, opacity]) => ({
        name: String(name).trim(),
        url: String(url).trim(),
        opacity: Number.isFinite(Number(opacity)) && opacity !== "" && typeof opacity !== "undefined" ? Number(opacity) : 50
      });

      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          return data.filter(Array.isArray).map(toLayer)
            .filter((layer) => layer.name && layer.url);
        }
      } catch (error) {
        // not JSON
      }

      return [];
    },

    /**
     * @desc Add several layers, fetching their description
     * @param {Array} list Array of {name, url, opacity}, opacity in percent
     * @returns {Promise<number>} Number of layers added
     */
    addLayers: async (list) => {
      let added = 0;
      for (const {name, url, opacity} of list) {
        // eslint-disable-next-line no-await-in-loop
        const dzi = await tool.fetchDZI(url);
        if (dzi && dzi.tileSources) {
          tool.addLayer(name, url, opacity, dzi);
          added += 1;
        } else {
          console.log("layers: could not load", url);
        }
      }

      return added;
    },

    /**
     * @desc Configure layers from the value of the layers URL parameter: either the
     * JSON format [["name","url"],...] or the older "url,name,opacity;..." format
     * @param {string} value Value of the parameter
     * @returns {Promise<number>} Number of layers added
     */
    loadFromParam: (value) => {
      let list = tool.parseLayers(value);
      if (list.length === 0 && !value.trim().startsWith("[")) {
        list = value.split(";").map((layer) => {
          const [url, name, opacity] = layer.split(",");

          return {name, url, opacity: typeof opacity === "undefined" ? 50 : parseFloat(opacity) * 100};
        })
          .filter((layer) => layer.name && layer.url);
      }

      return tool.addLayers(list);
    },

    /** @returns {void} Reflect the current layers in the URL, so that it can be bookmarked */
    updateURL: () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (tool.layers.length === 0) {
        urlParams.delete("layers");
      } else {
        urlParams.set("layers", JSON.stringify(tool.layers.map(({name, url, opacity}) => {
          const percent = Math.round(opacity * 100);

          return percent === 50 ? [name, url] : [name, url, percent];
        })));
      }
      const query = urlParams.toString();
      history.replaceState(history.state, "", window.location.pathname + (query ? "?" + query : ""));
    },

    // eslint-disable-next-line max-statements
    addLayerUI: async () => {
      const arr = dom.querySelectorAll("#add-layer-panel input");
      const name = arr[0].value;
      const url = arr[1].value;

      // check if url resolves and contains a good json
      const dzi = await tool.fetchDZI(url);
      if (!dzi) {
        arr[1].style.backgroundColor = "#fcc";

        return;
      }

      // cleanup the UI
      arr[1].parentElement.style.backgroundColor = "none";
      arr[0].value = "";
      arr[1].value = "";
      dom.querySelector("#add-layer-panel").style.display = "none";
      dom.querySelector("#add-layer-button").style.display = "block";
      dom.querySelector("#layers-list").classList.remove("small");

      // add the layer
      tool.addLayer(name, url, 0.5 * 100, dzi);
    },
    cancelAddLayerUI: () => {
      dom.querySelector("#add-layer-panel").style.display = "none";
      dom.querySelector("#add-layer-button").style.display = "block";
      dom.querySelector("#layers-list").classList.remove("small");
      console.log("cancelAddLayerUI");
    },
    _detachLayersContainer: () => {
      const obj = dom.querySelector("#layers-panel");
      obj.style.display = "none";
    },
    _isDragging: false,
    _offsetX: 0,
    _offsetY: 0,
    _handleStart: (obj) => {
      // eslint-disable-next-line max-statements -- existing handler, not refactored in a lint-only change; 2026-10-11
      const _start = (e) => {
        if (e.target.id !== "layers-header") { return; }

        e.preventDefault();
        e.stopPropagation();

        tool._isDragging = true;
        const {top, left, width, height} = obj.getBoundingClientRect();

        if (e.type === "touchstart") {
          // eslint-disable-next-line prefer-destructuring -- array destructuring would iterate the TouchList; keep index access; 2026-10-11
          e = e.touches[0];
        }

        tool._offsetX = e.clientX - left - width/2;
        tool._offsetY = e.clientY - top - (height)/2;
        obj.classList.add('dragging');
      };

      obj.querySelector("#layers-header").addEventListener('mousedown', _start);
      obj.querySelector("#layers-header").addEventListener('touchstart', _start);
    },
    _handleMove: (obj) => {
      const _move = (e) => {
        if (!tool._isDragging) { return; }

        if (e.type === "touchmove") {
          // eslint-disable-next-line prefer-destructuring -- array destructuring would iterate the TouchList; keep index access; 2026-10-11
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
    _attachLayersContainer: () => {
      const obj = dom.querySelector("#layers-panel");
      obj.style.display = "block";

      tool._handleStart(obj);
      tool._handleMove(obj);
      tool._handleEnd(obj);
    },

    _attachLayer: () => {
      const obj = dom.querySelector("#layers-panel");
      obj.style.display = "block";
    },

    /**
     * @desc Add layers of deep zoom images
     * @param {string} prevTool The previous tool to which the selection goes back
     * @returns {void}
     */
    click: function (prevTool) {
      tool._attachLayersContainer();
      Microdraw.selectedTool = prevTool;
    }
  };

  return tool;
}())};
