import { type MonthIndex, monthLabel } from "../../domain/months";
import { $ } from "../../html";
import { dataSpan, state, subscribe, update } from "../../state";

/** Two sliders restricting the map to a span of months (cahier des charges, 2.2 zone 3). */
export function mountTimeBar(): void {
  const root = $("#timebar");
  root.innerHTML = `
    <label>Du <input type="range" id="range-from"></label>
    <span id="range-label"></span>
    <label>au <input type="range" id="range-to"></label>`;
  const from = $<HTMLInputElement>("#range-from");
  const to = $<HTMLInputElement>("#range-to");
  const label = $("#range-label");

  const sync = () => {
    const [lo, hi] = dataSpan();
    for (const input of [from, to]) {
      input.min = String(lo);
      input.max = String(hi);
    }
    from.value = String(state.range[0]);
    to.value = String(state.range[1]);
    label.textContent = `${monthLabel(state.range[0])} – ${monthLabel(state.range[1])}`;
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
