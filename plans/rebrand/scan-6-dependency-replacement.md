# Scan 6 — `@memberjunction/*` Dependency Replacement Plan

**Status**: read-only scoping scan. No files were edited.
**Scope**: replace all three `@memberjunction/*` npm dependencies as part of the fork/rebrand.
**Date**: 2026-08-14

---

## 0. Executive summary

| Dependency | Real API surface used | Verdict | Effort | Safe for cheap executor? |
|---|---|---|---|---|
| `@memberjunction/ng-shared-generic` ^3.2.0 | **One component**: `<mj-loading>` (3 usages). Nothing else. It renders an **animated MemberJunction logo SVG**. | **Replace with a ~60-line app-owned component.** This is branding, not infrastructure — it is arguably the single most important thing to remove in a rebrand, because it literally paints MJ's logo on Craig's splash screen. | **S** | **Yes** |
| `@memberjunction/ng-markdown` ^3.2.0 | `MarkdownModule` → `<mj-markdown>` with 5 bound inputs. No services, pipes, directives, or types used. | **Replace with `marked` + `DOMPurify` behind an app-owned `MarkdownViewerComponent`.** The replacement is a *security upgrade*: the current config silently bypasses Angular's sanitizer (see §2.B). | **M** | **No — careful implementer** (XSS surface) |
| `@memberjunction/sqlglot-ts` ^5.23.0 | `SqlGlotClient` (`start`/`stop`/`transpile`/`IsRunning`/`Port`), types `TranspileResult`, `SQLDialect`. One file. | **Do NOT attempt a functional replacement in this rebrand pass.** There is no equivalent library. Recommended: **vendor the ~330-line client + 188-line `server.py` into the repo** (attribution preserved), which removes the npm name without changing behaviour. See §3 for the full argument, including evidence that **the feature is already broken in packaged builds**. | **L** (replacement) / **S–M** (vendoring) | **No — Craig decision required first** |

**Trivially removable?** `ng-shared-generic` is close to free — it contributes exactly one small presentational component with zero app-visible logic. It is not *literally* free (the `<mj-loading>` element must be replaced or the 3 templates break), but the replacement is a self-contained SVG/CSS component with no behavioural contract.

**Blocking unknowns** are listed in §7. The main one: does Craig want the SQL-dialect-conversion feature to exist at all, given it currently requires an undocumented host Python install and cannot work from a packaged `.app`?

---

## 1. `@memberjunction/ng-shared-generic` ^3.2.0

### 1.A — Actual API surface consumed

The package's entire public API (`dist/public-api.d.ts`):

```
export * from './lib/module';                    // SharedGenericModule
export * from './lib/recent-access.service';     // RecentAccessService  — NOT USED
export * from './lib/loading/loading.component';  // LoadingComponent (mj-loading)
```

`SharedGenericModule` declares and exports **exactly one** component:

```ts
static ɵmod: i0.ɵɵNgModuleDeclaration<SharedGenericModule,
  [typeof i1.LoadingComponent], [typeof i2.CommonModule], [typeof i1.LoadingComponent]>;
```

So importing `SharedGenericModule` buys precisely `<mj-loading>` and nothing else. `RecentAccessService` is exported from the package root but is **never imported anywhere in Forge** (it depends on `@memberjunction/core` + a "User Record Logs" MJ entity, and is inert here).

**Import sites (3):**

| File | Line | Statement |
|---|---|---|
| `/Users/cadam/code/forge/packages/renderer/src/app/app.component.ts` | 6 | `import { SharedGenericModule } from '@memberjunction/ng-shared-generic';` |
| `/Users/cadam/code/forge/packages/renderer/src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts` | 22 | same |
| `/Users/cadam/code/forge/packages/renderer/src/app/shared/components/result-history-panel/result-history-panel.component.ts` | 20 | same |

Each also lists `SharedGenericModule` in its standalone `imports:` array (`app.component.ts:25`, `ai-analysis-panel.component.ts:43`, `result-history-panel.component.ts:41`).

**Template usages (3) — verbatim:**

`app.component.ts:38`
```html
<mj-loading [text]="loadingMessage()" size="large" animation="pulse"></mj-loading>
```

`ai-analysis-panel.component.ts:126–130`
```html
<mj-loading
  text="Analyzing results..."
  size="medium"
  animation="pulse"
></mj-loading>
```

`result-history-panel.component.ts:180–184`
```html
<mj-loading
  text="Comparing results..."
  size="medium"
  animation="pulse"
></mj-loading>
```

**Inputs actually used: 3 of 8.** `text`, `size` (`'large' | 'medium'`), `animation` (`'pulse'` only). Never used: `showText`, `animationDuration`, `textColor`, `logoColor`, `logoGradient`, the `'spin' | 'bounce' | 'pulse-spin'` animations, or the `LogoGradient` interface. No outputs exist on the component. No CSS classes from the package are targeted by Forge stylesheets (grep for `mj-loading` in `.scss` returns nothing; the only related app CSS is `app.component.ts`'s own `.startup-loading` flex wrapper at lines 60–67).

### 1.B — Runtime/behavioural characteristics to preserve

Minimal, and this is the important part: **`LoadingComponent` renders MemberJunction's logo**. From its own docstring:

> `MJ Loading Component - Displays an animated MJ logo with optional text.`
> `logoColor` … `Default is MJ blue (#264FAF)`

Behaviour to preserve:
- A centred animated mark with optional caption text underneath.
- Three size presets: `small` 40×22px, `medium` 80×45px, `large` 120×67px (plus `auto` = fill container — unused).
- `pulse` animation = fade in/out with a subtle scale, default duration 1.5s.
- Text renders *below* the mark.
- Pure CSS/SVG. No timers, no subscriptions, no `OnDestroy`, no I/O, no change-detection subtleties. It has no lifecycle hooks at all.

There is nothing here that can regress functionally. The only risk is cosmetic.

### 1.C — Replacement recommendation

**No third-party library. Write an app-owned `LoadingIndicatorComponent`.**

Rationale: pulling in a dependency to draw a spinner would be worse than 60 lines of local SVG + CSS, and Angular Material (`MatProgressSpinnerModule`) is *already* imported by both `ai-analysis-panel` and `result-history-panel` — so a Material spinner is a zero-new-dependency fallback if Craig doesn't want a custom mark. Recommended: a small custom component so the rebrand gets its own visual identity on the splash screen, with `mat-spinner` as the escape hatch.

Selector: `app-loading` (matches the repo's existing `app-*` selector convention: `app-shell`, `app-context-menu`, `app-command-palette`, …).

### 1.D — Exact work items

**Create**
- `/Users/cadam/code/forge/packages/renderer/src/app/shared/components/loading/loading.component.ts`
  - Standalone, `ChangeDetectionStrategy.OnPush` (repo rule), selector `app-loading`.
  - Inputs: `text: string = ''`, `size: 'small' | 'medium' | 'large' = 'medium'`, `animation: 'pulse' | 'spin' = 'pulse'`.
    Keep the same input *names and value vocabulary* so the three call sites are a pure tag rename.
  - Template: inline `<svg>` mark (new brand mark, or a neutral geometric mark) + `@if (text) { <span class="loading-text">{{ text }}</span> }`.
  - Styles: three size classes, `@keyframes pulse` (opacity 1→0.4→1, `transform: scale(1)→scale(0.96)→scale(1)`, 1.5s infinite), colours from existing CSS custom properties (`var(--accent)`, `var(--text-secondary)`) so it themes with the app.
  - Assert the invariant: `size` and `animation` map to a known class; fall back to the default class rather than emitting an undefined class name.

**Edit**
| File | Change |
|---|---|
| `app.component.ts` | L6: replace import with `import { LoadingComponent } from './shared/components/loading/loading.component';` · L25: `SharedGenericModule,` → `LoadingComponent,` · L38: `<mj-loading …>` → `<app-loading …>` |
| `ai-analysis-panel.component.ts` | L22 import → `'../loading/loading.component'` · L43 imports-array entry · L126–130 tag rename |
| `result-history-panel.component.ts` | L20 import → `'../loading/loading.component'` · L41 imports-array entry · L180–184 tag rename |
| `packages/renderer/package.json` | Remove L29 `"@memberjunction/ng-shared-generic": "^3.2.0",` |

**Wrapper needed?** The component *is* the seam. Do not also add an abstraction over it.

**Note**: `ai-analysis-panel` and `result-history-panel` both already import `MatProgressSpinnerModule`. After this change, check whether that import is still used in each template — if `mat-spinner`/`mat-progress-spinner` is unreferenced, drop the import too (linter `noUnusedLocals` will not catch template-only usage, so grep the templates explicitly).

### 1.E — Test plan

**Existing coverage:** none directly. `tests/e2e/visual/welcome.spec.ts` and `tests/e2e/visual/connected.spec.ts` capture screenshots after boot; the startup `<mj-loading>` is transient and almost certainly not in any snapshot (grep for `loading` in `tests/` returns nothing relevant). No unit test touches these components.

**New tests:**
- `packages/renderer/src/app/shared/components/loading/loading.component.spec.ts` — pure unit test (vitest, node env, no TestBed, matching the style of `capabilities.state.spec.ts`): instantiate the class directly and assert the `size`/`animation` → CSS-class mapping, including the unknown-value fallback.
- No new e2e needed. Run the existing `npm run test:visual` and re-baseline only if a diff appears.

### 1.F — Effort and risk

**Effort: S** (~1 hour including the SVG).

What could go wrong:
1. Missing one of the three call sites → Angular build error (`'mj-loading' is not a known element`). Loud, not silent. Low risk.
2. New mark sized differently → the startup screen looks off. Cosmetic; caught by eye or by visual snapshot.
3. Forgetting to remove the package.json entry → dependency lingers but nothing breaks.

**Safe for a cheap/low-capability executor agent: YES.** Mechanical, compiler-verified, no security or data implications. This is the ideal first task in the replacement sequence.

---

## 2. `@memberjunction/ng-markdown` ^3.2.0

### 2.A — Actual API surface consumed

Package public API: `MarkdownModule`, `MarkdownComponent` (`mj-markdown`), `MarkdownService`, three marked extensions (`collapsible-headings`, `code-copy`, `svg-renderer`), and types (`MarkdownConfig`, `DEFAULT_MARKDOWN_CONFIG`, `MarkdownRenderEvent`, `HeadingInfo`, `AlertType`, `AlertVariant`).

**Forge uses: `MarkdownModule` → `<mj-markdown>` only.** No service injection, no type imports, no extension imports, no outputs.

**Import site (1):** `/Users/cadam/code/forge/packages/renderer/src/app/features/chat/chat-panel.component.ts:23`
```ts
import { MarkdownModule } from '@memberjunction/ng-markdown';
```
Registered at `chat-panel.component.ts:37`: `imports: [CommonModule, FormsModule, MarkdownModule],`

**Template usages (2) — verbatim:**

`chat-panel.component.ts:241–247` (streaming assistant output)
```html
<mj-markdown
  [data]="state.streamingContent()"
  [enableMermaid]="false"
  [enableCodeCopy]="false"
  [mermaidTheme]="'dark'"
  containerClass="chat-md"
></mj-markdown>
```

`chat-panel.component.ts:253–259` (settled assistant message)
```html
<mj-markdown
  [data]="msg.content"
  [enableMermaid]="true"
  [enableCodeCopy]="true"
  [mermaidTheme]="'dark'"
  containerClass="chat-md"
></mj-markdown>
```

**Inputs used: 5 of 19** — `data`, `enableMermaid`, `enableCodeCopy`, `mermaidTheme`, `containerClass`.
**Outputs used: 0 of 3** (`rendered`, `headingClick`, `codeCopied` all unused).
**Public methods used: 0** (`refresh()`, `getHeadings()`, `scrollToHeading()`, `element` unused).

**Everything else runs on package defaults** (`DEFAULT_MARKDOWN_CONFIG`): `enableHighlight: true`, `enableAlerts: true`, `enableSmartypants: true`, `enableSvgRenderer: true`, `enableHeadingIds: true`, `enableHtml: false`, `enableJavaScript: false`, `sanitize: true`, `enableCollapsibleHeadings: false`, `enableLineNumbers: false`.

**CSS the app actually relies on** — `chat-panel.component.ts:1003–1096`, all `:host ::ng-deep .chat-md …` targeting *generic HTML elements* the renderer emits: `p`, `pre`, `code`, `:not(pre) > code`, `ul`, `ol`, `li`, `h1`–`h4`, `table`, `th`, `td`, `tr:nth-child(even|odd)`, `tr:hover`, `blockquote`. Only **one** package-specific class is targeted:

```scss
:host ::ng-deep .chat-md .mermaid { margin: 8px 0; }   // chat-panel.component.ts:1091
```

…and this rule is **already dead**: the package replaces mermaid code blocks with `<div class="mermaid-diagram">`, not `.mermaid`. Similarly, no app CSS styles `.code-copy-btn`, `.mj-markdown-container`, or `.svg-rendered`, and **no Prism theme stylesheet is loaded anywhere** — `packages/renderer/angular.json` `styles[]` (lines 31–40) contains only fontsource, material-icons, and `src/styles.scss`, and grep for `prism` across the whole renderer returns zero hits. **Prism therefore emits `<span class="token …">` markup with no colours: syntax highlighting is currently invisible.**

(Bonus dead CSS spotted at `chat-panel.component.ts:1094`: `.streaming-bubble :host ::ng-deep .chat-md pre` — `:host` is not in the first position, so this selector never matches. Worth fixing while in there.)

### 2.B — Runtime/behavioural characteristics that must be preserved (and one that must NOT be)

Verified by reading `dist/lib/services/markdown.service.js` and `dist/lib/components/markdown.component.js` of the installed 3.2.0 tarball.

**Markdown engine.** `marked` v14 (`marked@14.1.4` in `package-lock.json`), configured `{ gfm: true, breaks: true }`. GFM tables, strikethrough, autolinks and **task lists** come from `gfm: true`. `breaks: true` means a single newline becomes `<br>` — this materially affects how LLM output reads and **must be matched**.

Extension chain (in order): `svg-renderer` → `marked-highlight` (Prism) → `marked-gfm-heading-id` → `marked-alert` (GitHub `[!NOTE]`-style callouts) → `marked-smartypants` (curly quotes, en/em dashes, ellipses).

**Syntax highlighting.** Prism.js, synchronous, at parse time via `marked-highlight` with `langPrefix: 'language-'`. Pre-registered languages: typescript, javascript, css, scss, json, bash, sql, python, csharp, java, markup, yaml, markdown, graphql. Unknown language → code passed through unhighlighted. **As established above, no Prism theme CSS is loaded, so this produces no visible effect today.**

**Mermaid.** `mermaid` v11, lazily initialised with:
```js
mermaid.initialize({ startOnLoad: false, theme: <mermaidTheme>, securityLevel: 'loose',
                     fontFamily: 'inherit', suppressErrorRendering: true });
```
`securityLevel: 'loose'` permits click handlers and HTML labels inside diagrams — a real XSS vector when the diagram source is LLM-authored. Rendering is async, post-DOM-insertion, replacing `pre > code.language-mermaid` with `<div class="mermaid-diagram">{svg}</div>`. Failures are caught and downgraded to a `.mermaid-error` class + `console.warn`.

**Copy-to-clipboard.** `addCodeCopyButtons()` injects a `.code-copy-btn` into every `pre` after render (guarded against duplicates). Enabled only on settled messages, not while streaming.

**Streaming behaviour.** `ngOnChanges` re-renders on every `data` change. Because chat binds `[data]="state.streamingContent()"`, **every streamed chunk triggers a full re-parse of the whole message**. Worse, `MarkdownService.parse()` calls `configureMarked()` whenever a config override is passed, and `configureMarked()` constructs a **brand-new `Marked()` instance and re-registers all extensions each time**. There is no incremental parsing and no debounce. Partial markdown (an unterminated ``` fence mid-stream) is handled only by `marked`'s own tolerance for unclosed blocks. Chat disables mermaid + copy buttons while streaming, which is the main thing keeping this affordable.

The host component `ChatPanelComponent` is `ChangeDetectionStrategy.OnPush`; `MarkdownComponent` calls `cdr.markForCheck()` after each render. **A replacement must call `markForCheck()` (or use signals) or streaming output will freeze.**

**Sanitization — the finding that matters.**

```js
// markdown.component.js, render()
const bypassAngularSanitizer = this.enableSvgRenderer || this.enableHtml;
if (this.sanitize && !bypassAngularSanitizer) {
    html = this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
}
if (bypassAngularSanitizer && !this.enableJavaScript) {
    html = this.stripJavaScript(html);
}
this.renderedContent = this.sanitizer.bypassSecurityTrustHtml(html);
```

`enableSvgRenderer` defaults to **`true`**, and `chat-panel.component.ts` does **not** set it to `false`. Therefore, on the path that renders LLM output today:

- `bypassAngularSanitizer === true`
- **Angular's `DomSanitizer` is never invoked**
- the only defence is `stripJavaScript()` — five hand-written regexes (`markdown.component.js:477–489`) that remove `<script>…</script>`, `on*=` handlers, literal `javascript:` in `href`/`src`, and literal `data:text/html` in `src`
- the result is passed to `bypassSecurityTrustHtml()`

`marked` v14 passes raw HTML in the source through verbatim (the old `sanitize` option was removed in marked v8). So a model that emits raw HTML gets it rendered with only regex filtering. That filter has plausible bypasses — e.g. `<iframe srcdoc="…">` (the `srcdoc` attribute is not in the filter at all), and entity-encoded `javascript:` URLs (`&#x6a;avascript:`) which the literal-string regexes miss. Add `securityLevel: 'loose'` mermaid and the raw-SVG passthrough of the svg-renderer extension (`renderer(token) { return \`<div class="svg-rendered">${svgContent}</div>\` }`) and the current stack is **not** a defensible sanitizer for untrusted model output.

This is not a reason to panic — the content comes from an LLM the user chose, not a hostile third party — but it *is* a reason the replacement must be strictly better, and it removes any "but we'd be regressing security" argument against the swap. **The replacement is a security improvement, not a security risk.**

### 2.C — Replacement recommendation

**`marked` (^16 or ^18) + `dompurify` (^3.4), wrapped in an app-owned `MarkdownViewerComponent`.**

Named versions:
- `marked@^18.0.9` (MIT) — or pin `^14.1.4` to exactly match current parsing behaviour and eliminate all renderer-output drift. **Recommendation: start at `^14.1.4` for the swap, upgrade in a separate commit.** That makes the diff provably behaviour-preserving.
- `dompurify@^3.4.13` (MPL-2.0 OR Apache-2.0). **Already present in `package-lock.json` at 3.3.3** as a transitive dependency of `mermaid` — so it is already shipping in the bundle. Promoting it to a direct dependency costs nothing.
- `marked-gfm-heading-id@^4.1.4`, `marked-alert@^2`, `marked-smartypants@^1` — optional; only add the ones whose output Craig wants to keep (see decision in §7).
- Highlighting: **omit initially.** Prism today produces *zero visible output* because no theme CSS is loaded, so dropping it is a no-op for users and removes `prismjs` from the tree. If Craig wants real highlighting later, add `highlight.js@^11.12.0` (BSD-3, sync, ~small with per-language imports) rather than `shiki` — shiki is async and would fight the streaming render path.

**Why `marked` over `markdown-it`:** `marked` is what the current renderer uses, so `gfm: true, breaks: true` output is byte-comparable and the existing `.chat-md` CSS keeps working unchanged. `markdown-it` would be a fine library but guarantees visual drift for no benefit.

**How the replacement sanitizes — exactly:**

```ts
const rawHtml = marked.parse(markdown, { gfm: true, breaks: true, async: false }) as string;
const clean = DOMPurify.sanitize(rawHtml, {
  USE_PROFILES: { html: true },     // no SVG profile, no MathML
  ADD_ATTR: ['class'],              // keep language-* classes for code styling
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'svg'],
  FORBID_ATTR: ['srcdoc', 'style', 'formaction', 'xlink:href'],
  ALLOW_DATA_ATTR: false,
});
```

Then bind via `[innerHTML]="safeHtml"` where `safeHtml = sanitizer.bypassSecurityTrustHtml(clean)`.

Key points for review:
- DOMPurify runs a **real HTML parser** (the browser's own, via a detached document), not regexes. It normalises entities before checking URL schemes, which is precisely the class of bypass `stripJavaScript()` misses.
- `bypassSecurityTrustHtml` is still used — but *after* DOMPurify, not instead of a sanitizer. That is the standard, defensible pattern and satisfies the CLAUDE.md intent ("never use `innerHTML` with hand-rolled markdown parsing"): the parsing is a maintained library and the HTML is sanitizer-output.
- Belt-and-braces option: skip `bypassSecurityTrustHtml` entirely and let Angular's `DomSanitizer` run over DOMPurify's output too. Angular's sanitizer strips `id` and `style` but **preserves `class`**, so `language-*` and `.chat-md` styling survive. This double-sanitize costs a little CPU per streamed chunk. **Recommendation: use DOMPurify + `bypassSecurityTrustHtml`, and add a unit-test suite (§2.E) as the guarantee.**
- If mermaid is kept (see §7), it must move to `securityLevel: 'strict'`, and its SVG output must itself go through DOMPurify's SVG profile before insertion.

### 2.D — Exact work items

**Create**
- `/Users/cadam/code/forge/packages/renderer/src/app/shared/markdown/markdown-renderer.ts`
  **A pure, DOM-free-ish function** — no Angular, no injection:
  ```ts
  export function renderMarkdown(md: string): string   // marked → DOMPurify → clean HTML string
  ```
  This is the single seam that unit tests target. One job, no side effects other than DOMPurify's internal use of the document.
- `/Users/cadam/code/forge/packages/renderer/src/app/shared/markdown/markdown-viewer.component.ts`
  Standalone, `OnPush`, selector `app-markdown`.
  - Inputs mirroring current call sites so the template change is a rename: `data: string`, `enableMermaid: boolean = false`, `enableCodeCopy: boolean = false`, `containerClass: string = ''`. (Drop `mermaidTheme` if mermaid is dropped.)
  - Template: `<div class="markdown-container" [class]="containerClass" [innerHTML]="safeHtml()"></div>`
  - Recompute on input change; call `markForCheck()`. Keep the parse in a `computed()` if inputs are converted to signal inputs.
  - Copy buttons: implement with an Angular click handler + event delegation on the container (`(click)` on the wrapper, check `target.closest('pre')`), **not** by injecting DOM nodes post-render — that avoids the `ngOnDestroy` listener-cleanup dance the MJ component needs, and keeps the "no direct DOM manipulation" rule.
  - `navigator.clipboard.writeText` failures must be caught and surfaced, not swallowed.

**Edit**
| File | Change |
|---|---|
| `packages/renderer/src/app/features/chat/chat-panel.component.ts` | L23 import → `MarkdownViewerComponent` from the new path · L37 imports array · L241–247 and L253–259 tag+input rename · L1091 fix or delete the dead `.mermaid` rule · L1094 fix the invalid `:host` selector |
| `packages/renderer/package.json` | Remove L28 `"@memberjunction/ng-markdown": "^3.2.0",`; add `"marked": "^14.1.4"`, `"dompurify": "^3.4.13"` (+ any marked extensions kept) |
| `packages/renderer/angular.json` | Only if a CommonJS warning appears — add to `allowedCommonJsDependencies` (line 21). `marked` and `dompurify` both ship ESM, so this is likely unnecessary. |
| `/Users/cadam/code/forge/CLAUDE.md` | **Rewrite rule §"AI Integration Rules" item 2 (line 156).** Proposed text: *"Use the app-owned `MarkdownViewerComponent` (`shared/markdown/`) for rendering any AI-generated content or markdown in the renderer. It parses with `marked` and sanitizes with DOMPurify before binding. Never hand-roll markdown-to-HTML conversion, and never bind unsanitized strings to `[innerHTML]`."* |
| `/Users/cadam/code/forge/CONTRIBUTING.md` | Line 121 — same rewrite. |

**Opportunistic fix, strongly recommended in the same PR:**
`packages/renderer/src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts:473–488` builds HTML from AI output with **hand-rolled regex markdown** and binds it at line 148:
```html
<div class="result-content" [innerHTML]="formattedContent()"></div>
```
This already violates the CLAUDE.md rule the rebrand is rewriting, and it is a live unsanitized-`innerHTML` path for LLM output. Replace `formattedContent()` with `<app-markdown [data]="analysisContent()">`. This *deletes* code and closes a hole — do it while the seam is being built.

**Wrapper component: yes, definitely.** One `app-markdown` seam, used by chat (2 sites) + ai-analysis-panel (1 site), means any future engine/sanitizer change is a one-file edit.

### 2.E — Test plan

**Existing coverage: effectively none.** No spec references markdown; `tests/e2e/` has no chat spec; `tests/e2e/visual/` covers welcome/connected/dialogs/connection-dialog only. The chat markdown path is currently untested end to end.

**New tests:**

1. `packages/renderer/src/app/shared/markdown/markdown-renderer.spec.ts` — **the important one.** Vitest. Needs a DOM for DOMPurify: add `jsdom` as a root devDependency (it is **not** currently in `package-lock.json`) and put `// @vitest-environment jsdom` at the top of the file. Cases:
   - **XSS (must all assert the payload is neutered):** `<script>alert(1)</script>`; `<img src=x onerror=alert(1)>`; `<a href="javascript:alert(1)">`; entity-encoded `<a href="&#x6a;avascript:alert(1)">`; `<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">`; `<svg><animate onbegin=alert(1)>`; `<object data="data:text/html,...">`; `<a href="data:text/html;base64,…">`; `<form action=…><button formaction=javascript:…>`; `<div style="background:url(javascript:…)">`; a markdown link `[x](javascript:alert(1))`.
     Assert on the output string: no `<script`, no `on\w+=`, no `javascript:`, no `srcdoc`.
   - **Fidelity (must still work):** GFM table → `<table>`; task list `- [x]` → checkbox; fenced code → `<pre><code class="language-sql">`; single newline → `<br>` (proves `breaks: true`); `**bold**`, `*em*`, `` `code` ``, blockquote, ordered/unordered lists, headings h1–h4 (these are exactly the elements `.chat-md` CSS styles).
   - **Partial/streaming input:** unterminated ``` fence; a half-written table row; a lone `*`; empty string; a 100KB string (bounded — assert it returns within a sane time and does not throw).
2. `packages/renderer/src/app/shared/markdown/markdown-viewer.component.spec.ts` — class-level unit test: input change recomputes output; empty input yields empty string; `containerClass` is applied.
3. `tests/e2e/chat-markdown.spec.ts` (**new e2e**) — drive the chat panel with a stubbed/replayed assistant message containing a table + code fence, assert `.chat-md table` and `.chat-md pre code` render and the copy button copies. This is the only test that proves the `OnPush` + streaming wiring, which unit tests cannot cover.

**Equivalence harness (recommended, cheap):** before deleting the old component, write a throwaway script that runs ~30 representative markdown samples through both `@memberjunction/ng-markdown`'s `MarkdownService.parse()` and the new `renderMarkdown()`, and diff the HTML. Keep the samples as fixtures for test #1. This turns "does it look the same?" into a reviewable artefact.

### 2.F — Effort and risk

**Effort: M** (~half a day for the swap + tests; a full day if mermaid is retained and re-secured).

What could go wrong:
1. **Streaming stalls.** Forgetting `markForCheck()` under `OnPush` → chat output appears frozen until another event fires. Most likely defect. Caught by the e2e test, not by unit tests.
2. **Per-chunk parse cost.** The new renderer must not rebuild the `Marked` instance per call (the MJ one does). Construct once at module scope. Note the repo just finished two perf waves — a regression here would be visible.
3. **CSS drift.** If a marked extension is dropped, alert callouts / smart quotes disappear. Cosmetic, but announce it.
4. **Over-tight DOMPurify config.** Stripping `class` would kill `language-*` and any code styling. Test #1 case "fenced code" catches this.
5. **Mermaid decision left implicit.** If mermaid is dropped without saying so, chat diagrams silently become code blocks. Must be an explicit, communicated choice.
6. **`jsdom` devDependency** must actually be added, or the sanitization tests silently can't run.

**Safe for a cheap/low-capability executor agent: NO.** The mechanical parts (imports, tag renames, package.json) are trivial, but the sanitizer configuration and the XSS test suite are exactly where a low-capability agent produces confident-looking, subtly wrong code. **Recommendation: a careful implementer writes `markdown-renderer.ts` + its spec; the tag renames and doc edits can be delegated afterwards.**

---

## 3. `@memberjunction/sqlglot-ts` ^5.23.0

### 3.A — Actual API surface consumed

Package exports: `SqlGlotClient` + types `SQLDialect`, `ErrorLevel`, `TranspileOptions`, `TranspileResult`, `ParseOptions`, `ParseResult`, `SqlGlotClientOptions`, `HealthStatus`.

**Import site (1):** `/Users/cadam/code/forge/packages/main/src/services/sql/sql-converter.ts:13–14`
```ts
import { SqlGlotClient } from '@memberjunction/sqlglot-ts';
import type { TranspileResult, SQLDialect as SqlGlotDialect } from '@memberjunction/sqlglot-ts';
```

**Used from `SqlGlotClient` (5 of 9 members):**
| Member | Where |
|---|---|
| `new SqlGlotClient({ startupTimeoutMs: 15000, requestTimeoutMs: 30000 })` | `sql-converter.ts:43–46` (2 of 4 options; `pythonPath` and `serverPath` left default) |
| `get IsRunning` | `:53`, `:125`, `:132` |
| `get Port` | `:59` (log line only) |
| `start()` | `:57` |
| `stop()` | `:134` |
| `transpile(sql, { fromDialect, toDialect, pretty: true, errorLevel: 'WARN' })` | `:81–86` |

**Never used:** `transpileStatements()`, `parse()`, `getDialects()`, `health()`, and the types `ErrorLevel`, `TranspileOptions`, `ParseOptions`, `ParseResult`, `SqlGlotClientOptions`, `HealthStatus`.

**`TranspileResult` fields read** (`sql-converter.ts:90–98`): all five — `success`, `sql`, `statements`, `errors`, `warnings`.

**Dialect mapping** (`sql-converter.ts:31–35`) — only 3 of sqlglot's 31 dialects are reachable:
```ts
const DIALECT_MAP: Record<string, SqlGlotDialect> = {
  mssql: 'tsql', postgresql: 'postgres', mysql: 'mysql',
};
```
Unmapped engines fall through to the raw engine string (`sql-converter.ts:75–76`).

**Call chain (single, shallow):**
`query.component.ts:2393 convertSqlTo()` → `ipc.service.ts:771 convertSql()` → preload `index.ts:744` → `IPC_CHANNELS.QUERY.CONVERT_SQL` (`'query:convert-sql'`) → `query.ipc.ts:213–223` → `SQLConverterService.convert()`.
Shutdown: `packages/main/src/index.ts:145–151` calls `SQLConverterService.getInstance().stop()`.
UI entry point: three menu items in `query.component.ts:251/256/261` ("To SQL Server / PostgreSQL / MySQL").

### 3.B — Runtime/behavioural characteristics (verified against the 5.23.0 tarball)

**It really does spawn Python.** `dist/SqlGlotClient.js`:
```js
const proc = spawn(this.pythonPath, [this.serverPath, '0'], { stdio: ['ignore','pipe','pipe'], env: {...process.env} });
```
- `pythonPath` defaults to the string `'python3'` (PATH lookup — no bundled interpreter, no venv, no fallback to `python` or `py`).
- `serverPath` defaults to `<package>/src/python/server.py` (188 lines, shipped in the tarball).
- Argument `'0'` = bind an ephemeral port on `127.0.0.1`.
- Readiness handshake: the client scans child stdout for `SQLGLOT_PORT=(\d+)`, then polls `GET /health` every 50ms until `startupTimeoutMs`.
- Transport: plain `node:http` to `127.0.0.1:<port>`, JSON bodies, snake_case wire format (`from_dialect`, `to_dialect`, `error_level`).
- Lifecycle: `stop()` sends `SIGTERM`, then `SIGKILL` after 5s. The client **also registers process-level `exit`/`SIGINT`/`SIGTERM` handlers** that `SIGTERM` the child and, for the signal cases, call `process.exit(0)` — note that this means the library can terminate the Electron main process on `SIGINT`/`SIGTERM`, which is a side effect worth being aware of.
- If the child dies unexpectedly, `IsRunning` flips back to `false` and the next call re-`start()`s (via `SQLConverterService.ensureRunning`).

**Python is assumed, not bundled.** Prerequisites per the package README: *Python 3.9+ with `sqlglot`, `fastapi`, and `uvicorn` installed* (`pip install sqlglot fastapi uvicorn`). **Grep confirms this is documented nowhere in Forge** — `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/`, and `scripts/` contain zero references to Python, pip, fastapi, or uvicorn. `CLAUDE.md`'s "Environment Setup" lists Node, npm, Xcode CLI tools, Docker, and the PG/MySQL client binaries — but not Python.

**The feature is almost certainly broken in packaged builds.** `electron-builder.yml` sets `asar: true` with `asarUnpack: ["**/*.node", "**/keytar/**/*"]`. `server.py` therefore lives *inside* `app.asar`, at a path like `…/app.asar/node_modules/@memberjunction/sqlglot-ts/src/python/server.py`. Electron's asar shim virtualises paths for **Node's `fs`** — so the client's `existsSync()` check passes — but it does **not** virtualise them for a spawned external process. `python3` cannot open a file inside an asar archive. The spawn will fail with a "can't open file" error and the child will exit non-zero, which surfaces as *"Python 3 is required for SQL conversion…"* (see error handling below) regardless of whether Python is installed. **This should be verified empirically against a packaged build before any decision is made — but the static evidence is strong.**

**`TranspileResult` contract:** `{ success: boolean; sql: string; statements: string[]; errors: string[]; warnings: string[] }`. `sql` is all statements joined with `;\n`.

**Failure handling in `sql-converter.ts` — the feature is fully optional, not load-bearing:**
- `convert()` wraps everything in try/catch (`:78–118`) and **always returns a `ConversionResult`; it never throws** to the IPC layer.
- On error it logs and maps to user-facing text (`:105–109`): `ENOENT`/`python` → *"Python 3 is required for SQL conversion. Please install Python 3 and ensure \"python3\" is on your PATH."*; `timeout` → *"SQL conversion service timed out…"*.
- The renderer (`query.component.ts:2404–2417`) shows a toast on failure and leaves the editor content untouched. Nothing else in the app depends on the converter.
- Startup is lazy (first conversion request only) and serialised via a `starting` promise (`:56–68`), so app boot is unaffected.
- **Conclusion: if this dependency were deleted outright and `convertSqlTo()` reduced to an error toast, no other feature would regress.**

**One more latent hazard:** the package is `"type": "module"` (ESM-only), while `packages/main/tsconfig.json` compiles with `"module": "CommonJS"`. The emitted `require('@memberjunction/sqlglot-ts')` only works because Electron 41 ships a Node 22 that supports `require(esm)`. It works today, but it is a fragile coupling that any Node/Electron change could break — and a vendored, CJS-compiled client would remove that fragility.

### 3.C — Replacement recommendation

**There is no drop-in replacement, and the honest recommendation is: do not attempt a functional replacement in this rebrand pass.**

Alternatives surveyed:

| Candidate | Verdict |
|---|---|
| `sqlglot-ts` (**unscoped**, Flamefork) — the one `docs/SQL-CONVERSION-STUDY.md` line 13 actually recommended | **v0.1.5, ~41 downloads/week, last published 2026-03.** A partial port. Its own docs describe DuckDB as the well-tested dialect; T-SQL/PG/MySQL are "functional". Swapping the real Python sqlglot for this would be a **large, silent quality regression** on exactly the three dialects Forge uses. Not acceptable. |
| `@polyglot-sql/sdk` (Rust/Wasm, v0.9.0) | Pre-1.0, broad dialect claims, unproven; adds a Wasm payload to the main process. Possible future direction, not a rebrand-week change. |
| `node-sql-parser` v5.4.0 | A *parser*, not a transpiler. Cannot do dialect rewriting (`ISNULL`→`COALESCE`, `TOP n`→`LIMIT n`, bracket→double-quote quoting). Wrong tool. |
| Call the Python `sqlglot` library directly from a Forge-owned client | This is the same architecture, just without MJ's name on it. See below. |
| Route conversion through the existing LLM abstraction | Non-deterministic, costs tokens, needs an API key — the opposite of the "deterministic, verifiable" property the current design was chosen for. Viable only as a *fallback* tier. |

**Recommended path: vendor, don't replace.**

Copy the client and the Python server into Forge as first-party code:
- `packages/main/src/services/sql/sqlglot/sqlglot-client.ts` — a ~200-line TypeScript port of `SqlGlotClient`, trimmed to the 5 members Forge actually uses (`start`, `stop`, `transpile`, `IsRunning`, `Port`). Drop `transpileStatements`, `parse`, `getDialects`, `health`-as-public-API (keep the internal readiness poll). Compile as CommonJS with the rest of `packages/main`, which also **fixes the ESM/CJS fragility**.
- `resources/python/sqlglot-server.py` — the 188-line FastAPI server, **placed under `resources/` so `electron-builder`'s existing `extraResources` block copies it outside the asar**, which is the fix for the packaging bug in §3.B.
- Attribution: keep a header comment crediting `sqlglot` (Toby Mao, MIT) and noting the client was adapted from `@memberjunction/sqlglot-ts` (ISC). This matches the existing, correct precedent in `packages/main/src/utils/singleton.ts`, `json-utils.ts`, `object-cache.ts`.

Licensing: `@memberjunction/sqlglot-ts` is **ISC**, which permits copying with the copyright notice retained. Vendoring is legally clean. Include the ISC notice.

**Whatever is decided, three things need fixing regardless:**
1. Move `server.py` out of the asar (`extraResources` + `serverPath` pointing at `process.resourcesPath` in production).
2. Document the Python prerequisite in `README.md` / `CLAUDE.md` "Environment Setup", and make the UI surface a **setup-instructions view** when Python or the pip packages are missing — the repo already has this exact pattern for `pg_dump`/`mysqldump` (see `packages/main/src/services/sql/cli-deps.ts` and its spec). Reuse it.
3. Decide whether the README should keep advertising dialect conversion (`README.md:57`, `:306`, `:421`) as a headline feature while it requires an undocumented `pip install`.

**If Craig would rather cut than carry:** deleting the feature is genuinely cheap — remove `sql-converter.ts`, the IPC handler (`query.ipc.ts:213–223`), the shutdown hook (`index.ts:145–151`), the preload + ipc.service methods, the `CONVERT_SQL` channel, the three menu items and `convertSqlTo()`, and the three README lines. That is an S-sized, low-risk deletion that removes the dependency completely. Given the feature appears non-functional in shipped builds, this deserves serious consideration.

### 3.D — Exact work items (vendoring path)

**Create**
- `/Users/cadam/code/forge/packages/main/src/services/sql/sqlglot/sqlglot-client.ts` — trimmed CJS-compatible port. Constructor takes `{ pythonPath?, serverPath?, startupTimeoutMs?, requestTimeoutMs? }`. **Bound the readiness poll with an explicit max iteration count** in addition to the deadline (CLAUDE.md "bound every loop" — the upstream `while (Date.now() < deadline)` has no iteration cap). Do **not** copy upstream's `process.on('SIGINT', … process.exit(0))` handlers into an Electron main process; register cleanup through the existing shutdown path in `index.ts` instead.
- `/Users/cadam/code/forge/packages/main/src/services/sql/sqlglot/types.ts` — `SQLDialect`, `TranspileOptions`, `TranspileResult` (only what's used).
- `/Users/cadam/code/forge/resources/python/sqlglot-server.py` — copied verbatim from the tarball, header comment crediting sqlglot + the ISC origin.
- `/Users/cadam/code/forge/packages/main/src/services/sql/sqlglot/python-deps.ts` — detect `python3` + `import sqlglot, fastapi, uvicorn`, mirroring `cli-deps.ts`.

**Edit**
| File | Change |
|---|---|
| `packages/main/src/services/sql/sql-converter.ts` | L4 comment (drop the MJ package name) · L13–14 imports → `'./sqlglot/sqlglot-client'` / `'./sqlglot/types'` · L43–46 pass an explicit `serverPath` resolved from `process.resourcesPath` in production and from the repo in dev · L105–109 replace the substring-sniffing error mapping with a structured check against `python-deps.ts` |
| `electron-builder.yml` | `extraResources` already copies all of `resources/` except `*.plist`, so `resources/python/sqlglot-server.py` is picked up **for free** — verify, don't assume. |
| `package.json` (root) | Remove L58 `"@memberjunction/sqlglot-ts": "^5.23.0",`. No replacement dependency is added. |
| `README.md` | L57, L306, L421 — drop the package name; add the Python prerequisite. |
| `docs/SQL-CONVERSION-STUDY.md` | L27–29 — delete the speculative `@memberjunction/sqlglot` subsection; correct L13's "Recommended" now that the shipped design is the Python microservice. |
| `CLAUDE.md` / `CONTRIBUTING.md` | Add Python 3.9+ + `pip install sqlglot fastapi uvicorn` to Environment Setup, next to the existing `pg_dump`/`mysql-client` guidance. |

No wrapper component is needed — `SQLConverterService` **is** the seam and already isolates the whole app from the client's API.

### 3.E — Test plan

**Existing coverage: zero.** No spec, integration test, or e2e touches `sql-converter.ts`, `convertSql`, or the Convert menu (`grep -rn "onvert" tests/e2e/*.spec.ts` → no matches). `tests/integration/dialect/` covers the *dialect abstraction* (`sql/dialect/`), which is unrelated to sqlglot.

**New tests:**
1. `packages/main/src/services/sql/sql-converter.spec.ts` (**unit, no Python required**) — inject a fake client into `SQLConverterService` (requires a small constructor-injection seam; worth adding). Assert:
   - `DIALECT_MAP` maps `mssql→tsql`, `postgresql→postgres`, `mysql→mysql`, and unknown engines pass through.
   - `TranspileResult` → `ConversionResult` field mapping, including `errors.join('\n')` → `error` and `errors: []` → `error: undefined`.
   - Spawn failure returns `{ success: false }` with the original SQL preserved and never throws.
   - Concurrent `convert()` calls trigger exactly **one** `start()` (the `starting`-promise serialisation at `:56–68` is currently untested).
2. `packages/main/src/services/sql/sqlglot/python-deps.spec.ts` — mirrors `cli-deps.spec.ts`; missing-interpreter and missing-pip-package paths.
3. `tests/integration/sqlglot/transpile.spec.ts` (**gated on Python being present**, skipped otherwise — same pattern as the backup CLI integration tests) — **the dialect-equivalence suite**. A fixture table of ~20 pairs, each asserting `convert(sql, from, to)` output:
   - T-SQL → PG: `SELECT TOP 10 * FROM [dbo].[Users]` → `LIMIT 10` + `"dbo"."Users"`; `ISNULL(a,0)` → `COALESCE(a,0)`; `GETDATE()` → `CURRENT_TIMESTAMP`; `LEN(x)` → `LENGTH(x)`; `x + y` string concat → `x || y`; `[bracket]` → `"quoted"`.
   - PG → MySQL: `"quoted"` → `` `backtick` ``; `LIMIT n OFFSET m`; `NOW()`.
   - MySQL → T-SQL: `LIMIT n` → `TOP n`; backtick → bracket.
   - Round-trip stability: T-SQL → PG → T-SQL for a simple SELECT.
   **Capture these expectations against the CURRENT dependency before vendoring.** They then serve as the equivalence proof that the vendored client behaves identically — and, if a real replacement is ever attempted, as the acceptance suite for it.
4. `tests/e2e/query-convert.spec.ts` — Convert menu present; conversion failure shows an error toast and leaves the editor unchanged. Should pass on a machine without Python, which is the point.

### 3.F — Effort and risk

**Effort: L for a genuine replacement** (multi-day, and it would ship worse SQL). **S–M for vendoring** (~half a day for the port + the asar/extraResources fix, plus half a day for the fixture-based equivalence suite). **S for deletion.**

What could go wrong (vendoring path):
1. **Path resolution dev-vs-packaged.** The `serverPath` must differ between `npm run dev` and a packaged `.app` (`process.resourcesPath`). Getting this wrong reproduces the exact bug being fixed — except silently, since the error path already blames Python. **Must be verified against a real `npm run package:mac` build**, not just `npm run dev`.
2. **Windows.** `spawn('python3', …)` — on Windows the interpreter is typically `python` or the `py` launcher. Forge ships Windows builds (`electron-builder.yml` `win.target: nsis, zip`). The vendored client should probe a candidate list, bounded.
3. **Zombie processes.** Dropping the upstream `process.on('exit')` handlers in favour of the `index.ts` shutdown hook is correct, but the hook currently does `.catch(() => {})` — a swallowed error (`index.ts:147–148`), which the CLAUDE.md rules forbid. Log it while in there.
4. **Scope creep.** "Vendor the client" quietly becomes "fix packaging + add dependency detection + add a setup UI + write an integration harness." Split these into separate PRs and be explicit that only the *first* is required for the rebrand.

**Safe for a cheap/low-capability executor agent: NO — and it should not be started at all until Craig decides between vendor / delete / defer.** This is the one item in the rebrand with a real architectural question underneath it. My recommendation, stated plainly: **defer the packaging and Python-detection work; do the minimal vendoring so the `@memberjunction` name leaves `package.json`; and treat the "is this feature actually alive?" question as a separate ticket.** If Craig wants the rebrand to be small, **deleting the feature is the lowest-risk way to remove this dependency entirely.**

---

## 4. Recommended execution order

1. **`ng-shared-generic`** — S, mechanical, delegatable. Removes an MJ logo from the splash screen. Do this first; it is the highest branding-value-per-unit-risk change in the whole rebrand.
2. **`ng-markdown`** — M, careful implementer. Build `markdown-renderer.ts` + XSS spec first (TDD), then the wrapper component, then swap the 2 chat call sites, then fold in the `ai-analysis-panel` regex-markdown fix, then rewrite the CLAUDE.md/CONTRIBUTING.md rules.
3. **`sqlglot-ts`** — blocked on a Craig decision. Do not start speculatively.

Steps 1 and 2 touch only `packages/renderer` and can ship as one PR. Step 3 touches `packages/main` + packaging + docs and must be its own PR.

---

## 5. package.json deltas (consolidated)

`packages/renderer/package.json`
```diff
-    "@memberjunction/ng-markdown": "^3.2.0",
-    "@memberjunction/ng-shared-generic": "^3.2.0",
+    "dompurify": "^3.4.13",
+    "marked": "^14.1.4",
```
(plus `marked-alert`, `marked-gfm-heading-id`, `marked-smartypants` only if those behaviours are retained)

`package.json` (root)
```diff
-    "@memberjunction/sqlglot-ts": "^5.23.0",
```
```diff
   "devDependencies": {
+    "jsdom": "^25.0.0",
```
(`jsdom` is required for the DOMPurify unit tests; it is not currently in the lockfile.)

Transitively removed from the bundle: `prismjs`, `mermaid` (~unless retained), `marked-highlight`, `@memberjunction/core`, `@memberjunction/core-entities`, `@memberjunction/global`, `@memberjunction/ai`, `@memberjunction/ai-vectors-memory`, `@memberjunction/interactive-component-types`, and their `zod`/`lodash`/`debug` tails. **Note `dompurify@3.3.3` is already in the tree via `mermaid` — if mermaid is dropped, DOMPurify becomes a direct dependency instead of a transitive one, which is a net wash.** Dropping `mermaid` and `prismjs` should measurably shrink the renderer bundle against the existing 3.5MB warning / 4.5MB error budgets in `packages/renderer/angular.json:46–57`.

---

## 6. Documentation edits required by this work

| File | Line | Change |
|---|---|---|
| `CLAUDE.md` | 156 | Rewrite AI Integration Rule #2 (mandates `@memberjunction/ng-markdown`) → mandate the app-owned `MarkdownViewerComponent` + DOMPurify. **This rule currently forbids exactly what a naive replacement would do; it must be rewritten in the same PR as the code change, not after.** |
| `CLAUDE.md` | Environment Setup | Add Python 3.9+ prerequisite if the sqlglot feature is retained. |
| `CONTRIBUTING.md` | 121 | Same rewrite as CLAUDE.md:156. |
| `README.md` | 57, 306, 421 | Drop `@memberjunction/sqlglot-ts` naming; state the Python prerequisite or remove the feature claim. |
| `docs/SQL-CONVERSION-STUDY.md` | 13, 27–29 | Delete the speculative `@memberjunction/sqlglot` subsection; correct the "Recommended" library now that the shipped design is the Python microservice. |
| `plans/rebrand/scan-1-build-packaging.md` | 29–30, 36, 368 | Supersede: these say "do not change — real third-party dependency." Craig has now decided to replace all three. |
| `plans/rebrand/scan-2-renderer-ui.md` | 232–243 | Supersede §"out of scope entirely" for the `mj-*` selectors. |
| `plans/rebrand/scan-5-docs-tests-tooling.md` | §12 | Supersede the keep-and-disclose recommendation. |

---

## 7. Blocking unknowns / decisions needed from Craig

1. **Mermaid: keep or drop?** It is enabled for settled chat messages (`chat-panel.component.ts:255`) and is the single largest transitive dependency in the markdown stack. Keeping it means also fixing `securityLevel: 'loose'` → `'strict'` and sanitizing its SVG. Dropping it means chat diagrams render as code blocks. **Blocks the ng-markdown work item.**
2. **Syntax highlighting: restore or drop?** Prism is wired up today but produces no visible colour because no theme CSS is loaded. Dropping it is a no-op for users; restoring it (via `highlight.js` + a theme in `angular.json` `styles[]`) is a small *improvement*, not parity. **Which does Craig want?**
3. **Marked extensions:** keep GitHub alerts (`[!NOTE]`), smartypants typography, and heading IDs? (Heading IDs are currently stripped anyway on the non-bypass path, since Angular's sanitizer drops `id`.)
4. **SQL dialect conversion: vendor, delete, or defer?** The evidence says it cannot work from a packaged build and requires an undocumented `pip install`. **This is the one genuinely blocking decision.** Recommended: confirm empirically with a packaged build, then choose.
5. **New brand mark for the loading component** — does one exist, or should the replacement use a neutral geometric mark for now? (Only affects aesthetics; the swap can proceed with a placeholder.)
6. **Is `plans/rebrand/scan-1/2/5`'s "out of scope" guidance now formally superseded?** Those documents will otherwise contradict this one for anyone reading them later.

---

## Appendix — verification method

`node_modules/` is not present in this working tree, so all three packages were downloaded from the npm registry via `npm pack` at their locked versions (`@memberjunction/ng-markdown@3.2.0`, `@memberjunction/ng-shared-generic@3.2.0`, `@memberjunction/sqlglot-ts@5.23.0`, integrity-matched against `package-lock.json`) and their `dist/*.d.ts`, `dist/*.js`, `README.md`, and `package.json` were read directly. Every claim about defaults, sanitization, spawn behaviour, and emitted CSS classes above comes from reading the shipped code, not from documentation.
