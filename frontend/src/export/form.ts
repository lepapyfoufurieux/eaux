import { exportUrl } from "../api";
import { $ } from "../html";

/** The "Extraire des données" dialog (cahier des charges, 2.5): a CSV of all published readings. */
export function mountExportForm(): void {
  $("#btn-export").addEventListener("click", () => {
    const dialog = $<HTMLDialogElement>("#sheet");
    dialog.innerHTML = `
      <form method="dialog" class="export">
        <h2>Extraire des données</h2>
        <p>Toutes les données publiées, au format CSV : date, débit, commentaire, latitude, longitude, station, auteur.</p>
        <label>Depuis le <input type="date" id="x-from"></label>
        <label>Jusqu'au <input type="date" id="x-to"></label>
        <div class="buttons">
          <button type="submit" class="btn">Fermer</button>
          <a class="btn primary" id="x-download" href="${exportUrl()}" download>Télécharger le CSV</a>
        </div>
      </form>`;
    const refresh = () => {
      $<HTMLAnchorElement>("#x-download").href = exportUrl($<HTMLInputElement>("#x-from").value, $<HTMLInputElement>("#x-to").value);
    };
    $("#x-from").addEventListener("change", refresh);
    $("#x-to").addEventListener("change", refresh);
    dialog.showModal();
  });
}
