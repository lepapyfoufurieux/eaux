import { fetchReadings, fetchStations, fetchWatercourses } from "./api";
import { mountExportForm } from "./export/form";
import { $, storage } from "./html";
import { mountPublishForm } from "./publish/form";
import { type AppState, dataSpan, state, subscribe, update } from "./state";
import "./styles/main.css";
import { mountMap } from "./views/map/map";
import { mountTimeBar } from "./views/map/timeBar";
import { mountRiverView } from "./views/river/plan";

const MODE_KEY = "eds-mode";

/** Show the view for the current mode. #carte and #fil in the URL link straight to a view. */
function showMode(s: AppState): void {
  $("#view-map").hidden = s.mode !== "map";
  $("#view-river").hidden = s.mode !== "river";
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === s.mode));
  });
  const hash = s.mode === "river" ? "#fil" : "#carte";
  if (location.hash !== hash) history.replaceState(null, "", hash);
  storage.set(MODE_KEY, s.mode);
}

async function start(): Promise<void> {
  const initialMode = location.hash === "#fil" || (location.hash !== "#carte" && storage.get(MODE_KEY) === "river") ? "river" : "map";
  subscribe(showMode);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => update({ mode: button.dataset.mode as AppState["mode"] }));
  });

  const map = await mountMap();
  mountTimeBar();
  mountRiverView();
  mountPublishForm();
  mountExportForm();

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
