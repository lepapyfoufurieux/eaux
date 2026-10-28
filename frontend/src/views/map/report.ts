import { openSignIn } from "../../account/signIn";
import { fetchMe, reportReading } from "../../api";
import { askConfirm } from "../../confirm";
import { $ } from "../../html";

/** "Signaler cette photo" in the map popups: signed-in visitors only, after a confirmation; admins decide in the Django admin. */
export function mountReporting(): void {
  // Capture phase: the popup content is rebuilt on each photo of a group, so the listener sits on the document.
  document.addEventListener(
    "click",
    (click) => {
      const button = (click.target as HTMLElement).closest<HTMLButtonElement>("[data-report]");
      if (button) void report(button);
    },
    true,
  );
}

async function report(button: HTMLButtonElement): Promise<void> {
  const me = await fetchMe().catch(() => null);
  if (!me) {
    const dialog = $<HTMLDialogElement>("#sheet");
    return openSignIn(dialog, "Signaler une photo", "Pour signaler une photo, connectez-vous", "", () => {
      dialog.close();
      void report(button);
    });
  }
  if (!(await askConfirm("Signaler cette photo à l'association ? Elle la regardera et la masquera si besoin.", "Signaler"))) return;
  try {
    await reportReading(button.dataset.report!);
    button.textContent = "Photo signalée, merci.";
    button.disabled = true;
  } catch (error) {
    button.textContent = `Échec du signalement : ${(error as Error).message}`;
  }
}
