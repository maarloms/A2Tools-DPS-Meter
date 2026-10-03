// Login: Raum + Passwort → Session-Cookie (HttpOnly). Einladungslink #/join/<raum>/<passwort>
// meldet direkt an; das Fragment geht nie an den Server-Log.
(function () {
  var form = document.getElementById("f");
  var err = document.getElementById("err");
  function login(room, secret, remember) {
    err.textContent = "";
    return fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: room.trim().toLowerCase(), secret: secret, remember: remember }),
    })
      .then(function (r) {
        if (r.ok) {
          location.replace("/#/start");
          location.reload();
        } else err.textContent = r.status === 401 ? "Raum oder Passwort stimmt nicht." : "Anmeldung fehlgeschlagen.";
      })
      .catch(function () {
        err.textContent = "Server nicht erreichbar.";
      });
  }
  function fromHash() {
    var m = /^#\/join\/([a-z0-9][a-z0-9-]{2,31})\/(.{16,256})$/i.exec(location.hash);
    if (!m) return;
    history.replaceState(null, "", "/");
    login(m[1], decodeURIComponent(m[2]), true);
  }
  fromHash();
  // Link in die Adresszeile eingefügt, während die Seite schon offen ist
  window.addEventListener("hashchange", fromHash);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    login(form.room.value, form.secret.value, form.remember.checked);
  });
})();
