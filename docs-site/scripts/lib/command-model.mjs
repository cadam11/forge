/**
 * The app's command data, reshaped into the rows the two generated reference pages render.
 *
 * `app-source.mjs` hands back the renderer's own modules, twice — once with a macOS
 * `navigator.userAgent` and once with a Windows one. This file merges those two passes into one
 * row per command and asserts, on every row, that the only thing the platform changed is the
 * keystroke. If a label or a group ever differed by platform, the pages would be quietly telling
 * half the readers something false, so it is checked rather than assumed.
 */

/**
 * Electron resolves `CmdOrCtrl` to Command on macOS and Control everywhere else
 * (https://www.electronjs.org/docs/latest/api/accelerator). The app's own `formatAccelerator`
 * only rewrites single characters on the non-Mac branch, so it prints the literal spelling —
 * these pages print the key the reader actually presses, and say so.
 */
const WINDOWS_MODIFIER_NAMES = { CmdOrCtrl: 'Ctrl', CommandOrControl: 'Ctrl', Control: 'Ctrl' };

/** Modifiers that cannot appear in a Windows binding. Their presence means the mapping is wrong. */
const MAC_ONLY_MODIFIERS = new Set(['Cmd', 'Command', 'Super', 'Meta', 'Option']);

/** The catalogue's palette preconditions, in the words a reference table wants. */
const REQUIREMENT_LABELS = {
  connection: 'a live connection',
  'query-tab': 'a query tab in front',
  results: 'results on screen',
};

/** One accelerator as pressed on Windows, from the accelerator as the app prints it there. */
function windowsKeystroke(printed) {
  const parts = printed.split('+').map(part => WINDOWS_MODIFIER_NAMES[part] ?? part);
  const macOnly = parts.find(part => MAC_ONLY_MODIFIERS.has(part));
  if (macOnly !== undefined) {
    throw new Error(
      `The non-macOS binding \`${printed}\` carries the macOS-only modifier \`${macOnly}\`. ` +
        `Either the catalogue gained a platform-specific accelerator that needs a { mac, other } ` +
        `split, or WINDOWS_MODIFIER_NAMES in docs-site/scripts/lib/command-model.mjs is out of date.`
    );
  }
  return parts.join('+');
}

/**
 * The first clause of a catalogue reason — everything up to the em dash that introduces its
 * elaboration. The full sentence is worth reading once; repeated down a table column it crowds out
 * the commands. `palette-model.ts`'s `ownerSummary` shortens the consumer strings the same way.
 */
function firstClause(reason) {
  const [clause] = reason.split(' — ');
  return clause;
}

/** How the palette treats a command, as one phrase. */
function paletteAvailability(palette) {
  if (!palette.show) {
    return { inPalette: false, note: firstClause(palette.because), reason: palette.because };
  }
  if (palette.requires === undefined) return { inPalette: true, note: null };
  const label = REQUIREMENT_LABELS[palette.requires];
  if (label === undefined) {
    throw new Error(
      `The catalogue has a palette requirement this generator does not know: ` +
        `\`${palette.requires}\`. Add it to REQUIREMENT_LABELS in ` +
        `docs-site/scripts/lib/command-model.mjs.`
    );
  }
  return { inPalette: true, note: `needs ${label}` };
}

/** Two catalogue entries for the same id must agree about everything except the keystroke. */
function assertPlatformAgreement(id, macEntry, windowsEntry) {
  for (const field of ['label', 'hint', 'group']) {
    if (macEntry[field] !== windowsEntry[field]) {
      throw new Error(
        `\`${id}\` has a platform-dependent ${field} (${macEntry[field]} / ${windowsEntry[field]}). ` +
          `The reference pages render one row per command and cannot say two things.`
      );
    }
  }
}

/**
 * Every command, in catalogue order, with both platforms' keystrokes on the same row.
 *
 * `keysMac` / `keysWindows` hold EVERY binding that reaches the command, not just the primary one:
 * _New connection_ answers to two menu items, and a reference that showed one of them would be
 * wrong about the other.
 */
export function commandRows({ mac, windows }) {
  const macCatalogue = mac.catalogue.COMMAND_CATALOGUE;
  const windowsCatalogue = windows.catalogue.COMMAND_CATALOGUE;

  return Object.keys(macCatalogue).map(id => {
    const macEntry = macCatalogue[id];
    const windowsEntry = windowsCatalogue[id];
    assertPlatformAgreement(id, macEntry, windowsEntry);

    return {
      id,
      label: macEntry.label,
      hint: macEntry.hint,
      group: macEntry.group,
      source: macEntry.accelerator === null ? null : macEntry.accelerator.source,
      // `AcceleratorKeys` is a plain string when both platforms press the same key, and a
      // `{ mac, other }` pair when `menu.ts` branches — which is the exact set of commands whose
      // Windows binding is a different key rather than the same key with a different modifier.
      platformSpecific:
        macEntry.accelerator !== null && typeof macEntry.accelerator.keys !== 'string',
      keysMac: mac.catalogue.formatAcceleratorList(macEntry.accelerator),
      keysWindows: windows.catalogue
        .formatAcceleratorList(windowsEntry.accelerator)
        .map(windowsKeystroke),
      palette: paletteAvailability(macEntry.palette),
    };
  });
}

/**
 * The keystrokes that belong to a surface rather than to a command — today, the palette's own
 * opener. The cheatsheet lists them alongside the command rows and so does the reference page,
 * through the same formatter, so neither can render its keys by a different rule.
 */
export function surfaceShortcutRows({ mac, windows }) {
  return mac.paletteActions.SURFACE_SHORTCUTS.map((shortcut, index) => {
    const windowsShortcut = windows.paletteActions.SURFACE_SHORTCUTS[index];
    const format = (module, keys) =>
      keys.flatMap(key => module.catalogue.formatAcceleratorList({ source: 'renderer', keys: key }));

    return {
      id: null,
      label: shortcut.label,
      hint: shortcut.hint,
      group: shortcut.group,
      source: 'renderer',
      keysMac: format(mac, shortcut.keys),
      keysWindows: format(windows, windowsShortcut.keys).map(windowsKeystroke),
      platformSpecific: shortcut.keys.some(key => typeof key !== 'string'),
      palette: { inPalette: false, note: 'opens the palette itself' },
    };
  });
}

/** The palette's local actions: entries that are not commands and carry no keystroke. */
export function paletteActionRows({ mac }) {
  return mac.paletteActions.PALETTE_ACTIONS.map(action => ({
    id: action.id,
    label: action.label,
    hint: action.hint,
    group: action.group,
    groupLabel: mac.catalogue.COMMAND_GROUP_LABELS[action.group],
  }));
}

/** `[group, rows]` in the catalogue's own group order, skipping groups with no rows. */
export function byGroup({ mac }, rows) {
  return mac.catalogue.COMMAND_GROUPS.map(group => [
    mac.catalogue.COMMAND_GROUP_LABELS[group],
    rows.filter(row => row.group === group),
  ]).filter(([, groupRows]) => groupRows.length > 0);
}
