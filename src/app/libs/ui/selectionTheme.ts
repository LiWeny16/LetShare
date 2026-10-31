import { reaction } from "mobx";
import settingsStore from "../mobx/mobx";

/** Keep selection colors in sync even on routes without the share theme provider. */
export function installSelectionTheme(): () => void {
  return reaction(
    () => settingsStore.get("userTheme") || "light",
    (theme) => { document.documentElement.dataset.selectionTheme = theme; },
    { fireImmediately: true },
  );
}
