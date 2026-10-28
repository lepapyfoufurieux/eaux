import { esc } from "./html";

/** Our own Confirmer / Annuler box: confirm() is blocked in some browsers (in-app ones answer "no" at once). */
export function askConfirm(question: string, okLabel: string): Promise<boolean> {
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
