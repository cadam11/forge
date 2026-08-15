/**
 * Generic ERD Types for the Entity Relationship Diagram component.
 * These types are designed to be framework-agnostic and can work with any data source.
 */

/**
 * Represents a field in an ERD node (entity).
 */
export interface ERDField {
  /** Unique identifier for the field */
  id: string;
  /** Display name of the field */
  name: string;
  /** Data type of the field (e.g., 'string', 'int', 'uuid') */
  type?: string;
  /** Whether this field is a primary key */
  isPrimaryKey: boolean;
  /** ID of the related node (for foreign keys) */
  relatedNodeId?: string;
  /** Name of the related node (for display purposes) */
  relatedNodeName?: string;
  /** Name of the field in the related node (for FK relationships) */
  relatedFieldName?: string;
  /** Optional description of the field */
  description?: string;
  /** Whether the field allows null values */
  allowsNull?: boolean;
  /** Default value for the field */
  defaultValue?: string;
  /** Maximum length (for string fields) */
  length?: number;
  /** Precision (for numeric fields) */
  precision?: number;
  /** Scale (for numeric fields) */
  scale?: number;
  /** Whether the field is virtual/computed */
  isVirtual?: boolean;
  /** Whether the field is auto-increment */
  autoIncrement?: boolean;
  /** Additional custom data */
  customData?: Record<string, unknown>;
}

/**
 * Represents a node (entity/table) in the ERD.
 */
export interface ERDNode {
  /** Unique identifier for the node */
  id: string;
  /** Display name of the node */
  name: string;
  /** Optional schema/namespace name */
  schemaName?: string;
  /** Optional description */
  description?: string;
  /** Status of the node (e.g., 'Active', 'Deprecated') */
  status?: string;
  /** Base table name (if different from display name) */
  baseTable?: string;
  /** All fields in this node */
  fields: ERDField[];
  /** Additional custom data that can be used by the consumer */
  customData?: Record<string, unknown>;
}

/**
 * Represents a link (relationship) between two nodes in the ERD.
 */
export interface ERDLink {
  /** ID of the source node */
  sourceNodeId: string;
  /** ID of the target node */
  targetNodeId: string;
  /** The field that creates this relationship (usually the FK field) */
  sourceField: ERDField;
  /** The field in the target node (usually the PK field) */
  targetField?: ERDField;
  /** Whether this is a self-referencing relationship */
  isSelfReference: boolean;
  /** Relationship type (e.g., 'one-to-many', 'many-to-one') */
  relationshipType?: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  /** Optional label for the relationship */
  label?: string;
}

/**
 * Configuration options for the ERD diagram.
 */
export interface ERDConfig {
  /** Width of each node box in pixels. Default: 180 */
  nodeWidth?: number;
  /** Base height of each node box in pixels (before adding fields). Default: 60 */
  nodeBaseHeight?: number;
  /** Height per field row in pixels. Default: 20 */
  fieldHeight?: number;
  /** Maximum height of a node in pixels. Default: 300 */
  maxNodeHeight?: number;
  /** Charge strength for force simulation (negative = repel). Default: -800 */
  chargeStrength?: number;
  /** Base distance between linked nodes. Default: 80 */
  linkDistance?: number;
  /** Extra padding for collision detection. Default: 20 */
  collisionPadding?: number;
  /** Whether to show field details (PKs, FKs) in nodes. Default: true */
  showFieldDetails?: boolean;
  /** Whether to show relationship labels on links. Default: true */
  showRelationshipLabels?: boolean;
  /** Enable node dragging. Default: true */
  enableDragging?: boolean;
  /** Enable zoom with mouse wheel. Default: true */
  enableZoom?: boolean;
  /** Enable panning by dragging background. Default: true */
  enablePan?: boolean;
  /** Minimum zoom level. Default: 0.1 */
  minZoom?: number;
  /** Maximum zoom level. Default: 4 */
  maxZoom?: number;
  /** Initial zoom level (1 = 100%). Default: 1 */
  initialZoom?: number;
  /** Duration of zoom/pan animations in milliseconds. Default: 750 */
  animationDuration?: number;
  /** Whether to auto-fit diagram to container on initial load. Default: true */
  fitOnLoad?: boolean;
  /** Skip the D3 force simulation animation and render immediately. Default: false */
  skipAnimation?: boolean;
  /** Layout algorithm to use. Default: 'dagre' */
  layoutAlgorithm?: ERDLayoutAlgorithm;
  /** Dagre-specific layout configuration */
  dagreConfig?: ERDDagreConfig;
  /** Color scheme for the diagram */
  colors?: ERDColorScheme;
}

/**
 * Color scheme for the ERD diagram.
 */
export interface ERDColorScheme {
  /** Background color for node rectangles */
  nodeBackground?: string;
  /** Border color for node rectangles */
  nodeBorder?: string;
  /** Header background color for nodes */
  nodeHeader?: string;
  /** Text color for node headers */
  nodeHeaderText?: string;
  /** Background color for primary key fields */
  primaryKeyBackground?: string;
  /** Text color for primary key fields */
  primaryKeyText?: string;
  /** Background color for foreign key fields */
  foreignKeyBackground?: string;
  /** Text color for foreign key fields */
  foreignKeyText?: string;
  /** Color for relationship links */
  linkColor?: string;
  /** Color for selected nodes */
  selectedBorder?: string;
  /** Color for highlighted nodes */
  highlightBorder?: string;
  /** Color for related nodes (when showing relationships) */
  relatedBorder?: string;
}

/**
 * Layout algorithm options for the ERD diagram.
 */
export type ERDLayoutAlgorithm = 'force' | 'dagre' | 'horizontal' | 'vertical' | 'radial';

/**
 * Dagre-specific layout configuration options.
 */
export interface ERDDagreConfig {
  /** Direction of the graph layout. Default: 'LR' (left-to-right) */
  rankDir?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Horizontal separation between nodes. Default: 50 */
  nodeSep?: number;
  /** Vertical separation between ranks/layers. Default: 100 */
  rankSep?: number;
  /** Separation between different edge paths. Default: 10 */
  edgeSep?: number;
  /** Algorithm for ranking nodes */
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  /** Alignment of nodes within their rank */
  align?: 'UL' | 'UR' | 'DL' | 'DR';
}

/**
 * Event data for node click events.
 */
export interface ERDNodeClickEvent {
  /** The clicked node */
  node: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Whether to cancel default behavior (selection) */
  cancel: boolean;
}

/**
 * Event data for node double-click events.
 */
export interface ERDNodeDoubleClickEvent {
  /** The double-clicked node */
  node: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Whether to cancel default behavior */
  cancel: boolean;
}

/**
 * Event data for link click events.
 */
export interface ERDLinkClickEvent {
  /** The clicked link */
  link: ERDLink;
  /** Source node */
  sourceNode: ERDNode;
  /** Target node */
  targetNode: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Whether to cancel default behavior */
  cancel: boolean;
}

/**
 * Event data for zoom change events.
 */
export interface ERDZoomEvent {
  /** Current zoom level */
  zoomLevel: number;
  /** X translation */
  translateX: number;
  /** Y translation */
  translateY: number;
}

/**
 * State of the ERD diagram for saving/restoring.
 */
export interface ERDState {
  /** ID of the currently selected node */
  selectedNodeId: string | null;
  /** IDs of highlighted nodes */
  highlightedNodeIds: string[];
  /** Current zoom level (1 = 100%) */
  zoomLevel: number;
  /** X translation (pan position) */
  translateX: number;
  /** Y translation (pan position) */
  translateY: number;
  /** Focus node ID (if in focus mode) */
  focusNodeId: string | null;
  /** Focus depth (number of relationship hops to show) */
  focusDepth: number;
  /** Node positions for restoring exact layout */
  nodePositions: Record<string, { x: number; y: number; fx?: number | null; fy?: number | null }>;
}

/**
 * Event data for node hover events.
 */
export interface ERDNodeHoverEvent {
  /** The hovered node */
  node: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Nodes directly connected to this node via relationships */
  relatedNodes: ERDNode[];
  /** Position for displaying tooltips */
  position: { x: number; y: number };
}

/**
 * Event data for link hover events.
 */
export interface ERDLinkHoverEvent {
  /** The hovered link */
  link: ERDLink;
  /** Source node of the relationship */
  sourceNode: ERDNode;
  /** Target node of the relationship */
  targetNode: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Position for displaying tooltips */
  position: { x: number; y: number };
}

/**
 * Event data for context menu events on nodes.
 */
export interface ERDNodeContextMenuEvent {
  /** The right-clicked node */
  node: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Set to true to prevent default context menu */
  cancel: boolean;
  /** Screen position for showing custom context menu */
  position: { x: number; y: number };
}

/**
 * Event data for context menu events on links.
 */
export interface ERDLinkContextMenuEvent {
  /** The right-clicked link */
  link: ERDLink;
  /** Source node */
  sourceNode: ERDNode;
  /** Target node */
  targetNode: ERDNode;
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Set to true to prevent default context menu */
  cancel: boolean;
  /** Screen position for showing custom context menu */
  position: { x: number; y: number };
}

/**
 * Event data for context menu events on the diagram background.
 */
export interface ERDDiagramContextMenuEvent {
  /** The mouse event */
  mouseEvent: MouseEvent;
  /** Set to true to prevent default context menu */
  cancel: boolean;
  /** Screen position for showing custom context menu */
  position: { x: number; y: number };
  /** Diagram coordinates of the click */
  diagramPosition: { x: number; y: number };
}

/**
 * Event data for node drag events.
 */
export interface ERDNodeDragEvent {
  /** The dragged node */
  node: ERDNode;
  /** Position when drag started */
  startPosition: { x: number; y: number };
  /** Current position during drag */
  currentPosition: { x: number; y: number };
  /** Set to true in dragStart to cancel the drag */
  cancel: boolean;
}

/**
 * Information about a relationship for highlighting purposes.
 */
export interface ERDRelationshipInfo {
  /** The related node */
  node: ERDNode;
  /** The link connecting them */
  link: ERDLink;
  /** Direction of relationship from the perspective of the source node */
  direction: 'outgoing' | 'incoming';
  /** The field creating this relationship */
  field: ERDField;
}
