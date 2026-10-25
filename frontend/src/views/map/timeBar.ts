import { type MonthIndex, monthIndex, monthLabel } from "../../domain/months";
import { $ } from "../../html";
import { dataSpan, state, subscribe, update } from "../../state";

/**
 * Two sliders restricting the map to a span of months (cahier des charges, 2.2 zone 3),
 * over a histogram of the readings taken each month.
 */
export function mountTimeBar(): void {
  const root = $("#timebar");
  root.innerHTML = `
    <div class="tb-head"><span>Période affichée</span><b id="range-label"></b></div>
    <div class="tb-bars" id="range-bars" aria-hidden="true"></div>
    <div class="tb-sliders">
      <input type="range" id="range-from" aria-label="Du mois">
      <input type="range" id="range-to" aria-label="Au mois">
    </div>
    <div class="tb-axis" id="range-axis"></div>`;
  const from = $<HTMLInputElement>("#range-from");
  const to = $<HTMLInputElement>("#range-to");
  const label = $("#range-label");
  const bars = $("#range-bars");
  const axis = $("#range-axis");

  const sync = () => {
    const [lo, hi] = dataSpan();
    for (const input of [from, to]) {
      input.min = String(lo);
      input.max = String(hi);
    }
    from.value = String(state.range[0]);
    to.value = String(state.range[1]);
    const [a, b] = state.range;
    label.textContent = a <= lo && b >= hi ? "Toute la période" : a === b ? monthLabel(a) : `${monthLabel(a)} – ${monthLabel(b)}`;

    const counts = new Map<MonthIndex, number>();
    for (const r of state.readings) counts.set(monthIndex(r.takenAt), (counts.get(monthIndex(r.takenAt)) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    bars.innerHTML = "";
    for (let m = lo; m <= hi; m++) {
      const n = counts.get(m) ?? 0;
      const bar = document.createElement("i");
      bar.style.height = `${(n / max) * 100}%`;
      bar.title = `${monthLabel(m)} : ${n} relevé${n > 1 ? "s" : ""}`;
      bar.classList.toggle("out", m < a || m > b);
      bars.append(bar);
    }
    const mid = Math.round((lo + hi) / 2);
    axis.innerHTML = [...new Set([lo, mid, hi])].map((m) => `<span>${monthLabel(m)}</span>`).join("");
  };

  const onInput = () => {
    let lo: MonthIndex = Number(from.value);
    let hi: MonthIndex = Number(to.value);
    if (lo > hi) [lo, hi] = [hi, lo];
    update({ range: [lo, hi] });
  };
  from.addEventListener("input", onInput);
  to.addEventListener("input", onInput);
  subscribe(sync);
  sync();
}
