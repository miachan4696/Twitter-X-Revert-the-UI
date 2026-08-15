(() => {
  "use strict";

  // 対象フラグ
  const FLAGS = [
    "responsive_web_profile_redesign_enabled",
    "responsive_web_history_screen_enabled"
  ];
  const SCREEN_NAME = /^[A-Za-z0-9_]{1,15}$/;
  let initialState = globalThis.__INITIAL_STATE__;

  const diagnostics = {
    version: "1.0.2",
    initialStateCaptured: false,
    flagsForced: 0,
    redirectedLikes: false
  };

  Object.defineProperty(globalThis, "__xOldMedia", {
    value: diagnostics,
    configurable: true,
    enumerable: false,
    writable: false
  });

  
  function forceOldProfile(state) {
    for (const flagName of FLAGS) {
      const defaultFlag = state?.featureSwitch?.defaultConfig?.[flagName];
      const userFlag = state?.featureSwitch?.user?.config?.[flagName];

      for (const flag of [defaultFlag, userFlag]) {
        if (flag && typeof flag === "object") {
          flag.value = false;
          diagnostics.flagsForced += 1;
        }
      }
    }

    // "/i/history/likes"の場合"/ユーザー名/likes"にリダイレクトする
    if (location.pathname === "/i/history/likes") {
      const userId = state?.session?.user_id;
      const screenName = state?.entities?.users?.entities?.[userId]?.screen_name;
      if (typeof screenName === "string" && SCREEN_NAME.test(screenName)) {
        diagnostics.redirectedLikes = true;
        setTimeout(() => location.replace(`/${screenName}/likes`), 0);
      }
    }

    return state;
  }

  Object.defineProperty(globalThis, "__INITIAL_STATE__", {
    configurable: true,
    enumerable: false,
    get() {
      return initialState;
    },
    set(value) {
      diagnostics.initialStateCaptured = true;
      initialState = forceOldProfile(value);
    }
  });

  if (initialState && typeof initialState === "object") {
    initialState = forceOldProfile(initialState);
    diagnostics.initialStateCaptured = true;
  }
})();
