/**
 * The Task 6 gate artifact: every primitive, in every state that has one, in whichever theme
 * is applied.
 *
 * Dev-only and deliberately the only consumer of `src/ui` in this task — no feature surface
 * exists yet, so this page is what proves the set works, and it is what the both-theme
 * screenshots in the SDD workspace are taken from.
 *
 * Overlays are rendered closed, with `data-testid`s on their triggers, because a portalled
 * overlay in a full-page screenshot lands wherever the initial viewport was rather than next
 * to its trigger. The gate script opens each one and captures it separately.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Braces,
  Columns3,
  Copy,
  Database,
  FileText,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Server,
  Table2,
  Trash2,
} from 'lucide-react';

import { Markdown } from '../markdown';
import { notify } from '../state/diagnostics';
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  installToastNotifier,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toaster,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
  TooltipProvider,
  Tree,
  type TreeNode,
} from '../ui';
import { Eyebrow, Section } from './preview-parts';
import { selectEffectiveTheme, useSettingsStore } from '../state/settings';
import { ThemeSwitch } from './theme-switch';

const MARKDOWN_SAMPLE = [
  '## Verify before anything changes',
  '',
  'A `SELECT` runs against the **live** connection. Read [the docs](https://example.com/joinery)',
  'before enabling write mode.',
  '',
  '```sql',
  '-- row counts without touching the tables themselves',
  'SELECT t.name, SUM(p.rows) AS row_count',
  'FROM sys.tables AS t',
  'JOIN sys.partitions AS p ON p.object_id = t.object_id',
  "WHERE p.index_id IN (0, 1) AND t.name LIKE 'dim_%'",
  'GROUP BY t.name;',
  '```',
  '',
  '| Engine     | Backup      | Restore     |',
  '| ---------- | ----------- | ----------- |',
  '| SQL Server | native      | native      |',
  '| PostgreSQL | pg_dump     | pg_restore  |',
  '| MySQL      | mysqldump   | mysql       |',
  '',
  '- [x] Dialect resolved',
  '- [ ] Credentials in Keychain',
  '',
  '> Rules separate surfaces. Shadows are for true overlays.',
].join('\n');

const TREE_NODES: readonly TreeNode[] = [
  {
    id: 'server',
    label: 'localhost:1433',
    icon: Server,
    hasChildren: true,
    children: [
      {
        id: 'db-analytics',
        label: 'analytics',
        icon: Database,
        hasChildren: true,
        children: [
          {
            id: 'schema-dbo',
            label: 'dbo',
            icon: Braces,
            hasChildren: true,
            children: [
              { id: 'table-dim-customer', label: 'dim_customer', icon: Table2, meta: '18.4k' },
              { id: 'table-fact-order', label: 'fact_order', icon: Table2, meta: '2.1m' },
              { id: 'table-stg-import', label: 'stg_import_2019_archive', icon: Table2, meta: '0' },
              { id: 'view-order-summary', label: 'vw_order_summary', icon: Columns3 },
            ],
          },
          // Expandable, children not fetched: the lazy case, and the one `loadingIds` marks.
          { id: 'schema-staging', label: 'staging', icon: Braces, hasChildren: true },
        ],
      },
      {
        id: 'db-locked',
        label: 'restricted_db',
        icon: Database,
        hasChildren: true,
        disabled: true,
      },
    ],
  },
];

function ButtonMatrix() {
  const variants = ['primary', 'outline', 'ghost', 'danger'] as const;
  return (
    <div className="flex flex-col gap-4">
      {(['md', 'sm'] as const).map(size => (
        <div key={size} className="flex flex-col gap-2">
          <Eyebrow>{`size ${size} · ${size === 'md' ? '34px' : '28px'}`}</Eyebrow>
          <div className="flex flex-wrap items-center gap-3">
            {variants.map(variant => (
              <Button
                key={variant}
                variant={variant}
                size={size}
                data-testid={`btn-${variant}-${size}`}
              >
                {variant[0]?.toUpperCase()}
                {variant.slice(1)}
              </Button>
            ))}
            {variants.map(variant => (
              <Button key={`${variant}-disabled`} variant={variant} size={size} disabled>
                Disabled
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size={size} leadingIcon={Play}>
              Execute
            </Button>
            <Button variant="outline" size={size} trailingIcon={Copy}>
              Copy SQL
            </Button>
            <Button
              variant="ghost"
              size={size}
              iconOnly
              leadingIcon={RefreshCw}
              aria-label="Refresh"
            />
            <Button
              variant="outline"
              size={size}
              iconOnly
              leadingIcon={Search}
              aria-label="Search"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FormControls() {
  const [engine, setEngine] = useState('postgres');
  const [writeMode, setWriteMode] = useState(false);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Input label="Host" name="host" defaultValue="localhost" data-testid="field-host" />
          <Input
            label="Port"
            name="port"
            type="number"
            defaultValue={5432}
            hint="Leave blank to use the engine default."
          />
          <Input
            label="Password"
            name="password"
            type="password"
            defaultValue="hunter2"
            error="Stored in plain text by a previous version. Re-enter to move it to the Keychain."
            data-testid="field-password"
          />
          <Input label="Disabled" name="disabled" defaultValue="unavailable" disabled />
        </div>
        <div className="flex flex-col gap-4">
          <Select
            label="Engine"
            name="engine"
            value={engine}
            onValueChange={setEngine}
            placeholder="Choose an engine"
            data-testid="field-engine"
          >
            <SelectItem value="mssql">SQL Server</SelectItem>
            <SelectItem value="postgres">PostgreSQL</SelectItem>
            <SelectItem value="mysql">MySQL</SelectItem>
          </Select>
          <Textarea
            label="Connection string"
            name="connectionString"
            defaultValue="postgres://localhost:5432/analytics?sslmode=require"
            hint="Overrides the fields on the left."
          />
          <div className="flex flex-col gap-3">
            <Checkbox label="Remember this connection" name="remember" defaultChecked />
            <Checkbox label="Trust server certificate" name="trustCert" />
            <Checkbox
              label="Some schemas selected"
              name="partial"
              indeterminate
              hint="Mixed state — three of eleven schemas."
            />
            <Checkbox label="Unavailable" name="unavailable" disabled />
            <Switch
              label="Write mode"
              name="writeMode"
              checked={writeMode}
              onChange={event => setWriteMode(event.target.checked)}
              hint="Allows UPDATE and DELETE from the query editor."
              data-testid="field-write-mode"
            />
            <Switch label="Locked by policy" name="locked" disabled />
          </div>
        </div>
      </div>
    </div>
  );
}

function Overlays() {
  const [notifications, setNotifications] = useState(true);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button data-testid="open-dialog-md">Dialog (md)</Button>
        </DialogTrigger>
        <DialogContent size="md" data-testid="dialog-md">
          <DialogHeader>
            <DialogTitle>Restore database</DialogTitle>
            <DialogDescription>
              Restoring overwrites every table in the target database. It cannot be undone from
              here.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Input label="Backup file" name="backupFile" defaultValue="analytics-2026-08-14.bak" />
            <Select label="Target database" name="target" defaultValue="analytics">
              <SelectItem value="analytics">analytics</SelectItem>
              <SelectItem value="analytics_restore">analytics_restore</SelectItem>
            </Select>
            <Checkbox label="Overwrite the existing database" name="overwrite" />
            <Spinner size="sm" label="Reading backup header…" />
          </DialogBody>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            {/* The one filled oxide affordance this surface is allowed. */}
            <Button variant="primary" data-testid="dialog-confirm">
              Restore
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button data-testid="open-dialog-sm">Dialog (sm)</Button>
        </DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
          </DialogHeader>
          <DialogBody>This query tab has unsaved edits.</DialogBody>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost">Keep editing</Button>
            </DialogClose>
            <Button variant="danger">Discard</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="open-dropdown">Dropdown menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="dropdown-content">
          <DropdownMenuLabel>fact_order</DropdownMenuLabel>
          <DropdownMenuItem icon={Table2} shortcut="⌘↵">
            Select top 1000
          </DropdownMenuItem>
          <DropdownMenuItem icon={Pencil}>Edit data</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={Copy}>Copy as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>CREATE statement</DropdownMenuItem>
              <DropdownMenuItem>INSERT statements</DropdownMenuItem>
              <DropdownMenuItem>CSV</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={notifications}
            onCheckedChange={setNotifications}
            shortcut="⌘⇧N"
          >
            Notify on completion
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={Trash2} disabled>
            Drop table (read-only connection)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button data-testid="open-popover">Popover</Button>
        </PopoverTrigger>
        <PopoverContent data-testid="popover-content" className="flex flex-col gap-3">
          <Eyebrow>row limit</Eyebrow>
          <Input label="Maximum rows" name="maxRows" type="number" defaultValue={1000} />
          <Checkbox label="Warn above 100k" name="warnLarge" defaultChecked />
        </PopoverContent>
      </Popover>

      <Tooltip content="Re-read the schema from the server. ⌘R">
        <Button
          data-testid="tooltip-trigger"
          iconOnly
          leadingIcon={RefreshCw}
          aria-label="Refresh schema"
        />
      </Tooltip>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-testid="context-target"
            className="flex h-8.5 items-center rounded-sm border border-dashed border-rule-strong px-3 text-base text-fg-muted"
          >
            Right-click me
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem icon={FileText}>Open in new tab</ContextMenuItem>
          <ContextMenuItem icon={Copy} shortcut="⌘C">
            Copy name
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} disabled>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function TreeDemo() {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(['server', 'db-analytics', 'schema-dbo'])
  );
  const [selectedId, setSelectedId] = useState('table-fact-order');
  const loadingIds = useMemo(() => new Set(['schema-staging']), []);

  return (
    <div className="h-64 w-full max-w-80 border border-rule bg-surface">
      <Tree
        aria-label="Object explorer"
        data-testid="gallery-tree"
        className="h-full"
        nodes={TREE_NODES}
        expandedIds={expandedIds}
        loadingIds={loadingIds}
        selectedId={selectedId}
        onSelect={node => setSelectedId(node.id)}
        onExpandedChange={(id, expanded) =>
          setExpandedIds(current => {
            const next = new Set(current);
            if (expanded) {
              next.add(id);
            } else {
              next.delete(id);
            }
            return next;
          })
        }
        renderContextMenu={node =>
          node.icon === Table2 ? (
            <ContextMenuContent>
              <ContextMenuItem icon={Table2}>Select top 1000 from {node.label}</ContextMenuItem>
              <ContextMenuItem icon={Copy}>Copy name</ContextMenuItem>
            </ContextMenuContent>
          ) : null
        }
      />
    </div>
  );
}

function ToastRow() {
  // The diagnostics seam, pointed at sonner. Task 7 does this once from the shell's mount;
  // here it proves the wiring and gives the gallery something to fire.
  useEffect(() => installToastNotifier(), []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => notify.success('Backup completed in 4.2s')}>Success toast</Button>
      <Button onClick={() => notify.error('Login failed for user sa')}>Error toast</Button>
      <Button onClick={() => notify.warning('pg_dump not found on PATH')}>Warning toast</Button>
      <Button onClick={() => notify.info('Connected to analytics')}>Info toast</Button>
    </div>
  );
}

export function PrimitivesGallery() {
  // The settings store, not the deleted local hook: Task 7 made it the only `[data-theme]` writer.
  const resolved = useSettingsStore(selectEffectiveTheme);
  return (
    <TooltipProvider>
      <div
        data-testid="primitives-gallery"
        className="isolate min-h-dvh bg-canvas text-base text-fg"
      >
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule-strong px-6 py-5">
          <div>
            <Eyebrow>joinery · ui primitives</Eyebrow>
            <h1 className="font-display text-display-sm text-fg">Primitives gallery</h1>
          </div>
          <ThemeSwitch />
        </header>

        <main className="flex flex-col gap-10 px-6 py-8">
          <Section eyebrow="two heights · 28 / 34px" title="Buttons">
            <ButtonMatrix />
          </Section>

          <Section eyebrow="one component per html element" title="Form controls">
            <FormControls />
          </Section>

          <Section eyebrow="radix · portalled · closed by default" title="Overlays">
            <Overlays />
          </Section>

          <Section eyebrow="roving tabstop · oxide underline" title="Toolbar and tabs">
            <div className="flex flex-col gap-6">
              <div className="border border-rule">
                <Toolbar aria-label="Query actions">
                  <ToolbarButton leadingIcon={Play}>Execute</ToolbarButton>
                  <ToolbarButton leadingIcon={Copy} iconOnly aria-label="Copy SQL" />
                  <ToolbarSeparator />
                  <ToolbarButton leadingIcon={RefreshCw} iconOnly aria-label="Refresh" />
                  <ToolbarButton leadingIcon={Trash2} iconOnly aria-label="Clear" disabled />
                  <ToolbarSpacer />
                  <ToolbarButton leadingIcon={Search} iconOnly aria-label="Find" />
                </Toolbar>
              </div>
              <Tabs defaultValue="results">
                <TabsList>
                  <TabsTrigger value="results" data-testid="tab-results">
                    Results
                  </TabsTrigger>
                  <TabsTrigger value="messages">Messages</TabsTrigger>
                  <TabsTrigger value="plan">Execution plan</TabsTrigger>
                  <TabsTrigger value="locked" disabled>
                    Statistics
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="results" className="pt-3 text-md text-fg-muted">
                  2,104,882 rows · 412ms
                </TabsContent>
                <TabsContent value="messages" className="pt-3 text-md text-fg-muted">
                  Commands completed successfully.
                </TabsContent>
                <TabsContent value="plan" className="pt-3 text-md text-fg-muted">
                  Clustered index scan on fact_order.
                </TabsContent>
              </Tabs>
            </div>
          </Section>

          <Section eyebrow="14 / 16 / 20px" title="Spinner">
            <div className="flex flex-wrap items-center gap-8">
              <Spinner size="sm" />
              <Spinner size="md" label="Connecting…" />
              <Spinner size="lg" label="Restoring analytics" />
            </div>
          </Section>

          <Section eyebrow="retires 19 implementations" title="Empty state">
            <div className="@container">
              <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                <div className="border border-rule bg-surface">
                  <EmptyState
                    size="sm"
                    icon={Database}
                    title="No connection"
                    description="Connect to a server to browse its databases."
                    action={<Button size="sm">New connection</Button>}
                  />
                </div>
                <div className="border border-rule bg-surface">
                  <EmptyState
                    icon={Table2}
                    title="Nothing to show yet"
                    description="Run a query and its results will appear here."
                    action={
                      <Button variant="primary" leadingIcon={Play}>
                        Execute
                      </Button>
                    }
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section eyebrow="virtualized · lazy · context menus" title="Tree">
            <TreeDemo />
          </Section>

          <Section eyebrow="marked → dompurify → innerHTML" title="Markdown">
            <div className="max-w-[42rem] border border-rule bg-surface p-4">
              <Markdown data={MARKDOWN_SAMPLE} enableCodeCopy data-testid="gallery-markdown" />
            </div>
          </Section>

          <Section eyebrow="sonner · notify() seam" title="Toasts">
            <ToastRow />
          </Section>
        </main>
        <Toaster theme={resolved} />
      </div>
    </TooltipProvider>
  );
}
