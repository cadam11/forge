import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import * as d3 from 'd3';
import {
  ERDNode,
  ERDField,
  ERDLink,
  ERDConfig,
  ERDNodeClickEvent,
  ERDNodeDoubleClickEvent,
  ERDLinkClickEvent,
  ERDZoomEvent,
  ERDColorScheme,
  ERDState,
  ERDNodeHoverEvent,
  ERDLinkHoverEvent,
  ERDNodeContextMenuEvent,
  ERDLinkContextMenuEvent,
  ERDDiagramContextMenuEvent,
  ERDNodeDragEvent,
  ERDRelationshipInfo,
  ERDDagreConfig,
} from './erd-types';

/**
 * Internal node representation for D3 force simulation.
 */
interface InternalNode {
  id: string;
  name: string;
  node: ERDNode;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  width: number;
  height: number;
  primaryKeys: ERDField[];
  foreignKeys: ERDField[];
}

/**
 * Internal link representation for D3 force simulation.
 */
interface InternalLink {
  source: string | InternalNode;
  target: string | InternalNode;
  sourceField: ERDField;
  targetField?: ERDField;
  isSelfReference: boolean;
  points?: Array<{ x: number; y: number }>;
}

/** Default dagre configuration */
const DEFAULT_DAGRE_CONFIG: Required<ERDDagreConfig> = {
  rankDir: 'LR',
  nodeSep: 80,
  rankSep: 150,
  edgeSep: 20,
  ranker: 'network-simplex',
  align: undefined as unknown as 'UL' | 'UR' | 'DL' | 'DR',
};

const DEFAULT_CONFIG: Required<ERDConfig> = {
  nodeWidth: 180,
  nodeBaseHeight: 60,
  fieldHeight: 20,
  maxNodeHeight: 300,
  chargeStrength: -800,
  linkDistance: 80,
  collisionPadding: 20,
  showFieldDetails: true,
  showRelationshipLabels: true,
  enableDragging: true,
  enableZoom: true,
  enablePan: true,
  minZoom: 0.1,
  maxZoom: 4,
  initialZoom: 1,
  animationDuration: 750,
  fitOnLoad: true,
  skipAnimation: false,
  layoutAlgorithm: 'dagre',
  dagreConfig: DEFAULT_DAGRE_CONFIG,
  colors: {
    nodeBackground: '#1e1e1e',
    nodeBorder: '#3c3c3c',
    nodeHeader: '#0d47a1',
    nodeHeaderText: '#ffffff',
    primaryKeyBackground: '#fff3cd',
    primaryKeyText: '#856404',
    foreignKeyBackground: '#cce5ff',
    foreignKeyText: '#004085',
    linkColor: '#666',
    selectedBorder: '#2196f3',
    highlightBorder: '#ff9800',
    relatedBorder: '#ff6b35',
  },
};

@Component({
  selector: 'app-erd-diagram',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './erd-diagram.component.html',
  styleUrls: ['./erd-diagram.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ERDDiagramComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('erdContainer', { static: false }) erdContainer!: ElementRef;

  // Data inputs
  @Input() nodes: ERDNode[] = [];
  @Input() selectedNodeId: string | null = null;
  @Input() highlightedNodeIds: string[] = [];
  @Input() focusNodeId: string | null = null;
  @Input() focusDepth = 1;

  // State inputs
  @Input() isRefreshing = false;
  @Input() readOnly = false;

  // Configuration inputs
  @Input() config: ERDConfig = {};
  @Input() showHeader = true;
  @Input() headerTitle = 'Entity Relationship Diagram';

  // Selection Events
  @Output() nodeClick = new EventEmitter<ERDNodeClickEvent>();
  @Output() nodeDoubleClick = new EventEmitter<ERDNodeDoubleClickEvent>();
  @Output() nodeSelected = new EventEmitter<ERDNode>();
  @Output() nodeDeselected = new EventEmitter<void>();
  @Output() linkClick = new EventEmitter<ERDLinkClickEvent>();

  // Hover Events
  @Output() nodeHover = new EventEmitter<ERDNodeHoverEvent>();
  @Output() nodeHoverEnd = new EventEmitter<ERDNode>();
  @Output() linkHover = new EventEmitter<ERDLinkHoverEvent>();
  @Output() linkHoverEnd = new EventEmitter<ERDLink>();

  // Context Menu Events
  @Output() nodeContextMenu = new EventEmitter<ERDNodeContextMenuEvent>();
  @Output() linkContextMenu = new EventEmitter<ERDLinkContextMenuEvent>();
  @Output() diagramContextMenu = new EventEmitter<ERDDiagramContextMenuEvent>();

  // Drag Events
  @Output() nodeDragStart = new EventEmitter<ERDNodeDragEvent>();
  @Output() nodeDragEnd = new EventEmitter<ERDNodeDragEvent>();

  // Diagram Events
  @Output() zoomChange = new EventEmitter<ERDZoomEvent>();
  @Output() refreshRequested = new EventEmitter<void>();
  @Output() layoutComplete = new EventEmitter<void>();
  @Output() stateChange = new EventEmitter<ERDState>();

  // Private state
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private simulation: d3.Simulation<InternalNode, InternalLink> | null = null;
  private internalNodes: InternalNode[] = [];
  private internalLinks: InternalLink[] = [];
  private visibleNodes: InternalNode[] = [];
  private visibleLinks: InternalLink[] = [];
  private zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private resizeObserver?: ResizeObserver;
  private lastKnownSize = { width: 0, height: 0 };
  private resizeTimeout?: number;
  private mergedConfig: Required<ERDConfig> = DEFAULT_CONFIG;
  private layoutCompleted = false;
  private isLayoutFrozen = false;

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.setupERD();
    }, 100);

    this.setupResizeObserver();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['nodes'] && !changes['nodes'].firstChange) {
      this.setupERD();
    }

    if (changes['selectedNodeId'] && !changes['selectedNodeId'].firstChange) {
      this.updateSelectionHighlighting();
      this.emitStateChange();
    }

    if (changes['highlightedNodeIds'] && !changes['highlightedNodeIds'].firstChange) {
      this.updateHighlighting();
      this.emitStateChange();
    }

    if (changes['focusNodeId'] && !changes['focusNodeId'].firstChange) {
      this.setupERD();
      this.emitStateChange();
    }

    if (changes['focusDepth'] && !changes['focusDepth'].firstChange) {
      if (this.focusNodeId) {
        this.setupERD();
        this.emitStateChange();
      }
    }

    if (changes['config'] && !changes['config'].firstChange) {
      this.mergeConfig();
      this.setupERD();
    }
  }

  ngOnDestroy(): void {
    if (this.simulation) {
      this.simulation.stop();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
  }

  // Public API - Zoom Control
  public zoomIn(): void {
    if (this.zoom && this.svg) {
      this.svg
        .transition()
        .duration(300)
        .call(
          this.zoom.scaleBy as unknown as (
            transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
            k: number
          ) => void,
          1.2
        );
    }
  }

  public zoomOut(): void {
    if (this.zoom && this.svg) {
      this.svg
        .transition()
        .duration(300)
        .call(
          this.zoom.scaleBy as unknown as (
            transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
            k: number
          ) => void,
          0.83
        );
    }
  }

  public resetZoom(): void {
    if (this.zoom && this.svg) {
      this.svg
        .transition()
        .duration(500)
        .call(
          this.zoom.transform as unknown as (
            transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
            transform: d3.ZoomTransform
          ) => void,
          d3.zoomIdentity
        );
    }
  }

  public zoomToNode(nodeId: string, scale = 1.5): void {
    const node = this.internalNodes.find(n => n.id === nodeId);
    if (!node || !this.zoom || !this.svg) return;

    const container = this.erdContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const x = width / 2 - (node.x || 0) * scale;
    const y = height / 2 - (node.y || 0) * scale;

    this.svg
      .transition()
      .duration(this.mergedConfig.animationDuration)
      .call(
        this.zoom.transform as unknown as (
          transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
          transform: d3.ZoomTransform
        ) => void,
        d3.zoomIdentity.translate(x, y).scale(scale)
      );
  }

  public zoomToFit(padding = 50): void {
    if (!this.svg || !this.zoom || this.visibleNodes.length === 0) return;

    const container = this.erdContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    this.visibleNodes.forEach(node => {
      const halfWidth = node.width / 2;
      const halfHeight = node.height / 2;
      minX = Math.min(minX, (node.x || 0) - halfWidth);
      minY = Math.min(minY, (node.y || 0) - halfHeight);
      maxX = Math.max(maxX, (node.x || 0) + halfWidth);
      maxY = Math.max(maxY, (node.y || 0) + halfHeight);
    });

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

    const boundsWidth = maxX - minX + padding * 2;
    const boundsHeight = maxY - minY + padding * 2;

    if (boundsWidth <= 0 || boundsHeight <= 0) return;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scale = Math.min(width / boundsWidth, height / boundsHeight, this.mergedConfig.maxZoom);

    if (!isFinite(scale) || scale <= 0) return;

    const translateX = width / 2 - centerX * scale;
    const translateY = height / 2 - centerY * scale;

    this.svg
      .transition()
      .duration(this.mergedConfig.animationDuration)
      .call(
        this.zoom.transform as unknown as (
          transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
          transform: d3.ZoomTransform
        ) => void,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
      );
  }

  // Public API - Selection
  public selectNode(nodeId: string): boolean {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      this.nodeSelected.emit(node);
      return true;
    }
    return false;
  }

  public deselectAll(): void {
    this.nodeDeselected.emit();
    this.clearAllHighlighting();
  }

  // Public API - Highlighting
  public highlightNode(nodeId: string): void {
    if (!this.highlightedNodeIds.includes(nodeId)) {
      this.highlightedNodeIds = [...this.highlightedNodeIds, nodeId];
      this.updateHighlighting();
      this.emitStateChange();
    }
  }

  public clearHighlights(): void {
    this.highlightedNodeIds = [];
    this.updateHighlighting();
    this.emitStateChange();
  }

  public highlightRelated(nodeId: string, depth = 1): void {
    const relatedIds = this.getRelatedNodeIds(nodeId, depth);
    this.highlightedNodeIds = [nodeId, ...relatedIds];
    this.updateHighlighting();
    this.emitStateChange();
  }

  public getRelatedNodes(nodeId: string, depth = 1): ERDRelationshipInfo[] {
    const result: ERDRelationshipInfo[] = [];
    const visited = new Set<string>([nodeId]);
    const toProcess = [{ id: nodeId, currentDepth: 0 }];

    while (toProcess.length > 0) {
      const current = toProcess.shift()!;
      if (current.currentDepth >= depth) continue;

      this.nodes.forEach(node => {
        node.fields.forEach(field => {
          if (field.relatedNodeId) {
            if (node.id === current.id && !visited.has(field.relatedNodeId)) {
              const targetNode = this.nodes.find(n => n.id === field.relatedNodeId);
              if (targetNode) {
                visited.add(field.relatedNodeId);
                toProcess.push({ id: field.relatedNodeId, currentDepth: current.currentDepth + 1 });
                result.push({
                  node: targetNode,
                  link: {
                    sourceNodeId: node.id,
                    targetNodeId: field.relatedNodeId,
                    sourceField: field,
                    isSelfReference: node.id === field.relatedNodeId,
                  },
                  direction: 'outgoing',
                  field,
                });
              }
            }
            if (field.relatedNodeId === current.id && !visited.has(node.id)) {
              visited.add(node.id);
              toProcess.push({ id: node.id, currentDepth: current.currentDepth + 1 });
              result.push({
                node,
                link: {
                  sourceNodeId: node.id,
                  targetNodeId: field.relatedNodeId,
                  sourceField: field,
                  isSelfReference: node.id === field.relatedNodeId,
                },
                direction: 'incoming',
                field,
              });
            }
          }
        });
      });
    }

    return result;
  }

  // Public API - State Management
  public getState(): ERDState {
    const zoomState = this.getZoomState();
    const nodePositions: Record<
      string,
      { x: number; y: number; fx?: number | null; fy?: number | null }
    > = {};

    this.internalNodes.forEach(node => {
      nodePositions[node.id] = {
        x: node.x || 0,
        y: node.y || 0,
        fx: node.fx,
        fy: node.fy,
      };
    });

    return {
      selectedNodeId: this.selectedNodeId,
      highlightedNodeIds: [...this.highlightedNodeIds],
      zoomLevel: zoomState.zoomLevel,
      translateX: zoomState.translateX,
      translateY: zoomState.translateY,
      focusNodeId: this.focusNodeId,
      focusDepth: this.focusDepth,
      nodePositions,
    };
  }

  public setState(state: Partial<ERDState>, restorePositions = true): void {
    if (state.highlightedNodeIds) {
      this.highlightedNodeIds = [...state.highlightedNodeIds];
    }

    if (this.svg && this.zoom && state.zoomLevel != null) {
      this.svg.call(
        this.zoom.transform as unknown as (
          selection: d3.Selection<SVGSVGElement, unknown, null, undefined>,
          transform: d3.ZoomTransform
        ) => void,
        d3.zoomIdentity
          .translate(state.translateX || 0, state.translateY || 0)
          .scale(state.zoomLevel)
      );
    }

    if (restorePositions && state.nodePositions) {
      this.internalNodes.forEach(node => {
        const savedPos = state.nodePositions?.[node.id];
        if (savedPos) {
          node.x = savedPos.x;
          node.y = savedPos.y;
          node.fx = savedPos.fx;
          node.fy = savedPos.fy;
        }
      });

      if (this.simulation) {
        this.simulation.alpha(0.1).restart();
      }
    }

    this.updateSelectionHighlighting();
    this.updateHighlighting();
  }

  // Public API - Layout Control
  public freezeLayout(): void {
    this.isLayoutFrozen = true;
    if (this.simulation) {
      this.simulation.stop();
      this.internalNodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
      });
    }
  }

  public unfreezeLayout(): void {
    this.isLayoutFrozen = false;
    this.internalNodes.forEach(node => {
      node.fx = null;
      node.fy = null;
    });
    if (this.simulation) {
      this.simulation.alpha(0.3).restart();
    }
  }

  public centerDiagram(): void {
    if (!this.svg || !this.zoom || this.visibleNodes.length === 0) return;

    const container = this.erdContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    let sumX = 0,
      sumY = 0;
    this.visibleNodes.forEach(node => {
      sumX += node.x || 0;
      sumY += node.y || 0;
    });
    const centerX = sumX / this.visibleNodes.length;
    const centerY = sumY / this.visibleNodes.length;

    const currentTransform = d3.zoomTransform(this.svg.node()!);
    const translateX = width / 2 - centerX * currentTransform.k;
    const translateY = height / 2 - centerY * currentTransform.k;

    this.svg
      .transition()
      .duration(this.mergedConfig.animationDuration)
      .call(
        this.zoom.transform as unknown as (
          transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
          transform: d3.ZoomTransform
        ) => void,
        d3.zoomIdentity.translate(translateX, translateY).scale(currentTransform.k)
      );
  }

  // Public API - Utilities
  public refresh(): void {
    this.setupERD();
  }

  public triggerResize(): void {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    this.resizeTimeout = window.setTimeout(() => {
      this.resizeSVG();
    }, 100);
  }

  public getZoomState(): ERDZoomEvent {
    if (!this.svg) {
      return { zoomLevel: 1, translateX: 0, translateY: 0 };
    }
    const transform = d3.zoomTransform(this.svg.node()!);
    return {
      zoomLevel: transform.k,
      translateX: transform.x,
      translateY: transform.y,
    };
  }

  public exportAsSVG(): string {
    if (!this.svg) return '';

    const svgNode = this.svg.node();
    if (!svgNode) return '';

    const serializer = new XMLSerializer();
    return serializer.serializeToString(svgNode);
  }

  // Setup Methods
  private setupERD(): void {
    if (!this.erdContainer?.nativeElement) {
      return;
    }

    this.layoutCompleted = false;
    this.mergeConfig();
    this.clearVisualization();
    this.createInternalNodes();
    this.createInternalLinks();
    this.applyFocusMode();
    this.createVisualization();
  }

  private mergeConfig(): void {
    // Detect theme from CSS variables for theme-aware ERD colors
    const themeColors = this.detectThemeColors();

    this.mergedConfig = {
      ...DEFAULT_CONFIG,
      ...this.config,
      colors: {
        ...DEFAULT_CONFIG.colors,
        ...themeColors,
        ...this.config.colors,
      },
      dagreConfig: {
        ...DEFAULT_DAGRE_CONFIG,
        ...this.config.dagreConfig,
      },
    };

    if (this.mergedConfig.layoutAlgorithm === 'horizontal') {
      this.mergedConfig.dagreConfig.rankDir = 'LR';
    } else if (this.mergedConfig.layoutAlgorithm === 'vertical') {
      this.mergedConfig.dagreConfig.rankDir = 'TB';
    }
  }

  private detectThemeColors(): Partial<ERDConfig['colors']> {
    const style = getComputedStyle(document.documentElement);
    const bgPrimary = style.getPropertyValue('--bg-primary').trim();
    // If bg-primary is light (e.g. #fff or rgb near white), use light-mode ERD colors
    if (!bgPrimary) return {};
    const isLight = this.isLightColor(bgPrimary);
    if (isLight) {
      return {
        nodeBackground: '#ffffff',
        nodeBorder: '#ddd',
        nodeHeader: '#1565c0',
        nodeHeaderText: '#ffffff',
        linkColor: '#999',
        selectedBorder: '#1976d2',
      };
    }
    return {};
  }

  private isLightColor(color: string): boolean {
    // Parse hex or rgb and check luminance
    let r = 0, g = 0, b = 0;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length >= 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
    } else if (color.startsWith('rgb')) {
      const match = color.match(/(\d+)/g);
      if (match && match.length >= 3) {
        r = parseInt(match[0]);
        g = parseInt(match[1]);
        b = parseInt(match[2]);
      }
    }
    // Relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  private resizeSVG(): void {
    if (!this.svg || !this.erdContainer?.nativeElement) {
      return;
    }

    const container = this.erdContainer.nativeElement;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    if (
      Math.abs(this.lastKnownSize.width - width) < 5 &&
      Math.abs(this.lastKnownSize.height - height) < 5
    ) {
      return;
    }

    this.lastKnownSize = { width, height };

    const svgElement = this.svg.node();
    if (svgElement) {
      svgElement.style.width = '100%';
      svgElement.style.height = '100%';
    }

    this.svg.attr('viewBox', `0 0 ${width} ${height}`);

    if (this.simulation && !this.isLayoutFrozen) {
      this.simulation.force('center', d3.forceCenter(width / 2, height / 2));
      this.simulation.alpha(0.3).restart();
    }
  }

  private setupResizeObserver(): void {
    if (!this.erdContainer?.nativeElement) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      this.resizeTimeout = window.setTimeout(() => {
        const container = this.erdContainer?.nativeElement;
        if (!container) return;

        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;

        if (
          Math.abs(this.lastKnownSize.width - newWidth) >= 5 ||
          Math.abs(this.lastKnownSize.height - newHeight) >= 5
        ) {
          requestAnimationFrame(() => {
            this.resizeSVG();
          });
        }
      }, 50);
    });

    this.resizeObserver.observe(this.erdContainer.nativeElement);
  }

  private clearVisualization(): void {
    if (this.simulation) {
      this.simulation.stop();
    }
    d3.select(this.erdContainer.nativeElement).selectAll('*').remove();
  }

  // Focus Mode
  private applyFocusMode(): void {
    if (!this.focusNodeId) {
      this.visibleNodes = [...this.internalNodes];
      this.visibleLinks = [...this.internalLinks];
      return;
    }

    const visibleIds = new Set<string>([this.focusNodeId]);
    const relatedIds = this.getRelatedNodeIds(this.focusNodeId, this.focusDepth);
    relatedIds.forEach(id => visibleIds.add(id));

    this.visibleNodes = this.internalNodes.filter(n => visibleIds.has(n.id));

    this.visibleLinks = this.internalLinks.filter(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });
  }

  private getRelatedNodeIds(nodeId: string, depth: number): string[] {
    const visited = new Set<string>([nodeId]);
    const toProcess = [{ id: nodeId, currentDepth: 0 }];
    const result: string[] = [];

    while (toProcess.length > 0) {
      const current = toProcess.shift()!;
      if (current.currentDepth >= depth) continue;

      this.nodes.forEach(node => {
        node.fields.forEach(field => {
          if (field.relatedNodeId) {
            if (node.id === current.id && !visited.has(field.relatedNodeId)) {
              visited.add(field.relatedNodeId);
              result.push(field.relatedNodeId);
              toProcess.push({ id: field.relatedNodeId, currentDepth: current.currentDepth + 1 });
            }
            if (field.relatedNodeId === current.id && !visited.has(node.id)) {
              visited.add(node.id);
              result.push(node.id);
              toProcess.push({ id: node.id, currentDepth: current.currentDepth + 1 });
            }
          }
        });
      });
    }

    return result;
  }

  // Node/Link Creation
  private createInternalNodes(): void {
    const cfg = this.mergedConfig;

    this.internalNodes = this.nodes.map(node => {
      const primaryKeys = node.fields.filter(f => f.isPrimaryKey);
      const foreignKeys = node.fields.filter(f => f.relatedNodeId && !f.isPrimaryKey);

      const fieldCount = Math.max(1, primaryKeys.length + foreignKeys.length);
      const calculatedHeight = Math.min(
        cfg.nodeBaseHeight + fieldCount * cfg.fieldHeight,
        cfg.maxNodeHeight
      );

      return {
        id: node.id,
        name: node.name || node.schemaName || 'Unknown',
        node,
        width: cfg.nodeWidth,
        height: calculatedHeight,
        primaryKeys,
        foreignKeys,
      };
    });
  }

  private createInternalLinks(): void {
    this.internalLinks = [];
    const nodeMap = new Map(this.internalNodes.map(n => [n.id, n]));

    this.nodes.forEach(node => {
      node.fields.forEach(field => {
        if (field.relatedNodeId && !field.isPrimaryKey) {
          const sourceNode = nodeMap.get(node.id);
          const targetNode = nodeMap.get(field.relatedNodeId);

          if (sourceNode && targetNode) {
            const isSelfReference = node.id === field.relatedNodeId;
            const targetField = targetNode.primaryKeys.find(
              pk => pk.name === field.relatedFieldName
            );

            this.internalLinks.push({
              source: sourceNode,
              target: targetNode,
              sourceField: field,
              targetField,
              isSelfReference,
            });
          }
        }
      });
    });
  }

  // Hierarchical Layout (replaces dagre which has browser compatibility issues)
  private applyHierarchicalLayout(): void {
    const cfg = this.mergedConfig;
    const dagreCfg = cfg.dagreConfig as Required<ERDDagreConfig>;
    const isHorizontal = dagreCfg.rankDir === 'LR' || dagreCfg.rankDir === 'RL';

    // Build adjacency map for topological sorting
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();

    this.visibleNodes.forEach(node => {
      outgoing.set(node.id, new Set());
      incoming.set(node.id, new Set());
    });

    this.visibleLinks.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (sourceId !== targetId) {
        // Skip self-references
        outgoing.get(sourceId)?.add(targetId);
        incoming.get(targetId)?.add(sourceId);
      }
    });

    // Assign ranks using BFS from root nodes (nodes with no incoming edges)
    const ranks = new Map<string, number>();
    const queue: string[] = [];

    this.visibleNodes.forEach(node => {
      if ((incoming.get(node.id)?.size || 0) === 0) {
        ranks.set(node.id, 0);
        queue.push(node.id);
      }
    });

    // If no root nodes found, start from first node
    if (queue.length === 0 && this.visibleNodes.length > 0) {
      ranks.set(this.visibleNodes[0].id, 0);
      queue.push(this.visibleNodes[0].id);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const nodeRank = ranks.get(nodeId) || 0;

      outgoing.get(nodeId)?.forEach(targetId => {
        const currentRank = ranks.get(targetId);
        const newRank = nodeRank + 1;
        if (currentRank === undefined || newRank > currentRank) {
          ranks.set(targetId, newRank);
        }
        if (!queue.includes(targetId)) {
          queue.push(targetId);
        }
      });
    }

    // Assign rank 0 to any unvisited nodes
    this.visibleNodes.forEach(node => {
      if (!ranks.has(node.id)) {
        ranks.set(node.id, 0);
      }
    });

    // Group nodes by rank
    const rankGroups = new Map<number, InternalNode[]>();
    this.visibleNodes.forEach(node => {
      const rank = ranks.get(node.id) || 0;
      if (!rankGroups.has(rank)) {
        rankGroups.set(rank, []);
      }
      rankGroups.get(rank)!.push(node);
    });

    // Position nodes
    const nodeSep = dagreCfg.nodeSep;
    const rankSep = dagreCfg.rankSep;
    const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);

    let currentRankPos = 50; // Starting position

    sortedRanks.forEach(rank => {
      const nodesInRank = rankGroups.get(rank) || [];
      let currentNodePos = 50;

      nodesInRank.forEach(node => {
        if (isHorizontal) {
          node.x = currentRankPos + node.width / 2;
          node.y = currentNodePos + node.height / 2;
          currentNodePos += node.height + nodeSep;
        } else {
          node.x = currentNodePos + node.width / 2;
          node.y = currentRankPos + node.height / 2;
          currentNodePos += node.width + nodeSep;
        }
        node.fx = node.x;
        node.fy = node.y;
      });

      // Move to next rank
      if (isHorizontal) {
        const maxWidth = Math.max(...nodesInRank.map(n => n.width));
        currentRankPos += maxWidth + rankSep;
      } else {
        const maxHeight = Math.max(...nodesInRank.map(n => n.height));
        currentRankPos += maxHeight + rankSep;
      }
    });
  }

  private usesHierarchicalLayout(): boolean {
    const algo = this.mergedConfig.layoutAlgorithm;
    return algo === 'dagre' || algo === 'horizontal' || algo === 'vertical';
  }

  // Visualization
  private createVisualization(): void {
    const container = this.erdContainer.nativeElement;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const cfg = this.mergedConfig;
    const colors = cfg.colors as Required<ERDColorScheme>;

    this.lastKnownSize = { width, height };

    if (cfg.enableZoom) {
      this.zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([cfg.minZoom, cfg.maxZoom])
        .on('zoom', event => {
          if (this.svg) {
            this.svg.select('.chart-area').attr('transform', event.transform);
            this.zoomChange.emit({
              zoomLevel: event.transform.k,
              translateX: event.transform.x,
              translateY: event.transform.y,
            });
          }
        });
    }

    this.svg = d3
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('width', '100%')
      .style('height', '100%')
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0');

    if (this.zoom) {
      this.svg.call(this.zoom);
    }

    this.svg.on('click', (event: MouseEvent) => {
      if (event.target === event.currentTarget) {
        this.nodeDeselected.emit();
        this.clearAllHighlighting();
      }
    });

    this.svg.on('contextmenu', (event: MouseEvent) => {
      if (event.target === event.currentTarget) {
        const contextEvent: ERDDiagramContextMenuEvent = {
          mouseEvent: event,
          cancel: false,
          position: { x: event.clientX, y: event.clientY },
          diagramPosition: this.screenToDiagramCoords(event.clientX, event.clientY),
        };
        this.diagramContextMenu.emit(contextEvent);
        if (contextEvent.cancel) {
          event.preventDefault();
        }
      }
    });

    const chartArea = this.svg.append('g').attr('class', 'chart-area');

    this.svg
      .append('defs')
      .selectAll('marker')
      .data(['end-arrow'])
      .enter()
      .append('marker')
      .attr('id', 'end-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', colors.linkColor);

    if (this.usesHierarchicalLayout()) {
      this.applyHierarchicalLayout();
      this.simulation = null;
    } else {
      this.simulation = d3
        .forceSimulation<InternalNode>(this.visibleNodes)
        .force(
          'link',
          d3
            .forceLink<InternalNode, InternalLink>(this.visibleLinks)
            .id(d => d.id)
            .distance(d => {
              const source = d.source as InternalNode;
              const target = d.target as InternalNode;
              const sourceSize = Math.max(source.width, source.height);
              const targetSize = Math.max(target.width, target.height);
              return (sourceSize + targetSize) / 2 + cfg.linkDistance;
            })
        )
        .force('charge', d3.forceManyBody().strength(cfg.chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force(
          'collision',
          d3.forceCollide<InternalNode>().radius(d => {
            return Math.max(d.width, d.height) / 2 + cfg.collisionPadding;
          })
        );
    }

    const link = chartArea
      .selectAll('.link')
      .data(this.visibleLinks)
      .enter()
      .append('g')
      .attr('class', 'link-group');

    link
      .append('path')
      .attr('class', 'link')
      .attr('stroke', colors.linkColor)
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', 2)
      .attr('fill', 'none')
      .attr('marker-end', d => (d.isSelfReference ? 'none' : 'url(#end-arrow)'));

    if (cfg.showRelationshipLabels) {
      link
        .append('rect')
        .attr('class', 'link-label-bg')
        .attr('fill', d => (d.isSelfReference ? '#e8f5e9' : colors.nodeBackground))
        .attr('stroke', d => (d.isSelfReference ? '#4CAF50' : colors.linkColor))
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', d => (d.isSelfReference ? 0.6 : 0.4))
        .attr('rx', 2)
        .attr('ry', 2);

      link
        .append('text')
        .attr('class', 'link-label')
        .attr('font-size', '10px')
        .attr('fill', d => (d.isSelfReference ? '#2e7d32' : colors.linkColor))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(d => d.sourceField.name || '');
    }

    this.attachLinkEventHandlers(link);

    const nodeGroup = chartArea
      .selectAll('.node')
      .data(this.visibleNodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', this.readOnly ? 'default' : 'pointer');

    if (cfg.enableDragging && !this.readOnly) {
      nodeGroup.call(
        d3
          .drag<SVGGElement, InternalNode>()
          .on('start', (event, d) => this.dragstarted(event, d))
          .on('drag', (event, d) => this.dragged(event, d))
          .on('end', (event, d) => this.dragended(event, d))
      );
    }

    nodeGroup
      .append('rect')
      .attr('class', 'entity-rect')
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('x', d => -d.width / 2)
      .attr('y', d => -d.height / 2)
      .attr('fill', colors.nodeBackground)
      .attr('stroke', colors.nodeBorder)
      .attr('stroke-width', 2)
      .attr('rx', 4);

    nodeGroup
      .append('rect')
      .attr('class', 'entity-header')
      .attr('width', d => d.width)
      .attr('height', 30)
      .attr('x', d => -d.width / 2)
      .attr('y', d => -d.height / 2)
      .attr('fill', colors.nodeHeader)
      .attr('rx', 4);

    nodeGroup
      .append('rect')
      .attr('class', 'entity-header-bottom')
      .attr('width', d => d.width)
      .attr('height', 15)
      .attr('x', d => -d.width / 2)
      .attr('y', d => -d.height / 2 + 15)
      .attr('fill', colors.nodeHeader);

    nodeGroup
      .append('text')
      .attr('class', 'entity-name')
      .attr('text-anchor', 'middle')
      .attr('y', d => -d.height / 2 + 20)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', colors.nodeHeaderText)
      .text(d => d.name);

    if (cfg.showFieldDetails) {
      this.renderNodeFields(nodeGroup, colors);
    }

    this.attachNodeEventHandlers(nodeGroup);

    nodeGroup
      .append('title')
      .text(
        d =>
          `${d.name}\nPrimary Keys: ${d.primaryKeys.length}\nForeign Keys: ${d.foreignKeys.length}`
      );

    if (this.usesHierarchicalLayout()) {
      this.updatePositions(link, nodeGroup);
      this.layoutCompleted = true;
      this.layoutComplete.emit();

      if (cfg.fitOnLoad && this.visibleNodes.length > 1) {
        setTimeout(() => this.zoomToFit(), 50);
      }
    } else if (this.simulation) {
      if (cfg.skipAnimation) {
        this.simulation.stop();

        const tickCount = 300;
        for (let i = 0; i < tickCount; i++) {
          this.simulation.tick();
        }

        this.updatePositions(link, nodeGroup);
        this.layoutCompleted = true;
        this.layoutComplete.emit();

        if (cfg.fitOnLoad && this.visibleNodes.length > 1) {
          setTimeout(() => this.zoomToFit(), 50);
        }
      } else {
        this.simulation.on('tick', () => {
          this.updatePositions(link, nodeGroup);
        });

        this.simulation.on('end', () => {
          if (!this.layoutCompleted) {
            this.layoutCompleted = true;
            this.layoutComplete.emit();
            if (cfg.fitOnLoad && this.visibleNodes.length > 1) {
              setTimeout(() => this.zoomToFit(), 100);
            }
          }
        });
      }
    }

    this.updateSelectionHighlighting();
    this.updateHighlighting();
  }

  private renderNodeFields(
    nodeGroup: d3.Selection<SVGGElement, InternalNode, SVGGElement, unknown>,
    colors: Required<ERDColorScheme>
  ): void {
    nodeGroup.each((d, i, nodes) => {
      const group = d3.select(nodes[i]);
      let currentY = -d.height / 2 + 40;

      d.primaryKeys.forEach(pk => {
        const fieldGroup = group.append('g').attr('class', 'field-group primary-key');

        fieldGroup
          .append('rect')
          .attr('class', 'field-bg')
          .attr('x', -d.width / 2 + 2)
          .attr('y', currentY - 15)
          .attr('width', d.width - 4)
          .attr('height', 18)
          .attr('fill', colors.primaryKeyBackground);

        fieldGroup
          .append('text')
          .attr('class', 'field-icon')
          .attr('x', -d.width / 2 + 8)
          .attr('y', currentY - 2)
          .attr('font-size', '10px')
          .attr('fill', colors.primaryKeyText)
          .text('PK');

        fieldGroup
          .append('text')
          .attr('class', 'field-name')
          .attr('x', -d.width / 2 + 30)
          .attr('y', currentY - 2)
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .attr('fill', colors.primaryKeyText)
          .text(pk.name || '');

        currentY += 20;
      });

      d.foreignKeys.forEach(fk => {
        const fieldGroup = group.append('g').attr('class', 'field-group foreign-key');

        fieldGroup
          .append('rect')
          .attr('class', 'field-bg')
          .attr('x', -d.width / 2 + 2)
          .attr('y', currentY - 15)
          .attr('width', d.width - 4)
          .attr('height', 18)
          .attr('fill', colors.foreignKeyBackground);

        fieldGroup
          .append('text')
          .attr('class', 'field-icon')
          .attr('x', -d.width / 2 + 8)
          .attr('y', currentY - 2)
          .attr('font-size', '10px')
          .attr('fill', colors.foreignKeyText)
          .text('FK');

        fieldGroup
          .append('text')
          .attr('class', 'field-name')
          .attr('x', -d.width / 2 + 30)
          .attr('y', currentY - 2)
          .attr('font-size', '11px')
          .attr('fill', colors.foreignKeyText)
          .text(fk.name || '');

        currentY += 20;
      });
    });
  }

  private attachNodeEventHandlers(
    nodeGroup: d3.Selection<SVGGElement, InternalNode, SVGGElement, unknown>
  ): void {
    nodeGroup
      .on('click', (event: MouseEvent, d: InternalNode) => {
        if (this.readOnly) return;
        event.stopPropagation();

        const clickEvent: ERDNodeClickEvent = {
          node: d.node,
          mouseEvent: event,
          cancel: false,
        };
        this.nodeClick.emit(clickEvent);

        if (clickEvent.cancel) {
          return;
        }

        if (this.selectedNodeId === d.node.id) {
          this.nodeDeselected.emit();
        } else {
          this.nodeSelected.emit(d.node);

          if (this.svg) {
            const currentTransform = d3.zoomTransform(this.svg.node()!);
            const currentRenderedWidth = d.width * currentTransform.k;
            if (currentRenderedWidth < 20) {
              this.zoomToNode(d.node.id);
            }
          }
        }

        this.updateSelectionHighlighting();
      })
      .on('dblclick', (event: MouseEvent, d: InternalNode) => {
        event.stopPropagation();

        const dblClickEvent: ERDNodeDoubleClickEvent = {
          node: d.node,
          mouseEvent: event,
          cancel: false,
        };
        this.nodeDoubleClick.emit(dblClickEvent);
      })
      .on('mouseenter', (event: MouseEvent, d: InternalNode) => {
        const relatedInfo = this.getRelatedNodes(d.node.id, 1);
        const relatedNodes = relatedInfo.map(r => r.node);

        const hoverEvent: ERDNodeHoverEvent = {
          node: d.node,
          mouseEvent: event,
          relatedNodes,
          position: { x: event.clientX, y: event.clientY },
        };
        this.nodeHover.emit(hoverEvent);
      })
      .on('mouseleave', (_event: MouseEvent, d: InternalNode) => {
        this.nodeHoverEnd.emit(d.node);
      })
      .on('contextmenu', (event: MouseEvent, d: InternalNode) => {
        const contextEvent: ERDNodeContextMenuEvent = {
          node: d.node,
          mouseEvent: event,
          cancel: false,
          position: { x: event.clientX, y: event.clientY },
        };
        this.nodeContextMenu.emit(contextEvent);

        if (contextEvent.cancel) {
          event.preventDefault();
        }
      });
  }

  private attachLinkEventHandlers(
    linkGroup: d3.Selection<SVGGElement, InternalLink, SVGGElement, unknown>
  ): void {
    linkGroup
      .on('click', (event: MouseEvent, d: InternalLink) => {
        event.stopPropagation();

        const sourceNode = (d.source as InternalNode).node;
        const targetNode = (d.target as InternalNode).node;

        const link: ERDLink = {
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          sourceField: d.sourceField,
          targetField: d.targetField,
          isSelfReference: d.isSelfReference,
        };

        const clickEvent: ERDLinkClickEvent = {
          link,
          sourceNode,
          targetNode,
          mouseEvent: event,
          cancel: false,
        };
        this.linkClick.emit(clickEvent);
      })
      .on('mouseenter', (event: MouseEvent, d: InternalLink) => {
        const sourceNode = (d.source as InternalNode).node;
        const targetNode = (d.target as InternalNode).node;

        const link: ERDLink = {
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          sourceField: d.sourceField,
          targetField: d.targetField,
          isSelfReference: d.isSelfReference,
        };

        const hoverEvent: ERDLinkHoverEvent = {
          link,
          sourceNode,
          targetNode,
          mouseEvent: event,
          position: { x: event.clientX, y: event.clientY },
        };
        this.linkHover.emit(hoverEvent);
      })
      .on('mouseleave', (_event: MouseEvent, d: InternalLink) => {
        const sourceNode = (d.source as InternalNode).node;
        const targetNode = (d.target as InternalNode).node;

        const link: ERDLink = {
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          sourceField: d.sourceField,
          targetField: d.targetField,
          isSelfReference: d.isSelfReference,
        };
        this.linkHoverEnd.emit(link);
      })
      .on('contextmenu', (event: MouseEvent, d: InternalLink) => {
        const sourceNode = (d.source as InternalNode).node;
        const targetNode = (d.target as InternalNode).node;

        const link: ERDLink = {
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          sourceField: d.sourceField,
          targetField: d.targetField,
          isSelfReference: d.isSelfReference,
        };

        const contextEvent: ERDLinkContextMenuEvent = {
          link,
          sourceNode,
          targetNode,
          mouseEvent: event,
          cancel: false,
          position: { x: event.clientX, y: event.clientY },
        };
        this.linkContextMenu.emit(contextEvent);

        if (contextEvent.cancel) {
          event.preventDefault();
        }
      });
  }

  private updatePositions(
    link: d3.Selection<SVGGElement, InternalLink, SVGGElement, unknown>,
    nodeGroup: d3.Selection<SVGGElement, InternalNode, SVGGElement, unknown>
  ): void {
    const usesDagre = this.usesHierarchicalLayout();

    link.select('path').attr('d', d => {
      const source = d.source as InternalNode;
      const target = d.target as InternalNode;

      if (d.isSelfReference) {
        const startX = source.x! + source.width / 2;
        const startY = source.y!;
        const endY = source.y! + source.height / 2;
        const loopExtent = 60;

        return `M ${startX} ${startY}
                C ${startX + loopExtent} ${startY},
                  ${startX + loopExtent} ${endY + loopExtent},
                  ${source.x!} ${endY + loopExtent}
                C ${source.x! - loopExtent} ${endY + loopExtent},
                  ${source.x! - source.width / 2 - loopExtent / 2} ${endY},
                  ${source.x! - source.width / 2} ${endY}`;
      }

      if (usesDagre && d.points && d.points.length >= 2) {
        return this.createPathFromDagrePoints(d.points);
      }

      const sourcePoint = this.getSourceConnectionPoint(source, d.sourceField);
      const targetPoint = this.getTargetConnectionPoint(target, d.targetField);
      return this.createOrthogonalPath(sourcePoint, targetPoint);
    });

    link.select('text').attr('transform', d => {
      const source = d.source as InternalNode;
      const target = d.target as InternalNode;

      if (d.isSelfReference) {
        const loopExtent = 60;
        return `translate(${source.x!}, ${source.y! + source.height / 2 + loopExtent + 8})`;
      }

      if (usesDagre && d.points && d.points.length >= 2) {
        const midIndex = Math.floor(d.points.length / 2);
        const midPoint = d.points[midIndex];
        return `translate(${midPoint.x}, ${midPoint.y})`;
      }

      const midX = (source.x! + target.x!) / 2;
      const midY = (source.y! + target.y!) / 2;
      return `translate(${midX}, ${midY - 8})`;
    });

    link.each(function () {
      const group = d3.select(this);
      const textEl = group.select('text.link-label').node() as SVGTextElement | null;
      const bgRect = group.select('rect.link-label-bg');

      if (textEl && !bgRect.empty()) {
        const bbox = textEl.getBBox();
        const padding = 3;

        const transform = group.select('text.link-label').attr('transform');

        bgRect
          .attr('x', bbox.x - padding)
          .attr('y', bbox.y - padding)
          .attr('width', bbox.width + padding * 2)
          .attr('height', bbox.height + padding * 2)
          .attr('transform', transform);
      }
    });

    nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`);
  }

  // Geometry Helpers
  private getSourceConnectionPoint(
    sourceNode: InternalNode,
    field?: ERDField
  ): { x: number; y: number } {
    let connectY = sourceNode.y!;

    if (field) {
      const fkIndex = sourceNode.foreignKeys.findIndex(fk => fk.id === field.id);
      if (fkIndex >= 0) {
        const fieldY =
          -sourceNode.height / 2 + 40 + sourceNode.primaryKeys.length * 20 + fkIndex * 20;
        connectY = sourceNode.y! + fieldY + 10;
      }
    }

    return {
      x: sourceNode.x! + sourceNode.width / 2,
      y: connectY,
    };
  }

  private getTargetConnectionPoint(
    targetNode: InternalNode,
    targetField?: ERDField
  ): { x: number; y: number } {
    let connectY = targetNode.y! - targetNode.height / 2 + 40;

    if (targetField && targetField.isPrimaryKey) {
      const pkIndex = targetNode.primaryKeys.findIndex(pk => pk.id === targetField.id);
      if (pkIndex >= 0) {
        const fieldY = -targetNode.height / 2 + 40 + pkIndex * 20;
        connectY = targetNode.y! + fieldY + 10;
      }
    }

    return {
      x: targetNode.x! - targetNode.width / 2,
      y: connectY,
    };
  }

  private createOrthogonalPath(
    source: { x: number; y: number },
    target: { x: number; y: number }
  ): string {
    const dx = target.x - source.x;
    let midX: number;

    if (dx > 0) {
      midX = source.x + dx * 0.7;
    } else {
      midX = source.x + Math.max(dx * 0.3, -50);
    }

    return `M ${source.x} ${source.y}
            L ${midX} ${source.y}
            L ${midX} ${target.y}
            L ${target.x} ${target.y}`;
  }

  private createPathFromDagrePoints(points: Array<{ x: number; y: number }>): string {
    if (!points || points.length < 2) {
      return '';
    }

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }

    return path;
  }

  private screenToDiagramCoords(screenX: number, screenY: number): { x: number; y: number } {
    if (!this.svg) return { x: 0, y: 0 };

    const svgNode = this.svg.node();
    if (!svgNode) return { x: 0, y: 0 };

    const rect = svgNode.getBoundingClientRect();
    const transform = d3.zoomTransform(svgNode);

    return {
      x: (screenX - rect.left - transform.x) / transform.k,
      y: (screenY - rect.top - transform.y) / transform.k,
    };
  }

  // Highlighting
  private clearAllHighlighting(): void {
    if (!this.svg) return;

    this.svg
      .selectAll('.node')
      .classed('selected', false)
      .classed('highlighted', false)
      .classed('relationship-connected', false)
      .classed('entity-connections-highlighted', false);

    this.svg
      .selectAll('.entity-rect')
      .classed('highlighted', false)
      .classed('relationship-highlighted', false)
      .classed('connection-highlighted', false)
      .style('stroke', this.mergedConfig.colors?.nodeBorder || '#3c3c3c')
      .style('stroke-width', '2px')
      .style('filter', null);

    this.svg.selectAll('.link-group').classed('highlighted', false);

    this.svg.selectAll('.link').classed('highlighted', false);

    this.svg.selectAll('.link-label').classed('highlighted', false);
  }

  private updateSelectionHighlighting(): void {
    if (!this.svg) return;

    this.svg
      .selectAll('.node')
      .classed('selected', false)
      .select('.entity-rect')
      .style('stroke', this.mergedConfig.colors?.nodeBorder || '#3c3c3c')
      .style('stroke-width', '2px')
      .style('filter', null);

    if (this.selectedNodeId) {
      const selectedColor = this.mergedConfig.colors?.selectedBorder || '#2196f3';

      this.svg
        .selectAll('.node')
        .filter((d: unknown) => (d as InternalNode).id === this.selectedNodeId)
        .classed('selected', true)
        .select('.entity-rect')
        .style('stroke', selectedColor)
        .style('stroke-width', '4px')
        .style('filter', `drop-shadow(0 0 8px ${selectedColor}80)`);
    }
  }

  private updateHighlighting(): void {
    if (!this.svg) return;

    const highlightColor = this.mergedConfig.colors?.highlightBorder || '#ff9800';
    const highlightSet = new Set(this.highlightedNodeIds);

    this.svg
      .selectAll('.node')
      .classed('highlighted', (d: unknown) => highlightSet.has((d as InternalNode).id))
      .filter((d: unknown) => highlightSet.has((d as InternalNode).id))
      .select('.entity-rect')
      .style('stroke', highlightColor)
      .style('stroke-width', '3px')
      .style('filter', `drop-shadow(0 0 6px ${highlightColor}80)`);
  }

  private emitStateChange(): void {
    const state = this.getState();
    this.stateChange.emit(state);
  }

  // Drag Handlers
  private dragstarted(
    event: d3.D3DragEvent<SVGGElement, InternalNode, InternalNode>,
    d: InternalNode
  ): void {
    if (this.isLayoutFrozen) return;

    const dragEvent: ERDNodeDragEvent = {
      node: d.node,
      startPosition: { x: d.x || 0, y: d.y || 0 },
      currentPosition: { x: d.x || 0, y: d.y || 0 },
      cancel: false,
    };
    this.nodeDragStart.emit(dragEvent);

    if (dragEvent.cancel) return;

    if (!event.active && this.simulation) {
      this.simulation.alphaTarget(0.3).restart();
    }
    d.fx = d.x;
    d.fy = d.y;
  }

  private dragged(
    event: d3.D3DragEvent<SVGGElement, InternalNode, InternalNode>,
    d: InternalNode
  ): void {
    if (this.isLayoutFrozen) return;

    d.fx = event.x;
    d.fy = event.y;
  }

  private dragended(
    event: d3.D3DragEvent<SVGGElement, InternalNode, InternalNode>,
    d: InternalNode
  ): void {
    if (this.isLayoutFrozen) return;

    const dragEvent: ERDNodeDragEvent = {
      node: d.node,
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: d.x || 0, y: d.y || 0 },
      cancel: false,
    };
    this.nodeDragEnd.emit(dragEvent);

    if (!event.active && this.simulation) {
      this.simulation.alphaTarget(0);
    }
    d.fx = null;
    d.fy = null;
  }
}
