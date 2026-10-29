/* global Microdraw, UnsavedStash */
const fadeOut = function (el) {
  el.style.opacity = 1;

  (function fade() {
    if ((el.style.opacity -= 0.1) < 0) {
      el.style.display = "none";
    } else {
      requestAnimationFrame(fade);
    }
  }());
};

const fadeIn = function (el) {
  el.style.opacity = 0;
  el.style.display = "block";

  (function fade() {
    var val = parseFloat(el.style.opacity);
    if (!((val += 0.1) > 1)) {
      el.style.opacity = val;
      requestAnimationFrame(fade);
    }
  }());
};

const _dialog = async ({el, message, doFadeOut=true, delay=2000, background="#333"}) => {
  if(typeof doFadeOut === "undefined") {
    doFadeOut = true;
  }

  el.textContent = message;
  el.style.background = background;
  fadeIn(el);
  await new Promise((resolve) => {
    setTimeout(() => {
      if(doFadeOut) {
        fadeOut(el);
      }
      resolve();
    }, delay);
  });
};

// eslint-disable-next-line max-statements
window.ToolSave = { save: (function() {

  // What was sent is now the server's version (H3a). The regions it removed
  // are removed: take them off the list, otherwise each later save would
  // remove them again, also after another user saved them anew (2026-10-29).
  // The hash is that of the regions sent with an empty list, so the slice is
  // unchanged unless it was edited while the save was out.
  const _saved = function (sl, value) {
    const section = Microdraw.ImageInfo[sl];
    const removed = new Set(value.RegionsToRemove);
    section.RegionsToRemove = section.RegionsToRemove.filter((uid) => !removed.has(uid));
    section.Hash = Microdraw.valueHash({ Regions: value.Regions, RegionsToRemove: [] });
    UnsavedStash.snapshot(Microdraw, sl);
  };

  // `value` is the {Regions, RegionsToRemove} sent in query.annotation.
  const _processOneSection = async function (query, value) {
    const sl = query.slice;

    const res = await fetch('/api', {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });

    if (!res.ok) {
      const err = new Error(await res.text());
      err.status = res.status;
      throw err;
    }

    _saved(sl, value);

    return sl;
  };

  const _savingFeedback = async function (savedSections) {
    const el = Microdraw.dom.querySelector('#saveDialog');
    let message = "";

    if(savedSections.length === 0) {
      message = "No changes to save";
      await _dialog({el, message});
    } else {
      message = "Saving sections: " + savedSections.join(" ");
      await _dialog({el, message, doFadeOut: false});
    }
  };

  const _successFeedback = function () {
    const el = Microdraw.dom.querySelector('#saveDialog');
    _dialog({el, message: "Successfully saved", delay: 1000, background: "#2a3"});
  };

  // A refused or failed save (H3a): 401 asks to log in, 403 says why.
  const _errorFeedback = function (refused) {
    const el = Microdraw.dom.querySelector('#saveDialog');
    const {status, kept} = refused;
    if (status === 401) {
      UnsavedStash.showLoginDialog(el, kept);
    } else {
      const reason = status === 403 ?
        "You don't have permission to edit annotations in this project." :
        "Unable to save, try again later.";
      const message = reason + (kept ?
        " Your annotations are kept in this browser." :
        "");
      _dialog({el, message, background: "#d34"});
    }
    console.log(refused.cause);
  };

  // H3a: without a project, or logged out, nothing is sent to the server. The
  // user's own changes are kept in localStorage, and a dialog explains why.
  const _keepAndExplain = function (changed, explain) {
    const kept = changed
      .map(({sl, value}) => UnsavedStash.keep(Microdraw, sl, value))
      .every(Boolean);
    explain(Microdraw.dom.querySelector('#saveDialog'), kept);
  };

  // Without a project, or logged out, keep the changes and say why: true.
  // Without a project the project dialog comes first: creating one needs a login anyway.
  const _cannotSend = function (changed) {
    if (changed.length === 0) {
      return false;
    }
    if (!Microdraw.project) {
      _keepAndExplain(changed, UnsavedStash.showNoProjectDialog);

      return true;
    }
    if (!UnsavedStash.loggedIn()) {
      _keepAndExplain(changed, UnsavedStash.showLoginDialog);

      return true;
    }

    return false;
  };

  // The sections whose annotations changed since they were loaded or saved:
  // {sl, value, h}, where value is what save sends and h its hash.
  const _changedSections = function () {
    const changed = [];

    Object.keys(Microdraw.ImageInfo).forEach((sl) => {
      if ((Microdraw.config.multiImageSave) || (sl === Microdraw.currentImage)) {
        // a section never loaded (no Hash) is not saved
        const changes = Microdraw.sectionChanges(Microdraw.ImageInfo[sl]);
        if (changes !== null) {
          const {value, h} = changes;
          value.Hash = h;
          changed.push({sl, value, h});
        }
      }
    });

    return changed;
  };

  /**
     * @function microdrawDBSave
     * @desc Save SVG overlay to microdrawDB
     * @returns {void}
     */
  var microdrawDBSave = async function () {
    if( Microdraw.debug ) {
      console.log("> save promise");
    }

    const changed = _changedSections();

    if (_cannotSend(changed)) {
      return;
    }

    // A section the server refuses (403, 401) or that fails is kept in
    // localStorage, so that it can be imported later (H3a).
    const promiseArray = changed.map(({sl, value, h}) => _processOneSection({
      action: 'save',
      source: Microdraw.source,
      slice: sl,
      project: Microdraw.project,
      Hash: h,
      annotation: JSON.stringify(value)
    }, value).catch((err) => {
      const refused = new Error('save refused');
      refused.cause = err;
      refused.status = err.status;
      refused.kept = UnsavedStash.keep(Microdraw, sl, value);
      throw refused;
    }));

    await _savingFeedback(changed.map(({sl}) => sl));

    if(promiseArray.length > 0) {
      Promise.all(promiseArray)
        .then(() => {
          _successFeedback();
        })
        .catch(_errorFeedback);
    }
  };

  var tool = {

    /**
         * @function click
         * @desc save the annotations
         * @param {string} prevTool The previous tool to which the selection goes back
         * @returns {void}
         */
    click : function click(prevTool) {
      Microdraw.selectRegion( null );
      microdrawDBSave();
      Microdraw.backToPreviousTool(prevTool);
    }
  };

  return tool;
}())};
