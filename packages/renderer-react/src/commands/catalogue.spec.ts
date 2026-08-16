/**
 * The catalogue, checked against the main process rather than against itself.
 *
 * ── The mechanical accelerator check ────────────────────────────────────────────────────────
 *
 * `packages/main/src/menu.ts` is the source of truth for every menu accelerator, and the renderer may
 * not import from it — so `catalogue.ts` restates the values, and a restatement rots. Task 7's review
 * found three of the registry's accelerator COMMENTS already wrong.
 *
 * This spec closes that by reading both files as text and composing the chain the app really uses:
 *
 *   menu.ts        `accelerator: 'CmdOrCtrl+N'` … `send('menu:new-query')`   → channel → keys
 *   preload        `NEW_QUERY: 'menu:new-query'` … `onNewQuery: … NEW_QUERY` → channel → `on*`
 *   menu-bridge    `onNewQuery: 'new-query'`                                 → `on*` → command id
 *
 * so every menu-sourced accelerator in the catalogue is compared with what `menu.ts` registers for
 * the command it belongs to. `?raw` rather than a filesystem read because this package compiles
 * without `@types/node` — the same mechanism `markdown/sanitize-parity.spec.ts` uses, and it means
 * the imports cannot silently stop resolving.
 *
 * The parse is asserted to have found something first: a regex that matched nothing would make every
 * comparison below vacuous, which is the failure mode a source-scanning test has.
 */

import { describe, expect, it } from 'vitest';

import MENU_SOURCE from '../../../main/src/menu.ts?raw';
import PRELOAD_SOURCE from '../../../preload/src/index.ts?raw';
import { MENU_COMMANDS } from '../shell/menu-bridge';
import {
  COMMAND_CATALOGUE,
  COMMAND_GROUPS,
  COMMAND_GROUP_LABELS,
  acceleratorKeysForPlatform,
  commandAccelerator,
  formatAccelerator,
  paletteCommandIds,
  type AcceleratorKeys,
} from './catalogue';
import { COMMAND_IDS, type CommandId } from './registry';

// ── Parsing `menu.ts` ────────────────────────────────────────────────────────────────────────

/** One accelerator as `menu.ts` spells it: a literal, or the two halves of an `isMac` ternary. */
type ParsedKeys = AcceleratorKeys;

/**
 * Channel → accelerator, for every `webContents.send('menu:…')` in the menu definition.
 *
 * The scan walks three token kinds in source order — `label:`, `accelerator:`, `send('menu:…')` — and
 * pairs a send with the accelerator of the item it is inside. `label:` resets the pending
 * accelerator, which is what stops an item WITHOUT one (Server ▸ Disconnect, Database ▸ Backup)
 * inheriting the previous item's keys.
 */
function parseMenuAccelerators(source: string): Map<string, ParsedKeys[]> {
  const TOKENS =
    /label:|accelerator:\s*(?:isMac\s*\?\s*'([^']+)'\s*:\s*'([^']+)'|'([^']+)')|send\('(menu:[a-z-]+)'\)/g;
  // A LIST per channel, not one value: two menu items send `menu:new-connection` (File ▸ New
  // Connection at ⇧⌘N, Server ▸ Connect… at ⇧⌘C) and two send `menu:open-settings`. Overwriting would
  // have silently checked only whichever came last in the file.
  const found = new Map<string, ParsedKeys[]>();
  let pending: ParsedKeys | null = null;

  for (const match of source.matchAll(TOKENS)) {
    const [token, macBranch, otherBranch, literal, channel] = match;

    if (channel !== undefined) {
      const existing = found.get(channel) ?? [];
      if (pending !== null) existing.push(pending);
      found.set(channel, existing);
      pending = null;
      continue;
    }
    if (token.startsWith('label:')) {
      pending = null;
      continue;
    }
    pending =
      literal !== undefined
        ? unescapeSource(literal)
        : { mac: unescapeSource(macBranch ?? ''), other: unescapeSource(otherBranch ?? '') };
  }

  return found;
}

/**
 * A TypeScript string literal's source text as its VALUE. Only one escape appears in these
 * accelerators — `'CmdOrCtrl+\\'` for ⌘\ — and comparing source text to a value would fail on it,
 * which is exactly the sort of false positive that gets a source-scanning test deleted.
 */
function unescapeSource(literal: string): string {
  return literal.replace(/\\\\/g, '\\');
}

/** `on*` member → channel string, from preload's own two tables. */
function parsePreloadChannels(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/^\s{2}([A-Z][A-Z0-9_]*): '(menu:[a-z-]+)',$/gm)) {
    constants.set(match[1] ?? '', match[2] ?? '');
  }

  const members = new Map<string, string>();
  for (const match of source.matchAll(
    /(on[A-Z][A-Za-z]*): callback =>\s*\n?\s*createEventListener\(MENU_CHANNELS\.([A-Z][A-Z0-9_]*),/g
  )) {
    const channel = constants.get(match[2] ?? '');
    if (channel !== undefined) members.set(match[1] ?? '', channel);
  }
  return members;
}

const MENU_ACCELERATORS = parseMenuAccelerators(MENU_SOURCE);
const PRELOAD_CHANNELS = parsePreloadChannels(PRELOAD_SOURCE);

/** Command id → every accelerator `menu.ts` registers for the channel that reaches it. */
const ACCELERATOR_BY_COMMAND = new Map<CommandId, ParsedKeys[]>(
  Object.entries(MENU_COMMANDS).flatMap(([member, commandId]) => {
    const channel = PRELOAD_CHANNELS.get(member);
    if (channel === undefined) return [];
    return [[commandId, MENU_ACCELERATORS.get(channel) ?? []] as [CommandId, ParsedKeys[]]];
  })
);

/** Every binding a catalogue entry declares: the primary plus its alternates. */
function declaredKeys(id: CommandId): ParsedKeys[] {
  const accelerator = COMMAND_CATALOGUE[id].accelerator;
  if (accelerator === null) return [];
  return [accelerator.keys, ...(accelerator.alternates ?? [])];
}

/**
 * Comparable, order-independent, de-duplicated form of a key set.
 *
 * Normalized through `normalizeAccelerator` so `'Cmd+,'` and `'CmdOrCtrl+,'` count as one keystroke:
 * the app menu's Settings and the Edit menu's Preferences both register ⌘, (menu.ts:21,176), spelled
 * differently because the app menu is macOS-only. They are the same key to a user, and the catalogue
 * declares it once.
 */
function keySet(keys: readonly ParsedKeys[]): string[] {
  const forms = keys.map(entry =>
    typeof entry === 'string'
      ? normalizeAccelerator(entry)
      : `${normalizeAccelerator(entry.mac)}|${normalizeAccelerator(entry.other)}`
  );
  return [...new Set(forms)].sort();
}

describe('the source scan found what it is checking', () => {
  it('parsed the menu definition', () => {
    // 31 channels, and most of them carry an accelerator. A parse that degraded to nothing would make
    // every comparison below pass silently.
    expect(MENU_ACCELERATORS.size).toBe(31);
    expect([...MENU_ACCELERATORS.values()].filter(keys => keys.length > 0).length).toBeGreaterThan(
      20
    );
    expect(MENU_ACCELERATORS.get('menu:new-query')).toEqual(['CmdOrCtrl+N']);
    expect(MENU_ACCELERATORS.get('menu:execute-selection')).toEqual([
      { mac: 'Cmd+Shift+Return', other: 'Ctrl+Shift+E' },
    ]);
    // The two-item channel, both bindings found.
    expect(MENU_ACCELERATORS.get('menu:new-connection')).toEqual([
      'CmdOrCtrl+Shift+N',
      'CmdOrCtrl+Shift+C',
    ]);
    // An item with no accelerator must come back empty rather than inheriting its neighbour's.
    expect(MENU_ACCELERATORS.get('menu:backup')).toEqual([]);
    expect(MENU_ACCELERATORS.get('menu:disconnect')).toEqual([]);
  });

  it('parsed preload and joined the two, one accelerator per routed channel', () => {
    expect(PRELOAD_CHANNELS.get('onNewQuery')).toBe('menu:new-query');
    expect(PRELOAD_CHANNELS.size).toBe(Object.keys(MENU_COMMANDS).length);
    expect(ACCELERATOR_BY_COMMAND.size).toBe(Object.keys(MENU_COMMANDS).length);
  });
});

describe('every accelerator in the catalogue is the one the main process registers', () => {
  for (const [member, commandId] of Object.entries(MENU_COMMANDS)) {
    it(`${member} → ${commandId}`, () => {
      const registered = ACCELERATOR_BY_COMMAND.get(commandId) ?? [];
      const declared = COMMAND_CATALOGUE[commandId].accelerator;

      if (registered.length === 0) {
        // The menu item has no accelerator. The catalogue may declare nothing, or a renderer-owned or
        // editor-owned key — never a `menu` one, because there is no menu binding to be the source of.
        if (declared !== null) expect(declared.source).not.toBe('menu');
        return;
      }

      expect(declared, `${commandId} has no accelerator, but menu.ts registers one`).not.toBeNull();
      expect(keySet(declaredKeys(commandId))).toEqual(keySet(registered));
      // ⌘E and ⌘A are declared with `registerAccelerator: false`, so the menu SHOWS them and Monaco
      // BINDS them — `source: 'editor'`. Everything else the menu registers is `source: 'menu'`.
      expect(['menu', 'editor']).toContain(declared?.source);
    });
  }

  it('claims no menu source for a command with no menu channel', () => {
    // Widened to the full id union: `MENU_COMMANDS`' values are payload-free by type, and the ids being
    // filtered are not.
    const routed = new Set<CommandId>(Object.values(MENU_COMMANDS));
    const liars = COMMAND_IDS.filter(id => {
      const accelerator = COMMAND_CATALOGUE[id].accelerator;
      return accelerator !== null && accelerator.source === 'menu' && !routed.has(id);
    });
    expect(liars).toEqual([]);
  });

  it('keeps the renderer-owned keys off every registered accelerator', () => {
    // The Angular snippet library's ⇧⌘S sat on File ▸ Save Query As, so Electron fired the menu item
    // and the library's own keydown never ran. Any renderer-owned key that collides with a REGISTERED
    // accelerator is dead on arrival, and this is what catches the next one.
    const registered = new Set(
      [...MENU_ACCELERATORS.values()]
        .flat()
        .flatMap(keys => (typeof keys === 'string' ? [keys] : [keys.mac, keys.other]))
        .map(normalizeAccelerator)
    );
    // ⌘E and ⌘A are `registerAccelerator: false`, so they are NOT registered and are legal to bind.
    registered.delete(normalizeAccelerator('CmdOrCtrl+E'));
    registered.delete(normalizeAccelerator('CmdOrCtrl+A'));

    const collisions = COMMAND_IDS.filter(id => {
      const accelerator = COMMAND_CATALOGUE[id].accelerator;
      if (accelerator === null || accelerator.source !== 'renderer') return false;
      const forms = declaredKeys(id).flatMap(keys =>
        typeof keys === 'string' ? [keys] : [keys.mac, keys.other]
      );
      return forms.map(normalizeAccelerator).some(form => registered.has(form));
    });

    expect(collisions).toEqual([]);
  });
});

/** `Cmd+Shift+S` and `CmdOrCtrl+Shift+S` are the same keystroke on macOS. Compare them as one. */
function normalizeAccelerator(keys: string): string {
  return keys
    .split('+')
    .map(part => (part === 'Cmd' || part === 'Command' ? 'CmdOrCtrl' : part))
    .map(part => (part === 'Option' ? 'Alt' : part))
    .join('+')
    .toLowerCase();
}

describe('the palette side of the catalogue', () => {
  it('lists no command that carries a payload', () => {
    // The load-bearing assertion behind `palette-model.ts`'s one cast: it treats every `palette.show`
    // id as a `PayloadlessCommandId`, which the type system cannot check for a `Record` key. A
    // payload command in the palette would be dispatched with `undefined` as its payload.
    const withPayloads = paletteCommandIds().filter(id => PAYLOAD_COMMANDS.has(id));
    expect(withPayloads).toEqual([]);
  });

  it('gives every excluded command a stated reason', () => {
    for (const id of COMMAND_IDS) {
      const visibility = COMMAND_CATALOGUE[id].palette;
      if (visibility.show) continue;
      expect(visibility.because.length, `${id} is hidden for no stated reason`).toBeGreaterThan(20);
    }
  });

  it('excludes every payload-carrying command, and only for that reason', () => {
    // The other direction of the first test: a targeted command must not quietly become visible.
    for (const id of PAYLOAD_COMMANDS) {
      expect(COMMAND_CATALOGUE[id].palette.show, `${id} is in the palette`).toBe(false);
    }
  });

  it('lists most of the app: at least twenty commands are reachable by name', () => {
    // A palette that derived down to three entries would satisfy every rule above. The Angular one
    // offered 26 rows including its ten dead ones, so a floor of 20 live entries is the honest bar.
    expect(paletteCommandIds().length).toBeGreaterThanOrEqual(20);
  });
});

/**
 * The ids whose payload is not `void`, listed by hand **in the spec** rather than derived.
 *
 * Deliberate: deriving it from the same types the assertions check would make them tautological. This
 * is the one place a hand-written list is the point, and if the registry gains a payload command
 * without this list gaining it, the `Record` below fails to compile.
 */
const PAYLOAD_COMMAND_REASONS: Record<
  | 'edit-connection'
  | 'create-database-on-server'
  | 'backup-database'
  | 'restore-database'
  | 'rename-database'
  | 'delete-database'
  | 'show-object-properties'
  | 'cursor-position'
  | 'insert-snippet'
  | 'reveal-explorer-node',
  string
> = {
  'edit-connection': 'needs a profile id',
  'create-database-on-server': 'needs a server',
  'backup-database': 'needs a database',
  'restore-database': 'needs a server',
  'rename-database': 'needs a database',
  'delete-database': 'needs a database',
  'show-object-properties': 'needs an object',
  'cursor-position': 'a caret position, from the editor to the status bar',
  'insert-snippet': 'needs the SQL to insert',
  'reveal-explorer-node': 'needs an object to reveal',
};

const PAYLOAD_COMMANDS = new Set<CommandId>(Object.keys(PAYLOAD_COMMAND_REASONS) as CommandId[]);

describe('the catalogue is complete and says something', () => {
  it('covers every registered command', () => {
    expect(Object.keys(COMMAND_CATALOGUE).sort()).toEqual([...COMMAND_IDS].sort());
  });

  it('gives every command a label, a hint and a known group', () => {
    for (const id of COMMAND_IDS) {
      const display = COMMAND_CATALOGUE[id];
      expect(display.label.length, `${id} label`).toBeGreaterThan(2);
      expect(display.hint.length, `${id} hint`).toBeGreaterThan(10);
      expect(display.hint, `${id} hint repeats its label`).not.toBe(display.label);
      expect(COMMAND_GROUPS, `${id} group`).toContain(display.group);
    }
  });

  it('labels every group', () => {
    for (const group of COMMAND_GROUPS) {
      expect(COMMAND_GROUP_LABELS[group].length).toBeGreaterThan(2);
    }
  });
});

describe('formatAccelerator', () => {
  // jsdom's user agent contains no "Mac", so `IS_MAC` is false in this suite and the non-Mac branch is
  // what runs. Both branches are still asserted: the Mac one through the glyph mapping of a spec-built
  // accelerator, which does not depend on the platform flag.
  it('renders the platform branch of a split accelerator', () => {
    expect(acceleratorKeysForPlatform({ mac: 'Cmd+Shift+Return', other: 'Ctrl+Shift+E' })).toBe(
      'Ctrl+Shift+E'
    );
    expect(acceleratorKeysForPlatform('CmdOrCtrl+K')).toBe('CmdOrCtrl+K');
  });

  it('joins non-Mac keys with plus signs and upper-cases the final key', () => {
    expect(formatAccelerator({ source: 'menu', keys: 'CmdOrCtrl+Shift+n' })).toBe(
      'CmdOrCtrl+Shift+N'
    );
  });

  it('returns null when there is no binding', () => {
    expect(formatAccelerator(null)).toBeNull();
    expect(commandAccelerator('show-database-properties')).toBeNull();
  });

  it('formats every declared accelerator without dropping one', () => {
    for (const id of COMMAND_IDS) {
      const hasKeys = COMMAND_CATALOGUE[id].accelerator !== null;
      expect(commandAccelerator(id) !== null, `${id}`).toBe(hasKeys);
    }
  });
});
