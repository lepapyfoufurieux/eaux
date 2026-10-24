const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text coming from contributors before putting it in HTML. */
export const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c]);

export const formatDate = (date: Date): string =>
  date.toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
};

/** localStorage can throw (private mode, blocked storage): treat it as optional. */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* not available */
    }
  },
};
