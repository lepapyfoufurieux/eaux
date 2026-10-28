import { deleteAccount, fetchMe, fetchMyReadings, type MyReading, saveName, signOut } from "../api";
import { FLOW } from "../domain/flow";
import { $, esc, formatDate } from "../html";
import { state, update } from "../state";
import { openSignIn } from "./signIn";

/** "Mon compte": the name shown under the photos, sign-out, account deletion and the contributor's readings. */
export function mountAccountPage(): void {
  $("#btn-account").addEventListener("click", () => open());
}

function item(r: MyReading): string {
  const station = state.stations.find((s) => s.code === r.station);
  return `<li>
    <a href="${esc(r.photo)}" target="_blank" rel="noopener"><img src="${esc(r.thumbnail)}" alt="Photo du ${formatDate(r.takenAt)}"></a>
    <div><strong style="--c:${FLOW[r.flowLevel].colour}">${FLOW[r.flowLevel].label}</strong> · ${formatDate(r.takenAt)}
      <small>${station ? `${esc(station.code)} · ${esc(station.name)}` : "Sans station"}${r.hidden ? " · masqué par l'association" : ""}</small></div>
  </li>`;
}

async function open(notice = ""): Promise<void> {
  const dialog = $<HTMLDialogElement>("#sheet");
  const me = await fetchMe().catch(() => null);
  if (!me) return openSignIn(dialog, "Mon compte", "Pour voir votre compte, connectez-vous", notice, () => open());
  const mine = await fetchMyReadings();
  dialog.innerHTML = `
    <form method="dialog" class="account">
      <h2>Mon compte</h2>
      <p>Connecté avec <strong>${esc(me.email)}</strong> · <button type="button" class="link" id="a-sign-out">Se déconnecter</button></p>
      <label>Nom affiché sous vos photos<input type="text" id="a-name" maxlength="60" value="${esc(me.name)}" required>
        <small class="hint">Le changer renomme aussi vos photos déjà publiées.</small></label>
      <div id="a-message" role="status">${notice}</div>
      <h3>Mes relevés (${mine.length})</h3>
      ${mine.length ? `<ul class="my-readings">${mine.map(item).join("")}</ul>` : "<p>Vous n'avez encore publié aucune photo.</p>"}
      <p><button type="button" class="link" id="a-delete">Supprimer mon compte et mes photos</button></p>
      <div class="buttons">
        <button type="button" class="btn" id="a-close">Fermer</button>
        <button type="submit" class="btn primary" id="a-save">Enregistrer le nom</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();

  const message = $("#a-message");
  const ids = new Set(mine.map((r) => r.id));
  const fail = (error: unknown) => {
    message.innerHTML = `<div class="msg error"><strong>Échec.</strong> ${esc((error as Error).message)}</div>`;
  };
  $("#a-close").addEventListener("click", () => dialog.close());
  $("#a-sign-out").addEventListener("click", async () => {
    await signOut().catch(() => undefined);
    dialog.close();
  });
  $("#a-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer votre compte et vos ${mine.length} photos ? C'est définitif.`)) return;
    try {
      await deleteAccount();
      update({ readings: state.readings.filter((r) => !ids.has(r.id)) });
      dialog.close();
    } catch (error) {
      fail(error);
    }
  });
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $<HTMLInputElement>("#a-name").value.trim();
    try {
      await saveName(name);
      // The server renamed the published readings; the views show the new name without a reload.
      update({ readings: state.readings.map((r) => (ids.has(r.id) ? { ...r, authorName: name } : r)) });
      message.innerHTML = `<div class="msg ok">Nom enregistré.</div>`;
    } catch (error) {
      fail(error);
    }
  });
}
