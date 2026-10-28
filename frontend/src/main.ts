import { mountAccountPage } from "./account/page";
import { fetchReadings, fetchStations, fetchWatercourses } from "./api";
import { mountExportForm } from "./export/form";
import { $, storage } from "./html";
import { mountPublishForm } from "./publish/form";
import { type AppState, dataSpan, state, subscribe, update } from "./state";
import "./styles/main.css";
import { mountMap } from "./views/map/map";
import { mountReporting } from "./views/map/report";
import { mountTimeBar } from "./views/map/timeBar";
import { mountRiverView } from "./views/river/plan";

const MODE_KEY = "eds-mode";

/** Show the view for the current mode. #carte and #fil in the URL link straight to a view. */
function showMode(s: AppState): void {
  $("#view-map").hidden = s.mode !== "map";
  $("#view-river").hidden = s.mode !== "river";
  $("#btn-hide-empty").hidden = s.mode !== "map";
  $("#btn-hide-empty").setAttribute("aria-pressed", String(s.hideEmpty));
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === s.mode));
  });
  const hash = s.mode === "river" ? "#fil" : "#carte";
  if (location.hash !== hash) history.replaceState(null, "", hash);
  storage.set(MODE_KEY, s.mode);
}

/** Keep the top bar on one line: the action buttons fold into a menu when they do not fit. */
function mountTopbarMenu(): () => void {
  const bar = $(".topbar");
  const toggle = $<HTMLButtonElement>(".menu-toggle");
  const actions = $("#actions");
  const setOpen = (open: boolean) => {
    actions.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  const fit = () => {
    setOpen(false);
    bar.classList.remove("compact");
    bar.classList.toggle("compact", bar.scrollWidth > bar.clientWidth);
  };
  toggle.addEventListener("click", () => setOpen(!actions.classList.contains("open")));
  // Choosing an action, clicking elsewhere or pressing Escape closes the menu.
  actions.addEventListener("click", () => setOpen(false));
  document.addEventListener("click", (event) => {
    if (!bar.contains(event.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => event.key === "Escape" && setOpen(false));
  new ResizeObserver(fit).observe(bar);
  return fit;
}

async function start(): Promise<void> {
  const initialMode = location.hash === "#fil" || (location.hash !== "#carte" && storage.get(MODE_KEY) === "river") ? "river" : "map";
  subscribe(showMode);
  // The map's hide button shows and hides with the mode, so the fit is measured again after each change.
  const fitTopbar = mountTopbarMenu();
  subscribe(fitTopbar);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => update({ mode: button.dataset.mode as AppState["mode"] }));
  });

  $("#btn-hide-empty").addEventListener("click", () => update({ hideEmpty: !state.hideEmpty }));

  const map = await mountMap();
  mountTimeBar();
  mountRiverView();
  mountPublishForm();
  mountExportForm();
  mountAccountPage();
  mountReporting();

  const [readings, stations, watercourses] = await Promise.all([fetchReadings(), fetchStations(), fetchWatercourses()]);
  state.readings = readings;
  const span = dataSpan();
  update({
    mode: initialMode,
    stations,
    watercourses,
    range: span,
    riverMonth: span[1],
    selectedStation: stations[0]?.code ?? null,
  });
  // Leaflet measures its container on load; it was hidden if we started on the river view.
  subscribe((s) => s.mode === "map" && map.invalidateSize());
}

start().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML("beforeend", `<div class="msg error fatal">Le site n'a pas pu charger les relevés. Réessayez dans un moment.</div>`);
});
