import type { FolderApi, Pane } from "tweakpane";

/**
 * One selectable mode of a scene whose modes are genuinely different *content*
 * (e.g. the Animated Effects scene). Used with {@link addModeControls}, which
 * guarantees the one rule of the examples: every visible control does
 * something — controls that don't apply to the current mode don't exist.
 */
export interface Mode {
  key: string;
  label: string;
  /** (Re)apply this mode to the scene. Called on select and on revisit. */
  activate(): void;
  /** Add only the controls this mode actually uses. May be empty. */
  controls?(folder: FolderApi): void;
}

/**
 * A dropdown plus a per-mode controls folder. Selecting a mode calls its
 * `activate()`, then empties the folder and re-creates it from the mode's
 * `controls` — so no binding ever outlives the mode it belongs to.
 */
export function addModeControls(pane: Pane, modes: Mode[], initial: string): void {
  const options = Object.fromEntries(modes.map((m) => [m.label, m.key]));
  const params = { mode: initial };

  const first = modes.find((m) => m.key === initial) ?? modes[0];
  const folder = pane.addFolder({ title: first.label });

  const select = (key: string): void => {
    const mode = modes.find((m) => m.key === key) ?? modes[0];
    mode.activate();
    folder.title = mode.label;
    // Dispose the folder's contents rather than the folder itself, so it keeps
    // its position in the pane (folders added later would otherwise end up
    // above a re-created one).
    for (const child of [...folder.children]) {
      folder.remove(child);
    }
    mode.controls?.(folder);
  };

  pane.addBinding(params, "mode", { options }).on("change", (e) => select(e.value as string));
  select(initial);
}

/** Copy a preset into the live params object and refresh every binding. */
export function applyPreset<T extends object>(params: T, preset: Partial<T>, pane: Pane): void {
  Object.assign(params, preset);
  pane.refresh();
}
