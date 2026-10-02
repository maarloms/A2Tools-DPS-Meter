(() => {
  function setup() {
    if (window.A2_VIEW !== "main") return;
    const header = document.querySelector(".headerBtns");
    if (!header) return;
    const button = document.createElement("div");
    button.className = "headerBtn timerBtn";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", "Event-Timer öffnen");
    button.title = "Event-Timer (Strg+Alt+T)";
    button.innerHTML = '<i data-lucide="clock-3"></i>';
    header.prepend(button);
    const toggle = () => window.__TAURI__.core.invoke("toggle_timer")
      .catch(e => { console.error("Timer:", e); button.title = "Timer konnte nicht geöffnet werden: " + e; });
    button.addEventListener("click", toggle);
    button.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    window.lucide?.createIcons?.();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();