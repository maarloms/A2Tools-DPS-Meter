// Fork: release notes as a popup in the meter window.
//  - offer(): an update is out (checkRelease.js). Shows the notes of every
//    release since the installed one, "Jetzt installieren" with a progress
//    bar (fork/update.rs) and "Später".
//  - "Was ist neu": once after an update, the notes of what was installed.
// The release list comes from the GitHub API through the backend's fetch_url
// (no CSP entry needed); without it, latest.json's notes stand in.
// Console, for trying it out: ForkPatchnotes.demo() / ForkPatchnotes.demoWhatsNew().
(() => {
  if (window.ForkPatchnotes) return;
  const tauri = window.__TAURI__;
  const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
  const bridge = () => window.javaBridge;
  const SEEN = "fork.patchnotes.seen";
  const german = () => (document.documentElement.lang || "de").toLowerCase().startsWith("de");
  const t = (de, en) => (german() ? de : en);
  const v = (s) => {
    const x = String(s ?? "").trim();
    return x && !/^v/i.test(x) ? "v" + x : x;
  };

  let lib = null;
  const releases = () => (lib ||= import(/* @vite-ignore */ "/fork/releases.js"));

  // The newest releases, read once per start.
  let listPromise = null;
  const releaseList = () =>
    (listPromise ||= releases().then(async (r) => {
      try {
        return r.parseReleaseList(await invoke("fetch_url", { url: r.RELEASES_API }));
      } catch (e) {
        console.warn("[Patchnotes] release list:", e);
        return null;
      }
    }).then((list) => {
      if (!list) listPromise = null; // try again next time
      return list;
    }));

  // ---------------------------------------------------------------- modal

  let modal = null; // { root, kind, close }
  let unlockedForModal = false;

  // A locked overlay lets every click through: unlock it while the popup is
  // up (backend only; the lock button and the saved setting stay as they are).
  const lockedOverlay = () => document.body.classList.contains("overlayLocked");
  function holdClicks() {
    if (!lockedOverlay()) return;
    unlockedForModal = true;
    invoke("set_overlay_locked", { locked: false }).catch(() => {});
  }
  function releaseClicks() {
    if (unlockedForModal && lockedOverlay()) invoke("set_overlay_locked", { locked: true }).catch(() => {});
    unlockedForModal = false;
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // The popup's frame. `kind` is "offer" or "whatsnew"; one at a time, an
  // offer replaces "Was ist neu".
  function open(kind, title, subtitle) {
    modal?.close();
    const root = el("div", "forkPatchnotes");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "forkPatchnotesTitle");
    const card = el("div", "forkPatchnotesCard");
    const head = el("div", "forkPatchnotesHead");
    const titles = el("div", "forkPatchnotesTitles");
    const h = el("div", "forkPatchnotesTitle", title);
    h.id = "forkPatchnotesTitle";
    titles.append(h);
    if (subtitle) titles.append(el("div", "forkPatchnotesSub", subtitle));
    const x = el("button", "forkPatchnotesClose", "×");
    x.type = "button";
    x.setAttribute("aria-label", t("Schließen", "Close"));
    head.append(titles, x);
    const body = el("div", "forkPatchnotesBody");
    body.append(el("p", "forkPatchnotesLoading", t("Lade Patchnotes …", "Loading patch notes …")));
    const progress = el("div", "forkPatchnotesProgress");
    progress.hidden = true;
    const bar = el("div", "forkPatchnotesBar");
    const fill = el("span");
    bar.append(fill);
    const status = el("div", "forkPatchnotesStatus");
    progress.append(bar, status);
    const actions = el("div", "forkPatchnotesActions");
    card.append(head, body, progress, actions);
    root.append(card);

    // Links in the notes open in the browser, not in the meter.
    body.addEventListener("click", (e) => {
      const a = e.target?.closest?.("a[href]");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") || "";
      if (/^https:\/\//i.test(href)) bridge()?.openBrowser?.(href);
    });

    let busy = false;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        close();
      }
    };
    function close() {
      if (modal?.root !== root) return;
      modal = null;
      root.remove();
      document.removeEventListener("keydown", onKey, true);
      releaseClicks();
      bridge()?.updateOverlaySize?.();
    }
    x.addEventListener("click", () => { if (!busy) close(); });

    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    holdClicks();
    // The meter window grows to fit it (tauriBridge.js updateWindowSize).
    bridge()?.updateOverlaySize?.();
    requestAnimationFrame(() => root.classList.add("isOpen"));

    modal = {
      root, kind, close, body, actions, progress, fill, status,
      setBusy(on) {
        busy = on;
        x.disabled = on;
        for (const b of actions.querySelectorAll("button")) b.disabled = on;
      },
      button(label, primary, onClick) {
        const b = el("button", "forkPatchnotesButton" + (primary ? " isPrimary" : ""), label);
        b.type = "button";
        b.addEventListener("click", onClick);
        actions.append(b);
        return b;
      },
    };
    return modal;
  }

  const isCurrent = (m) => modal === m;

  function fillNotes(m, r, list) {
    if (!isCurrent(m)) return;
    if (list.length) {
      m.body.innerHTML = r.releasesHtml(list); // escaped by markdown.js
    } else {
      m.body.replaceChildren(el("p", "forkPatchnotesEmpty", t("Keine Patchnotes gefunden.", "No patch notes found.")));
    }
  }

  // ---------------------------------------------------------------- offer

  /**
   * An update is available. `info`: { current, latest, notes, update }, where
   * `update` holds the manifest's msiUrl/…/msiSha256/… (checkRelease.js).
   * Returns true: the popup handles it, the native dialog is not needed.
   */
  function offer(info) {
    const current = v(info?.current);
    const latest = v(info?.latest);
    const update = info?.update || {};
    const demo = !!info?.demo;
    const m = open("offer", t("Update verfügbar", "Update available"), `${current} → ${latest}`);
    m.progress.hidden = true;

    const later = m.button(t("Später", "Later"), false, () => m.close());
    const installBtn = m.button(t("Jetzt installieren", "Install now"), true, () => install());
    installBtn.disabled = true;

    let canInstall = false;
    const page = releases().then((r) => r.releasePage(latest));
    (demo ? Promise.resolve(true) : invoke("fork_update_can_install", { update }))
      .catch(() => false)
      .then((ok) => {
        canInstall = !!ok;
        if (!isCurrent(m)) return;
        installBtn.disabled = false;
        if (!canInstall) installBtn.textContent = t("Download-Seite öffnen", "Open download page");
      });

    async function install() {
      if (!canInstall) {
        bridge()?.openBrowser?.(await page);
        m.close();
        return;
      }
      m.setBusy(true);
      m.progress.hidden = false;
      m.progress.classList.remove("isError");
      const show = (pct) => {
        const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
        m.fill.style.width = p + "%";
        m.status.textContent = p >= 100
          ? t("Prüfe Download und starte die Installation …", "Verifying and starting the installer …")
          : t(`Lade herunter … ${p} %`, `Downloading … ${p}%`);
      };
      show(0);
      if (demo) {
        for (let p = 0; p <= 100 && isCurrent(m); p += 5) {
          show(p);
          await new Promise((res) => setTimeout(res, 120));
        }
        m.status.textContent = t("Demo: hier würde jetzt der Installer starten.", "Demo: the installer would start now.");
        m.setBusy(false);
        installBtn.disabled = true;
        return;
      }
      let unlisten = null;
      try {
        unlisten = await tauri.event.listen("download-progress", ({ payload }) => show(payload));
        await invoke("fork_install_update", { update });
        m.status.textContent = t("Installation startet – das Meter wird beendet …", "Installer starting – the meter will close …");
      } catch (e) {
        m.progress.classList.add("isError");
        m.status.textContent = t("Update fehlgeschlagen: ", "Update failed: ") + String(e) +
          t(" – über „Download-Seite“ manuell installieren.", " – install manually from the download page.");
        m.setBusy(false);
        installBtn.textContent = t("Erneut versuchen", "Try again");
        if (!m.actions.querySelector(".isPage")) {
          const pageBtn = m.button(t("Download-Seite", "Download page"), false, async () => bridge()?.openBrowser?.(await page));
          pageBtn.classList.add("isPage");
          m.actions.insertBefore(pageBtn, later.nextSibling);
        }
      } finally {
        unlisten?.();
      }
    }

    Promise.all([releases(), releaseList()]).then(([r, list]) => {
      let shown = list ? r.selectReleases(list, { after: current, upTo: latest }) : [];
      if (!shown.length) shown = r.fallbackReleases(latest, info?.notes);
      fillNotes(m, r, shown);
    }).catch((e) => {
      console.warn("[Patchnotes]", e);
      if (isCurrent(m)) m.body.replaceChildren(el("p", "forkPatchnotesEmpty", t("Patchnotes nicht verfügbar.", "Patch notes unavailable.")));
    });
    return true;
  }

  // ------------------------------------------------------------ was ist neu

  /** The notes since the last version shown, once per version. */
  async function whatsNew({ installed, force = false } = {}) {
    const r = await releases();
    const seen = String(bridge()?.getSetting?.(SEEN) ?? "").trim();
    const range = force ? { after: null, upTo: installed } : r.whatsNewRange(installed, seen);
    if (!range) return false;
    // An update offer has the floor; ask again next start.
    if (modal && !force) return false;
    const list = await releaseList();
    if (!list) return false; // offline: next start
    if (modal && !force) return false; // an offer came in meanwhile
    const shown = r.selectReleases(list, range);
    // Seen, also when there is nothing to show (a version never released).
    if (!force) bridge()?.setSetting?.(SEEN, String(installed).replace(/^v/i, ""));
    if (!shown.length) return false;
    const m = open("whatsnew", t("Was ist neu", "What's new"), `${t("Installiert", "Installed")}: ${v(installed)}`);
    m.button("OK", true, () => m.close());
    fillNotes(m, r, shown);
    return true;
  }

  const installedVersion = async () => {
    for (let i = 0; i < 20; i++) {
      const ver = String(window.dpsData?.getVersion?.() || "").trim();
      if (ver) return ver;
      await new Promise((res) => setTimeout(res, 500));
    }
    return "";
  };

  async function startWhatsNew() {
    const build = await Promise.resolve(window.a2BuildReady).catch(() => null);
    if (build?.online === false) return;
    // After the update check (checkRelease.js waits 0.8 s, then fetches).
    await new Promise((res) => setTimeout(res, 6000));
    // Not over the one-time Discord popup.
    for (let i = 0; i < 60 && document.querySelector(".discordPromo.isOpen"); i++) {
      await new Promise((res) => setTimeout(res, 2000));
    }
    const installed = await installedVersion();
    if (installed) await whatsNew({ installed });
  }

  // ------------------------------------------------------------------ demo

  async function demo() {
    const installed = (await installedVersion()) || "3.0.19";
    const r = await releases();
    const list = (await releaseList()) || [];
    const older = list.map((x) => x.tag_name).filter((tag) => r.compareVersions(tag, installed) < 0)
      .sort(r.compareVersions);
    const from = older[Math.max(0, older.length - 3)] || "3.0.0";
    return offer({ current: from, latest: installed, notes: "**Demo**\n- latest.json-Notes (Fallback)", demo: true });
  }

  window.ForkPatchnotes = {
    offer,
    whatsNew,
    demo,
    demoWhatsNew: async () => whatsNew({ installed: (await installedVersion()) || "3.0.19", force: true }),
    isOpen: () => !!modal,
  };

  if (tauri?.core && window.A2_VIEW === "main") startWhatsNew().catch((e) => console.warn("[Patchnotes]", e));
})();
