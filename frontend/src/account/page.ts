import { deleteAccount, deleteMyReading, fetchMe, fetchMyReadings, type MyReading, saveName, signOut } from "../api";
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
    <button type="button" class="link" data-delete="${esc(r.id)}" aria-label="Supprimer le relevé du ${formatDate(r.takenAt)}">Supprimer</button>
  </li>`;
}

/** Our own Confirmer / Annuler box, over the account dialog: confirm() is blocked in some browsers (in-app ones answer "no" at once). */
function askConfirm(question: string, okLabel: string): Promise<boolean> {
  const box = document.createElement("dialog");
  box.className = "confirm";
  box.innerHTML = `
    <form method="dialog">
      <p>${esc(question)}</p>
      <div class="buttons">
        <button class="btn" value="no" autofocus>Annuler</button>
        <button class="btn danger" value="yes">${esc(okLabel)}</button>
      </div>
    </form>`;
  document.body.append(box);
  box.showModal();
  return new Promise((resolve) =>
    box.addEventListener("close", () => {
      resolve(box.returnValue === "yes");
      box.remove();
    }),
  );
}

function onConfirmedClick(button: HTMLElement, question: string, okLabel: string, action: () => Promise<void>): void {
  button.addEventListener("click", async () => {
    if (await askConfirm(question, okLabel)) await action();
  });
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
  dialog.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) =>
    onConfirmedClick(button, "Supprimer ce relevé et sa photo ? C'est définitif.", "Supprimer", async () => {
      const id = button.dataset.delete!;
      try {
        await deleteMyReading(id);
        update({ readings: state.readings.filter((r) => r.id !== id) });
        await open(`<div class="msg ok">Relevé supprimé.</div>`);
      } catch (error) {
        fail(error);
      }
    }),
  );
  const photos = mine.length === 1 ? "votre photo" : `vos ${mine.length} photos`;
  onConfirmedClick($("#a-delete"), `Supprimer votre compte et ${photos} ? C'est définitif.`, "Supprimer mon compte", async () => {
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
