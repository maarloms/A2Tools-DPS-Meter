(() => {
  const START_DELAY = 800;

  // fork: the version with a "v" in front, as the popup and Settings show it.
  const v = (s) => {
    const x = String(s ?? "").trim();
    return x && !/^v/i.test(x) ? "v" + x : x;
  };

  // One check, done by the meter. fork: the fork's own releases on GitHub
  // (fork/update.rs `fork_check_update`: latest.json against this install's
  // version; it keeps the manifest, so the popup's install takes no URL or
  // hash from the page). Upstream's `check_for_update` (taengu's CDN) is
  // never asked. "update" (one is out), "current" or "failed"; `latest`: the
  // newest version, when known. `ask` false: at start and every 6 hours;
  // "offer" when the patch-notes popup took it, for `offer` (the green
  // button in the meter's title).
  const check = async ({ ask = true } = {}) => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return { state: "failed" };
    let found;
    try {
      found = await invoke("fork_check_update");
    } catch (e) {
      console.error("[A2Tools] Update check failed:", e);
      return { state: "failed" };
    }
    const latest = found?.latest ? v(found.latest) : undefined;
    if (found?.state !== "update") return { state: found?.state === "current" ? "current" : "failed", latest };
    console.log("[A2Tools] Update available:", found.current, "->", latest);
    // fork: what the patch-notes popup (public/fork/patchnotes.js) shows.
    const info = { current: v(found.current), latest, notes: typeof found.notes === "string" ? found.notes : "" };
    if (!ask) {
      // fork: at start the patch-notes popup comes up right away, as up to
      // 3.0.27 (Marlon, 23.10.2026); the green button in the title stays
      // and opens it again.
      // fork: the 6-hour re-check pops the popup up only once per version
      // (Marlon, 25.10.2026); after that the same `latest` just keeps the
      // button, which opens it again.
      if (window.ForkPatchnotes?.offer && (forkShownFor === latest || window.ForkPatchnotes.offer(info))) {
        forkShownFor = latest;
        pendingFork = info;
        return { state: "offer", latest };
      }
      return { state: "update", latest };
    }
    // fork: Settings' check asks with the popup too. It installs itself, so
    // Settings hears "update" (one is out) while the popup is open.
    if (window.ForkPatchnotes?.offer?.(info)) forkShownFor = latest;
    return { state: "update", latest };
  };

  let once = false;
  let pendingFork = null; // fork: the update found by the background check, for the title's button
  let forkShownFor = null; // fork: the version the popup already came up for

  // An update shows the patch-notes popup and the green button in the
  // meter's title (`onAvailable`), which opens it again. Then again every
  // 6 hours, for a meter left running for days.
  const RECHECK_MS = 6 * 60 * 60 * 1000;
  const start = (onAvailable) => {
    const run = async () => {
      try {
        const found = await check({ ask: false });
        if (found.state === "offer") onAvailable?.(found.latest);
      } catch (e) {
        console.error("[A2Tools] Update check error:", e);
      }
    };
    setTimeout(() => {
      if (once) return;
      once = true;
      run();
      setInterval(run, RECHECK_MS);
    }, START_DELAY);
  };

  // The button: the patch-notes popup again. fork: it installs itself and
  // closes the meter then, so the button stays until that happens (false).
  const offer = async () => {
    if (pendingFork) window.ForkPatchnotes?.offer?.(pendingFork);
    return false;
  };

  // Settings' check: whenever asked, with what it found.
  const checkNow = () =>
    check().catch((e) => {
      console.error("[A2Tools] Update check error:", e);
      return { state: "failed" };
    });

  window.ReleaseChecker = { start, checkNow, offer };
})();
