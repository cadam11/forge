/**
 * The object search's public surface. Import from `../object-search`, never from a file inside it.
 *
 * `ObjectSearch` is what the shell mounts; it opens itself on ⌘P and on the `open-object-search`
 * command. The model is exported for its spec and for anything that later needs the same per-engine
 * "what does opening this object mean?" answer.
 */

export { ObjectSearch } from './object-search';
export {
  OBJECT_FOLDERS,
  OBJECT_SEARCH_ROW_LIMIT,
  planObjectOpen,
  qualifiedName,
  SEARCHABLE_OBJECT_TYPES,
  toSearchableObject,
  type ObjectOpenPlan,
  type SearchableObject,
  type SearchableObjectType,
} from './object-model';
