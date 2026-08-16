/**
 * The ERD's data model — tables as nodes, foreign keys as links.
 *
 * Ported from `packages/renderer/src/app/shared/components/erd-diagram/erd-types.ts` (363 LOC),
 * which is 22 interfaces. This is four, and the difference is not trimming for its own sake — the
 * Angular file typed a *component API* that no caller used:
 *
 *  - **Fourteen event-payload interfaces** (`ERDNodeClickEvent`, `ERDLinkContextMenuEvent`,
 *    `ERDNodeDragEvent`, …) each carrying a `cancel` flag the diagram checked after emitting. The
 *    ERD tab subscribed to four of the seventeen `@Output()`s and never set `cancel` on any of
 *    them. React's event model needs none of this: a handler that wants to cancel returns, and a
 *    handler that wants the DOM event is given it.
 *  - **`ERDConfig.colors` / `ERDColorScheme`** — twelve hex strings, plus the runtime
 *    `getComputedStyle('--bg-primary')` luminance probe that guessed which theme was live
 *    (`erd-diagram.component.ts:647-691`). Both are gone: the diagram paints from Tailwind token
 *    classes, so the theme follows `data-theme` with no JavaScript involved at all. That probe is
 *    the single biggest reason the Angular ERD was not theme-aware — it only overrode *six* of the
 *    twelve colours for light mode, so PK/FK washes and the self-reference green stayed at their
 *    dark-mode values on ivory.
 *  - **`ERDState` / `nodePositions`** — a save/restore shape the diagram emitted on every
 *    selection change (`stateChange`) and which the ERD tab did not bind. Layout here is a pure
 *    function of the schema (`erd-layout.ts`), so positions are reproducible rather than
 *    persisted.
 *  - **`ERDField.length/precision/scale`** — carried alongside `type` and read by nothing except
 *    the adapter's own `formatColumnType`, which had already folded them into the `type` string.
 *
 * What survives is what the diagram and the details panel actually read, plus the two fields that
 * were reached through `customData: Record<string, unknown>` — `constraintName` on a field. Typing
 * them retires the last `unknown` in the model.
 */

/** One column of a table, as the diagram and the details panel need it. */
export interface ErdField {
  /** `${nodeId}.${name}` — stable across reloads, which is what React keys need. */
  readonly id: string;
  readonly name: string;
  /** Display type, already formatted with length/precision/scale — see `formatColumnType`. */
  readonly type: string;
  readonly isPrimaryKey: boolean;
  readonly allowsNull: boolean;
  readonly autoIncrement: boolean;
  readonly defaultValue?: string;
  /** `${schema}.${table}` this column references, when it is a foreign key. */
  readonly relatedNodeId?: string;
  readonly relatedNodeName?: string;
  readonly relatedFieldName?: string;
  /** The FK constraint's name. Was `customData.constraintName` in the Angular model. */
  readonly constraintName?: string;
}

/** One table. */
export interface ErdNode {
  /** `${schema}.${name}`. */
  readonly id: string;
  readonly name: string;
  readonly schemaName: string;
  readonly fields: readonly ErdField[];
}

/**
 * One foreign-key relationship, source (the table holding the FK column) to target.
 *
 * `id` is new. The Angular model had no link identity, so the diagram keyed its D3 join on array
 * index — which is exactly the case a data join must not use, because inserting one table shifts
 * every later link onto a different DOM element.
 */
export interface ErdLink {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourceField: ErdField;
  readonly targetField?: ErdField;
  readonly isSelfReference: boolean;
}

/**
 * Every FK relationship among a set of nodes, source-first.
 *
 * Ported from `createInternalLinks` (`erd-diagram.component.ts:840-867`) including its two filters,
 * both of which matter:
 *
 *  - `!field.isPrimaryKey` — a column that is both PK and FK (the child half of a 1:1, or a
 *    junction table's composite key) draws no edge. That is a real loss of information rather than
 *    a rule, and it is kept because changing it changes the layout of every diagram; it is written
 *    down here rather than left implicit. See FOLLOW-UPS.
 *  - both endpoints must be in `nodes` — a focused ERD is a subgraph, so an FK pointing outside it
 *    has nothing to attach to.
 */
export function erdLinks(nodes: readonly ErdNode[]): readonly ErdLink[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const links: ErdLink[] = [];

  for (const node of nodes) {
    for (const field of node.fields) {
      const targetId = field.relatedNodeId;
      if (targetId === undefined || field.isPrimaryKey) continue;

      const target = byId.get(targetId);
      if (target === undefined) continue;

      links.push({
        // The FK column is what makes the relationship, and a column belongs to one table, so
        // `${nodeId}.${column}` is already unique across the whole diagram.
        id: field.id,
        sourceNodeId: node.id,
        targetNodeId: targetId,
        sourceField: field,
        targetField: target.fields.find(
          candidate => candidate.isPrimaryKey && candidate.name === field.relatedFieldName
        ),
        isSelfReference: node.id === targetId,
      });
    }
  }

  return links;
}

/**
 * The ids reachable from `nodeId` within `depth` FK hops, in **either** direction, excluding
 * `nodeId` itself.
 *
 * Ported from `getRelatedNodeIds` (`erd-diagram.component.ts:784-812`), which walked every node's
 * every field once per queue entry — O(depth × nodes × fields) with a nested scan inside. This
 * builds the undirected adjacency once and then does a plain BFS, which is what makes it usable at
 * the 200-table size Task 23 measures.
 *
 * The loop is bounded twice over: `visited` can only grow to `nodes.length`, and the queue is
 * drained head-first with no re-entry. `depth` is clamped so a caller cannot ask for a walk that
 * never ends.
 */
export function relatedNodeIds(
  nodes: readonly ErdNode[],
  nodeId: string,
  depth: number
): readonly string[] {
  const hops = Math.max(0, Math.min(Math.trunc(depth), MAX_RELATED_DEPTH));
  if (hops === 0) return [];

  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const existing = neighbours.get(from);
    if (existing === undefined) neighbours.set(from, new Set([to]));
    else existing.add(to);
  };

  for (const node of nodes) {
    for (const field of node.fields) {
      const targetId = field.relatedNodeId;
      if (targetId === undefined || targetId === node.id) continue;
      link(node.id, targetId);
      link(targetId, node.id);
    }
  }

  const visited = new Set([nodeId]);
  const found: string[] = [];
  let frontier = [nodeId];

  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbour of neighbours.get(current) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        found.push(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  return found;
}

/**
 * Why a cap at all: `depth` reaches this module from a tab's persisted `metadata.focusDepth`
 * (`state/tab.ts`), which is `Record<string, unknown>` read back off disk. Six hops is already the
 * whole of any schema anyone navigates by relationship.
 */
export const MAX_RELATED_DEPTH = 6;

/*
 * `applyFocusMode` (`erd-diagram.component.ts:764-782`) is deliberately NOT ported.
 *
 * It filtered the node set down to a focus table's neighbourhood — necessary in Angular, where the
 * diagram component was handed every node the tab had loaded and had to narrow them itself. Here the
 * narrowing happens one layer earlier and for free: `buildErdForTable` only ever FETCHES the focus
 * table and its FK neighbourhood, so the node set already IS the subgraph. A second filter over the
 * same set would be a no-op with a comment claiming otherwise.
 */
