<template>
  <Row centered>
    <RangeSlider
      :max="totalSlices"
      v-model="currentSlice"
      @update:model-value="sliceChange"
    />
  </Row>
  <Row>
    <Button
      @click="toggleFullscreen()"
      title="Full screen"
    >
      <img
        class="icon"
        alt="Full screen"
        src="/img/fullscreen.svg"
      >
    </Button>
    <ButtonsGroup>
      <Button
        @click="toggleChat()"
        title="Chat"
        :class="{ pressed: displayChat }"
      >
        <img
          class="icon"
          alt="Chat"
          src="/img/chat.svg"
        >
      </Button>
      <Button
        @click="toggleScript()"
        title="Script"
        :class="{ pressed: displayScript }"
      >
        <img
          class="icon"
          alt="Script"
          src="/img/scroll.svg"
        >
      </Button>
    </ButtonsGroup>
    <Button
      id="home"
      @click="selectTool($event)"
      title="Home"
    >
      <img
        class="icon"
        alt="Home"
        src="/img/home.svg"
      >
    </Button>
    <Button
      id="zoomIn"
      @click="selectTool($event)"
      title="Zoom In"
    >
      <img
        class="icon"
        alt="Zoom In"
        src="/img/zoomIn.svg"
      >
    </Button>
    <Button
      id="zoomOut"
      @click="selectTool($event)"
      title="Zoom Out"
    >
      <img
        class="icon"
        alt="Zoom Out"
        src="/img/zoomOut.svg"
      >
    </Button>
  </Row>
  <ButtonsGroup class="clickTools">
    <Button
      :class="{ pressed: currentTool === 'navigate' }"
      id="navigate"
      @click="selectTool($event)"
      title="Navigate"
    >
      <img
        class="icon"
        alt="Navigate"
        src="/img/navigate.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'select' }"
      id="select"
      @click="selectTool($event)"
      title="Select"
    >
      <img
        class="icon"
        alt="Select"
        src="/img/select.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'move' }"
      id="move"
      @click="selectTool($event)"
      title="Move"
    >
      <img
        class="icon"
        alt="Move"
        src="/img/move.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'draw' }"
      id="draw"
      @click="selectTool($event)"
      title="Draw"
    >
      <img
        class="icon"
        alt="Draw"
        src="/img/draw.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'drawPolygon' }"
      id="drawPolygon"
      @click="selectTool($event)"
      title="Draw Polygon"
    >
      <img
        class="icon"
        alt="Draw Polygon"
        src="/img/drawPolygon.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'drawLine' }"
      id="drawLine"
      @click="selectTool($event)"
      title="Draw Line"
    >
      <img
        class="icon"
        alt="Draw Line"
        src="/img/drawLine.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'addPoint' }"
      id="addPoint"
      @click="selectTool($event)"
      title="Add point"
    >
      <img
        class="icon"
        alt="Add point"
        src="/img/addPoint.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'deletePoint' }"
      id="deletePoint"
      @click="selectTool($event)"
      title="Delete point"
    >
      <img
        class="icon"
        alt="Delete Point"
        src="/img/deletePoint.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'addRegion' }"
      id="addRegion"
      @click="selectTool($event)"
      title="Add region"
    >
      <img
        class="icon"
        alt="Add region"
        src="/img/addRegion.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'subtractRegion' }"
      id="subtractRegion"
      @click="selectTool($event)"
      title="Subtract region"
    >
      <img
        class="icon"
        alt="Subtract region"
        src="/img/subtractRegion.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'splitRegion' }"
      id="splitRegion"
      @click="selectTool($event)"
      title="Split region"
    >
      <img
        class="icon"
        alt="Split region"
        src="/img/splitRegion.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'rotate' }"
      id="rotate"
      @click="selectTool($event)"
      title="Rotate"
    >
      <img
        class="icon"
        alt="Rotate"
        src="/img/rotate.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'flipRegion' }"
      id="flipRegion"
      @click="selectTool($event)"
      title="Flip region"
    >
      <img
        class="icon"
        alt="Flip region"
        src="/img/flipRegion.svg"
      >
    </Button>
    <Button
      :class="{ pressed: currentTool === 'textAnnotation' }"
      id="textAnnotation"
      @click="selectTool($event)"
      title="textAnnotation"
    >
      <img
        class="icon"
        alt="textAnnotation"
        src="/img/textAnnotation.svg"
      >
    </Button>
  </ButtonsGroup>
  <Row>
    <Button
      style="padding: 1px"
      @click="toggleOntology()"
      v-if="
        ontology != null &&
          ontology.labels != null &&
          ontology.labels[currentLabel] != null
      "
    >
      <div
        class="color"
        :style="`background-color: rgb(${ontology.labels[currentLabel].color[0]}, ${ontology.labels[currentLabel].color[1]}, ${ontology.labels[currentLabel].color[2]})`"
      />
    </Button>
    <Button
      id="layers"
      @click="toggleLayers()"
      title="Layers"
    >
      <img
        class="icon"
        alt="Layers"
        src="/img/layers.svg"
      >
    </Button>
    <Button
      id="back"
      @click="selectTool($event)"
      title="Back"
    >
      <img
        class="icon"
        alt="Back"
        src="/img/back.svg"
      >
    </Button>
    <Button
      id="backward"
      @click="selectTool($event)"
      title="Backward"
    >
      <img
        class="icon"
        alt="Backward"
        src="/img/backward.svg"
      >
    </Button>
    <Button
      id="foreward"
      @click="selectTool($event)"
      title="Foreward"
    >
      <img
        class="icon"
        alt="Foreward"
        src="/img/foreward.svg"
      >
    </Button>
    <Button
      id="front"
      @click="selectTool($event)"
      title="Front"
    >
      <img
        class="icon"
        alt="Front"
        src="/img/front.svg"
      >
    </Button>
  </Row>
  <Row>
    <Button
      id="simplify"
      @click="selectTool($event)"
      title="Simplify"
    >
      <img
        class="icon"
        alt="Simplify"
        src="/img/simplify.svg"
      >
    </Button>
    <Button
      id="toPolygon"
      @click="selectTool($event)"
      title="To Polygon"
    >
      <img
        class="icon"
        alt="To Polygon"
        src="/img/toPolygon.svg"
      >
    </Button>
    <Button
      id="toBezier"
      @click="selectTool($event)"
      title="To Bezier"
    >
      <img
        class="icon"
        alt="To Bezier"
        src="/img/toBezier.svg"
      >
    </Button>
    <Button
      id="copy"
      @click="selectTool($event)"
      title="Copy"
    >
      <img
        class="icon"
        alt="Copy"
        src="/img/copy.svg"
      >
    </Button>
    <Button
      id="paste"
      @click="selectTool($event)"
      title="Paste"
    >
      <img
        class="icon"
        alt="Copy"
        src="/img/paste.svg"
      >
    </Button>
  </Row>
  <Row>
    <Button
      id="save"
      @click="selectTool($event)"
      title="Save"
    >
      <img
        class="icon"
        alt="Save"
        src="/img/save.svg"
      >
    </Button>
    <Button
      id="screenshot"
      @click="selectTool($event)"
      title="Screenshot"
    >
      <img
        class="icon"
        alt="Screenshot"
        src="/img/screenshot.svg"
      >
    </Button>
    <Button
      id="doDelete"
      @click="selectTool($event)"
      title="Delete"
    >
      <img
        class="icon"
        alt="Delete"
        src="/img/delete.svg"
      >
    </Button>
    <Button
      id="findContours"
      @click="selectTool($event)"
      title="Find Contours"
    >
      <img
        class="icon"
        alt="Find Contours"
        src="/img/findContours.svg"
      >
    </Button>
    <Button
      id="undo"
      @click="selectTool($event)"
      title="Undo"
    >
      <img
        class="icon"
        alt="Undo"
        src="/img/undo.svg"
      >
    </Button>
    <Button
      id="redo"
      @click="selectTool($event)"
      title="Redo"
    >
      <img
        class="icon"
        alt="Redo"
        src="/img/redo.svg"
      >
    </Button>
  </Row>
  <Row
    v-if="displayChat || displayScript"
    class="textRow"
  >
    <div class="text">
      <Chat
        v-if="displayChat"
        :received-messages="receivedMessages"
        :notification="notification"
        @send-message="sendChatMessage"
      />
      <ScriptConsole v-if="displayScript" />
    </div>
  </Row>

  <!-- Text Annotation -->
  <div id="text-annotation-panel">
    <div id="header">
      <img
        id="text-annotation-close"
        class="button"
        alt="close"
        src="/img/times-circle.svg"
        onclick="Microdraw.tools.textAnnotation.cancelTextAnnotation()"
        style="float:right;pointer-events:auto;"
      ><br>
      <b>Text Annotation</b>
    </div>

    <div id="add-text-annotation">
      <b>Text</b> <input
        type="text"
        placeholder="Enter annotation text"
      > <br>
      <b>Color</b> <input type="color"> <br>
      <b>Font size</b> <input
        type="number"
        value="18"
      > <br>
      <br>
      <div>
        <button onclick="Microdraw.tools.textAnnotation.addTextAnnotation(event)">
          Add
        </button>
        <button onclick="Microdraw.tools.textAnnotation.updateTextAnnotation(event)">
          Update
        </button>
        <button onclick="Microdraw.tools.textAnnotation.cancelTextAnnotation(event)">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
<script setup>
/* global Microdraw */
import {
  Button,
  ButtonsGroup,
  Chat,
  RangeSlider,
  Row,
  ScriptConsole
} from 'nwl-components';

import useVisualization from '../store/visualization';

const {
  title,
  notification,
  receivedMessages,
  currentTool,
  currentSlice,
  currentLabel,
  ontology,
  totalSlices,
  fullscreen,
  displayChat,
  displayScript,
  displayOntology,
  displayLayers
} = useVisualization();

const sliceChange = (slice) => {
  title.value = `Slice ${slice}`;
  currentSlice.value = slice;
  Microdraw.sliderOnChange(slice);
};

const toggleFullscreen = () => {
  fullscreen.value = !fullscreen.value;
  setTimeout(() => {
    Microdraw.resizeAnnotationOverlay();
  }, 100);
};

const toggleChat = () => {
  displayChat.value = !displayChat.value;
  if (displayChat.value) {
    displayScript.value = false;
  }
};

const toggleScript = () => {
  displayScript.value = !displayScript.value;
  if (displayScript.value) {
    displayChat.value = false;
  }
};

const toggleOntology = () => {
  displayOntology.value = !displayOntology.value;
};

const toggleLayers = () => {
  displayLayers.value = !displayLayers.value;
};

const selectTool = (event) => {
  let tool = event.currentTarget.id;
  if (tool === 'doDelete') { tool = 'delete'; }
  currentTool.value = tool;
  Microdraw.toolSelection(tool);
};

const sendChatMessage = (message) => {
  Microdraw.sendChatMessage(message);
};

</script>
<style scoped>
.group.clickTools {
  flex-wrap: wrap;
  flex-grow: 0 !important;
}
.group.clickTools button {
  border: none;
  padding: 1px 9px !important;
}
button, .group {
    border: thin solid #777;
  }

button.pressed {
  background: #777;
}
button img.icon {
  width: 14px;
  height: 14px;
}
.color {
  height: 100%;
  width: 100%;
  min-width: 20px;
}
.text {
  width: 100%;
  height: 100%;
}
.textRow {
  flex: 1;
  min-height: 40px;
}

/*------------------*/
/*  Text Annotation */
#text-annotation-panel {
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    width: 300px;
    height: 200px;
    max-height: 300px;
    transform: translate( -50%, -50%);
    background-color: rgba(0, 0, 0, 0.8);
    padding: 10px;
    z-index: 100;
    font-size: 0.8rem;
}
#text-annotation-panel > #header {
    height: 36px;
    background-color: #666;
    padding: 0 5px 0 10px;
    margin: -10px -10px 5px -10px;
    pointer-events: none;
}
#add-text-annotation > b {
    display: inline-block;
    width: 60px;
    margin-left: 10px;
}
#add-text-annotation > input[type="text"] {
    width: calc(100% - 80px);
}
#add-text-annotation > input[type="color"], input[type="number"] {
    width: 60px;
}
#add-text-annotation > div {
    display: block;
    position: absolute;
    right: 10px;
    bottom: 10px;
}
input, button {
  color: black;
}
</style>
<style>
.range-slider button {
  border: thin solid #777;
}
</style>
<style>
  #logScript {
    height: calc(100% - 22px);
  }
</style>


