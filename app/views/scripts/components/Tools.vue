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
  <Row v-if="displayChat || displayScript">
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
</template>
<script setup>
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
  displayOntology
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


