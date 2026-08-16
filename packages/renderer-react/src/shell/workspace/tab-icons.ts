/**
 * Tab type → lucide glyph.
 *
 * The `Tab.icon` field holds a **Material ligature name** (`'code'`, `'account_tree'`,
 * `'table_chart'`, …) because `tab.state.ts` was written against `<mat-icon>`, and Task 4 ported
 * that field verbatim rather than inventing a mapping the renderer could not yet honour. Icons in
 * this renderer are lucide components passed as values (`ui/icon.tsx`), so the string is not
 * something a component can render.
 *
 * Rather than translate 1,148 ligature names, the mapping is keyed on what the tab actually IS —
 * its type, and for object tabs the object type it carries in metadata. That is the same
 * information the ligature encoded, minus the indirection. `Tab.icon` therefore has no consumer
 * in the React renderer; it stays on the type because it round-trips through persisted layout
 * params, and retiring it is a cutover-time cleanup (see FOLLOW-UPS).
 */

import {
  Braces,
  FileCode2,
  FunctionSquare,
  House,
  Key,
  ListOrdered,
  Network,
  Sparkles,
  Table2,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Tab, TabType } from '../../state/tab';

const ICON_BY_TAB_TYPE: Record<TabType, LucideIcon> = {
  welcome: House,
  query: FileCode2,
  results: Table2,
  object: Table2,
  erd: Network,
  chat: Sparkles,
};

/** Mirrors the `OBJECT_TYPE_ICONS` table in `state/tab.ts`, one lucide glyph per entry. */
const ICON_BY_OBJECT_TYPE: Record<string, LucideIcon> = {
  table: Table2,
  view: Table2,
  procedure: FunctionSquare,
  function: FunctionSquare,
  index: ListOrdered,
  trigger: Zap,
  constraint: Key,
};

/** The Output / Console panel, which is a panel rather than a tab. */
export const OUTPUT_PANEL_ICON = Terminal;

export function iconForTab(tab: Pick<Tab, 'type' | 'metadata'>): LucideIcon {
  if (tab.type === 'object') {
    const objectType = tab.metadata?.['objectType'];
    if (typeof objectType === 'string') {
      return ICON_BY_OBJECT_TYPE[objectType.toLowerCase()] ?? Braces;
    }
  }
  return ICON_BY_TAB_TYPE[tab.type] ?? FileCode2;
}
