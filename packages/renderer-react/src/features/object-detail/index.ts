/**
 * The explorer object tab. One entry point — `ObjectPanel`, mounted by the dock — plus the pure row
 * builders, which their own spec imports by path.
 */

export { ObjectPanel } from './object-panel';
export {
  columnRows,
  indexRows,
  keyRows,
  type ColumnRow,
  type IndexRow,
  type KeyRow,
} from './object-rows';
