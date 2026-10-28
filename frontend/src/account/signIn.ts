import { requestSignInLink, signInWithCode } from "../api";
import { $, esc } from "../html";

/**
 * No password: the contributor receives a code and a link by e-mail; the first sign-in creates the account.
 * The code is typed here, because on a phone the mail app opens the link in another browser than this one.
 */
export function openSignIn(dialog: HTMLDialogElement, title: string, why: string, notice: string, signedIn: () => void): void {
  dialog.innerHTML = `
    <form method="dialog" class="publish">
      <h2>${title}</h2>
      <p>${why} : nous vous envoyons un code par e-mail, sans mot de passe. La première connexion crée votre compte.</p>
      <label>Votre adresse e-mail<input type="email" id="f-email" autocomplete="email" required></label>
      <label id="f-code-box" hidden>Code reçu par e-mail<input type="text" id="f-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" disabled required></label>
      <div id="f-message" role="status">${notice}</div>
      <div class="buttons">
        <button type="button" class="btn" id="f-cancel">Annuler</button>
        <button type="submit" class="btn primary" id="f-submit">Recevoir le code</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  const message = $("#f-message");
  const submit = $<HTMLButtonElement>("#f-submit");
  const emailInput = $<HTMLInputElement>("#f-email");
  const codeInput = $<HTMLInputElement>("#f-code");
  const fail = (title: string, error: unknown) => {
    message.innerHTML = `<div class="msg error"><strong>${title}</strong> ${esc((error as Error).message)}</div>`;
  };
  $("#f-cancel").addEventListener("click", () => dialog.close());
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    submit.disabled = true;
    if (codeInput.disabled) {
      try {
        await requestSignInLink(email);
        message.innerHTML = `<div class="msg ok">Un e-mail a été envoyé à <strong>${esc(email)}</strong>. Tapez le code qu'il contient, ou ouvrez son lien sur cet appareil. Valables 30 minutes.</div>`;
        emailInput.readOnly = true;
        $("#f-code-box").hidden = codeInput.disabled = false;
        submit.textContent = "Se connecter";
        codeInput.focus();
      } catch (error) {
        fail("L'envoi a échoué.", error);
      }
    } else {
      try {
        await signInWithCode(email, codeInput.value.trim());
        return signedIn();
      } catch (error) {
        fail("La connexion a échoué.", error);
      }
    }
    submit.disabled = false;
  });
}
