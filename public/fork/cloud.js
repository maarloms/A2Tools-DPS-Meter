// Fork: group sharing with the fork's Cloudflare worker (app/cloud,
// protocol in app/cloud/PROTOCOL.md).
//  - Settings window: a "Gruppe teilen" section (server, room, secret).
//  - Main window: streams the live meter to the room over a WebSocket.
// Finished fights are uploaded by the backend (src-tauri/src/fork/cloud.rs).
(() => {
  const KEYS = {
    enabled: "fork.cloud.enabled",
    url: "fork.cloud.url",
    room: "fork.cloud.room",
    secret: "fork.cloud.secret",
    clientId: "fork.cloud.clientId",
  };
  const tauri = window.__TAURI__;
  const bridge = () => window.javaBridge;
  const get = (k) => String(bridge()?.getSetting?.(k) ?? "").trim();
  const set = (k, v) => bridge()?.setSetting?.(k, String(v));
  const german = () => (document.documentElement.lang || "de").toLowerCase().startsWith("de");
  const t = (de, en) => (german() ? de : en);

  const config = () => ({
    enabled: get(KEYS.enabled) === "true",
    url: get(KEYS.url).replace(/\/+$/, ""),
    room: get(KEYS.room).toLowerCase(),
    secret: get(KEYS.secret),
  });
  const complete = (c) => c.url && /^[a-z0-9-]{3,32}$/.test(c.room) && c.secret.length >= 16;

  // "https://host/#/join/<room>/<secret>", the dashboard's invite link.
  const parseInvite = (text) => {
    const m = String(text).trim().match(/^(https?:\/\/[^/#?]+)[^#]*#\/join\/([a-z0-9-]{3,32})\/([^/?#\s]+)/i);
    return m ? { url: m[1], room: m[2].toLowerCase(), secret: decodeURIComponent(m[3]) } : null;
  };

  // ------------------------------------------------------------------ live

  let ws = null, seq = 0, lastSentAt = 0, lastKey = "", retryMs = 1000;
  let reconnectTimer = 0, pingTimer = 0, status = { state: "off", text: "" };

  const setStatus = (state, text) => {
    status = { state, text };
    tauri?.event?.emit?.("fork-cloud-status", status).catch?.(() => {});
  };

  const clientId = () => {
    let id = get(KEYS.clientId);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = crypto.randomUUID();
      set(KEYS.clientId, id);
    }
    return id;
  };

  const characterName = () => String(window._dpsApp?.USER_NAME || "").trim();

  function disconnect() {
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    if (ws) {
      ws.onclose = null;
      try { ws.close(1000); } catch {}
      ws = null;
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  }

  function connect() {
    disconnect();
    const c = config();
    if (!c.enabled) { setStatus("off", t("Aus", "Off")); return; }
    if (!complete(c)) { setStatus("error", t("Server, Raum oder Passwort fehlt", "Server, room or secret missing")); return; }
    const name = characterName();
    if (!name) {
      setStatus("wait", t("Warte auf Charakternamen …", "Waiting for character name …"));
      reconnectTimer = setTimeout(connect, 5000);
      return;
    }
    setStatus("wait", t("Verbinde …", "Connecting …"));
    const url = c.url.replace(/^http/i, "ws") + "/api/rooms/" + encodeURIComponent(c.room) + "/ws";
    let socket;
    try { socket = new WebSocket(url); } catch { setStatus("error", t("Ungültige Server-Adresse", "Invalid server address")); return; }
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: "hello", v: 1, secret: c.secret, role: "app", clientId: clientId(), name: name.slice(0, 24), wantGroup: false }));
    };
    socket.onmessage = (ev) => {
      if (ev.data === "pong") return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === "welcome") {
        retryMs = 1000; lastKey = "";
        setStatus("ok", t("Verbunden mit Raum ", "Connected to room ") + msg.room);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { if (socket.readyState === 1) socket.send("ping"); }, 25000);
        // Kills from while we were offline; the room keeps the newest per boss.
        tauri.core.invoke("get_field_bosses").then(sendBosses).catch(() => {});
      } else if (msg.t === "bosses") {
        tauri.core.invoke("merge_field_bosses", { timers: msg.timers || [] }).catch((e) => console.error("Field bosses:", e));
      } else if (msg.t === "error" && ["hello_timeout", "replaced"].includes(msg.code)) {
        socket.close();
      }
    };
    socket.onclose = (ev) => {
      clearInterval(pingTimer);
      if (ws === socket) ws = null;
      if (ev.code === 4001 && ev.reason === "unauthorized") {
        setStatus("error", t("Raum oder Passwort falsch", "Wrong room or secret"));
      } else if (ev.code === 4004) {
        setStatus("error", t("Von anderer Verbindung abgelöst", "Replaced by another connection"));
      } else if (ev.code === 4002) {
        setStatus("error", t("App-Update nötig", "Update the app"));
      } else {
        setStatus("wait", t("Getrennt, neuer Versuch …", "Disconnected, retrying …"));
        scheduleReconnect();
      }
    };
  }

  function sendSnap(d) {
    if (!ws || ws.readyState !== 1 || !d?.map || !Object.keys(d.map).length) return;
    const now = Date.now();
    if (now - lastSentAt < 1000) return;
    const key = d.targetId + ":" + d.battleTime + ":" + d.targetTotalDamage;
    if (key === lastKey) return;
    lastSentAt = now; lastKey = key;
    const players = Object.entries(d.map)
      .map(([id, p]) => ({
        id: Number(id), name: p.nickname, job: p.job, dps: p.dps, dmg: p.amount,
        share: p.damageContribution, cp: p.combatPower, self: Number(id) === Number(d.localPlayerId),
      }))
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, 24);
    ws.send(JSON.stringify({
      t: "snap", seq: ++seq, battleTime: d.battleTime, dungeonId: d.dungeonId,
      target: { id: d.targetId, name: d.targetName, mode: d.targetMode, maxHp: d.targetMaxHp, hp: d.targetCurrentHp, dealt: d.targetTotalDamage },
      players,
    }));
  }

  // Field boss kills and respawns (src-tauri/src/fork/bosses.rs).
  function sendBosses(timers) {
    if (!ws || ws.readyState !== 1 || !timers?.length) return;
    const by = characterName().slice(0, 24);
    ws.send(JSON.stringify({ t: "bosses", timers: timers.slice(0, 32).map((x) => ({ ...x, by: x.by || by })) }));
  }

  function startLive() {
    tauri.event.listen("fork-boss-update", ({ payload }) => {
      if (payload?.origin !== "cloud") sendBosses(payload?.timers);
    });
    tauri.event.listen("dps-update", ({ payload }) => sendSnap(payload));
    tauri.event.listen("combat-reset", () => {
      lastKey = "";
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "clear" }));
    });
    tauri.event.listen("setting-changed", ({ payload }) => {
      if (String(payload?.key || "").startsWith("fork.cloud.") && payload.key !== KEYS.clientId) {
        // The settings cache updates in the same event; let it land first.
        setTimeout(() => { retryMs = 1000; connect(); }, 50);
      }
    });
    // Settings windows ask for the current state when they open.
    tauri.event.listen("fork-cloud-status-request", () => setStatus(status.state, status.text));
    // Give the meter a moment to learn the character name.
    setTimeout(connect, 3000);
  }

  // -------------------------------------------------------------- settings

  function renderSettings(app) {
    if (document.querySelector(".forkCloudGroup")) return;
    const anchor = document.querySelector(".settingsBody > .settingsGroup");
    if (!anchor) return;
    const section = document.createElement("section");
    section.className = "settingsGroup forkCloudGroup";
    section.innerHTML = `
      <div class="settingsMiniTitle">${t("Gruppe teilen", "Group sharing")}</div>
      <div class="settingsGroupBody settingsGroupStrip">
        <div class="settingsRow">
          <label class="settingsCheckboxLabel"><input type="checkbox" class="forkCloudEnabled" />
            <span>${t("Live-DPS und Kämpfe mit dem Raum teilen", "Share live DPS and fights with the room")}</span></label>
        </div>
        <div class="settingsRow settingsRowInput settingsRowStacked">
          <label class="settingsLabel" for="forkCloudInvite">${t("Einladungslink (füllt alles aus)", "Invite link (fills in everything)")}</label>
          <input id="forkCloudInvite" class="forkCloudInput" autocomplete="off" spellcheck="false" placeholder="https://…/#/join/raum/…" />
        </div>
        <div class="settingsRow settingsRowInput settingsRowStacked">
          <label class="settingsLabel" for="forkCloudUrl">Server</label>
          <input id="forkCloudUrl" class="forkCloudInput" data-key="${KEYS.url}" autocomplete="off" spellcheck="false" placeholder="https://a2dps-cloud.<name>.workers.dev" />
        </div>
        <div class="settingsRow settingsRowInput settingsRowStacked forkCloudPair">
          <div><label class="settingsLabel" for="forkCloudRoom">${t("Raum-Code", "Room code")}</label>
            <input id="forkCloudRoom" class="forkCloudInput" data-key="${KEYS.room}" autocomplete="off" spellcheck="false" placeholder="marlon-crew" /></div>
          <div><label class="settingsLabel" for="forkCloudSecret">${t("Passwort", "Secret")}</label>
            <input id="forkCloudSecret" class="forkCloudInput" data-key="${KEYS.secret}" type="password" autocomplete="off" spellcheck="false" /></div>
        </div>
        <div class="settingsRow settingsRowStacked">
          <div class="settingsRowEnd">
            <div class="settingsValue forkCloudStatus" data-state="off">–</div>
            <button class="settingsAction forkCloudOpen" type="button">${t("Dashboard öffnen", "Open dashboard")}</button>
          </div>
        </div>
      </div>`;
    anchor.after(section);

    const $ = (sel) => section.querySelector(sel);
    const fields = [...section.querySelectorAll("input[data-key]")];
    const fill = () => {
      $(".forkCloudEnabled").checked = get(KEYS.enabled) === "true";
      for (const input of fields) input.value = get(input.dataset.key);
    };
    fill();

    $(".forkCloudEnabled").addEventListener("change", (e) => set(KEYS.enabled, e.target.checked ? "true" : "false"));
    for (const input of fields) {
      input.addEventListener("change", () => {
        const value = input.value.trim();
        input.value = input.dataset.key === KEYS.room ? value.toLowerCase() : value;
        set(input.dataset.key, input.value);
      });
    }
    $("#forkCloudInvite").addEventListener("input", (e) => {
      const invite = parseInvite(e.target.value);
      if (!invite) return;
      set(KEYS.url, invite.url); set(KEYS.room, invite.room); set(KEYS.secret, invite.secret);
      set(KEYS.enabled, "true");
      e.target.value = "";
      fill();
    });
    $(".forkCloudOpen").addEventListener("click", () => {
      const c = config();
      if (!c.url) return;
      const link = complete(c) ? `${c.url}/#/join/${c.room}/${encodeURIComponent(c.secret)}` : c.url;
      bridge()?.openBrowser?.(link);
    });

    const statusEl = $(".forkCloudStatus");
    tauri?.event?.listen?.("fork-cloud-status", ({ payload }) => {
      statusEl.textContent = payload?.text || "–";
      statusEl.dataset.state = payload?.state || "off";
    });
    tauri?.event?.listen?.("fork-cloud-uploaded", () => {
      statusEl.textContent = t("Kampf hochgeladen", "Fight uploaded");
      statusEl.dataset.state = "ok";
    });
    tauri?.event?.emit?.("fork-cloud-status-request");
  }

  window.ForkCloud = { renderSettings };
  if (tauri?.event && window.A2_VIEW === "main") startLive();
})();
