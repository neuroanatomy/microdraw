(function (global, factory) {
  if (typeof define === "function" && define.amd) {
    define("HippyHippo", ["exports"], factory);
  } else if (typeof exports !== "undefined") {
    factory(exports);
  } else {
    var mod = {
      exports: {}
    };
    factory(mod.exports);
    global.HippyHippo = mod.exports;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.HippyHippo = void 0;

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

  var _adjectives = ["affectionate", "agreeable", "amiable", "bright", "charming", "creative", "determined", "diligent", "diplomatic", "dynamic", "energetic", "friendly", "hardworking", "helpful", "imaginative", "kind", "likable", "loyal", "patient", "polite", "sincere"];

  var _nouns = ["Alpaca", "Badger", "Bee", "Camel", "Cat", "Caterpillar", "Chipmunk", "Crab", "Cricket", "Deer", "Donkey", "Dove", "Dragonfly", "Duck", "Eagle", "Elephant", "Emu", "Flamingo", "Fox", "Frog", "Goose", "Gopher", "Gorilla", "Hamster", "Hare", "Hippo", "Hummingbird", "Kangaroo", "Ladybug", "Leopard", "Lion", "Mongoose", "Mouse", "Octopus", "Otter", "Owl", "Panda", "Parrot", "Peacock", "Pelican", "Penguin", "Pig", "Pigeon", "Porcupine", "Rabbit", "Walrus", "Whale"].map(function (v) {
    return v.toLowerCase();
  });

  var HippyHippo = /*#__PURE__*/function () {
    function HippyHippo() {
      var adjectives = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : _adjectives;
      var nouns = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : _nouns;

      _classCallCheck(this, HippyHippo);

      this.adjectives = adjectives;
      this.nouns = nouns;
    }

    _createClass(HippyHippo, [{
      key: "setAdjectives",
      value: function setAdjectives(adjectives) {
        this.adjectives = adjectives;
      }
    }, {
      key: "setNouns",
      value: function setNouns(nouns) {
        this.nouns = nouns;
      }
    }, {
      key: "getNickName",
      value: function getNickName(n) {
        if (this.adjectives.length === 0) throw new Error("If using instanced HippyHippo, this.adjectives must be at least one.");
        if (this.nouns.length === 0) throw new Error("If using instanced HippyHippo, this.nouns must be at least one.");
        return HippyHippo.getNickName(n, this.adjectives, this.nouns);
      }
    }], [{
      key: "getNickName",
      value: function getNickName(_n, __adjectives, __nouns) {
        var n;

        if (typeof _n === 'undefined' || _n === null) {
          n = HippyHippo.getRandomId();
        } else {
          n = _n;
        }

        if (typeof n !== 'number') {
          throw new Error('argument to getNickName must be a number.');
        }

        if (Number.isNaN(n)) {
          throw new Error('argument to getNickName cannot be NaN');
        }

        var adjectives = __adjectives || _adjectives;
        var nouns = __nouns || _nouns; // cast any non NaN number to uint32 integer... I think...

        var index = new Uint32Array(new Float32Array([n]).buffer)[0];
        var adjective = adjectives[index % adjectives.length];
        var noun = nouns[index % nouns.length];
        return "".concat(adjective, " ").concat(noun);
      }
    }, {
      key: "getRandomId",
      value: function getRandomId() {
        var max = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 65535;
        return Math.floor(Math.random() * max);
      }
    }]);

    return HippyHippo;
  }();

  _exports.HippyHippo = HippyHippo;
});
