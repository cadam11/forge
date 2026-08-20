/**
 * Read the app's command data out of `packages/renderer/src/` **without importing the renderer**.
 *
 * ── The problem this solves ─────────────────────────────────────────────────────────────────
 *
 * `plans/docs-site/PROPOSAL.md` §5.3 requires the shortcut and command reference pages to be
 * generated from `commands/catalogue.ts` rather than transcribed, and puts two hard rules on the
 * generator: it asserts its inputs exist and fails loudly, and it does NOT plain-import the
 * renderer (a `import('…/catalogue.ts')` drags in `lucide-react`, and anything reached from a
 * feature module drags in React, Radix and a DOM this build does not have).
 *
 * ── How this reads it instead ───────────────────────────────────────────────────────────────
 *
 * Each source module is transpiled to CommonJS with the TypeScript compiler (already a devDep of
 * this site, for `astro check`) and executed inside a `node:vm` context with a **declared** module
 * resolver. Nothing resolves by accident:
 *
 *  - a relative specifier is resolved to a file on disk, asserted to exist, and — unless it is
 *    stubbed below — transpiled and executed the same way, so `catalogue.ts` runs against the
 *    REAL `utils/platform.ts` and therefore the real `IS_MAC`;
 *  - a bare specifier must be in {@link BARE_STUBS}; anything else throws;
 *  - a relative specifier that reaches a React surface is stubbed by absolute path, and each stub
 *    is a value the caller can point at a line of source.
 *
 * Executing the module rather than pattern-matching its text is what makes the output faithful:
 * the pages render accelerators through the app's own `formatAcceleratorList`, so a change to the
 * glyph table or the macOS modifier order lands in the docs without this file knowing about it.
 * Loading twice under two `navigator.userAgent` values is what produces the macOS and Windows
 * columns from one source of truth.
 *
 * Every failure mode here is loud: a missing file, an unknown module, or a stub that gets called
 * throws with the specifier and the importer.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The app tree this generator reads. Read-only, and asserted to exist before anything else. */
export const RENDERER_SRC = resolve(HERE, '../../../packages/renderer/src');

/** The files the generated pages are derived from, relative to {@link RENDERER_SRC}. */
export const SOURCE_FILES = {
  catalogue: 'commands/catalogue.ts',
  platform: 'utils/platform.ts',
  paletteActions: 'features/command-palette/palette-actions.ts',
  statusBar: 'shell/status-bar.tsx',
};

/** A module is transpiled and run at most once per platform pass; 40 is far above the real graph. */
const MAX_MODULES_PER_PASS = 40;

/**
 * Icons are `lucide-react` component references. The generated pages never render one, so any name
 * may resolve to an inert marker — but it must be a distinct marker per name, so that a mistake in
 * this file shows up as `{ icon: '…' }` in the output rather than as `undefined`.
 */
const lucideStub = new Proxy(
  {},
  {
    get: (_target, name) => (typeof name === 'string' ? { lucideIcon: name } : undefined),
  }
);

/** Bare (non-relative) specifiers this loader will answer. Anything else is a hard error. */
const BARE_STUBS = { 'lucide-react': lucideStub };

/**
 * A binding that exists so a module can close over it, and that this generator must never call.
 * `palette-actions.ts` holds `run: () => settingsStore.getState()…` closures; the closure is data
 * we ignore, the store behind it is a live Zustand store that would pull in the renderer.
 */
function unreachable(what) {
  return () => {
    throw new Error(
      `The reference generator called \`${what}\`, which it must not: that is renderer runtime ` +
        `state, not data. See docs-site/scripts/lib/app-source.mjs.`
    );
  };
}

/**
 * Read one `export const NAME = <object literal>` out of a file by slicing its initializer and
 * evaluating THAT, rather than executing the module around it.
 *
 * `shell/status-bar.tsx` is a React component module — executing it means React, Radix and a DOM.
 * But `palette-actions.ts` needs exactly one constant from it (`THEME_OPTIONS`, the three theme
 * names), read at module scope. So the initializer expression is compiled on its own, with free
 * identifiers (the icons) supplied. An unsupported reference is a `ReferenceError` here, not a
 * wrong value downstream.
 */
function evaluateExportedConst(file, name) {
  const source = readSource(file);
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const initializer = findExportedConstInitializer(sourceFile, name);
  if (initializer === null) {
    throw new Error(`\`export const ${name}\` is gone from ${file}. The generator cannot proceed.`);
  }
  const expression = ts.transpileModule(`(${initializer.getText()})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(expression, iconMarkersFor(initializer));
}

/** The `<expr>` of a top-level `export const NAME = <expr>`, or null. */
function findExportedConstInitializer(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer ?? null;
      }
    }
  }
  return null;
}

/**
 * Every bare identifier inside a sliced initializer, bound to an icon marker — the only free names
 * a data constant may legitimately carry. A name that means something else resolves to a marker
 * object, which is visible in the output rather than silently `undefined`.
 */
function iconMarkersFor(node) {
  const names = {};
  const walk = child => {
    if (ts.isIdentifier(child)) names[child.text] = { lucideIcon: child.text };
    child.forEachChild(walk);
  };
  node.forEachChild(walk);
  return names;
}

/** Read a source file, asserting it is still there. §5.3: an empty reference page is the failure. */
function readSource(file) {
  if (!existsSync(file)) {
    throw new Error(
      `The reference generator's input is missing: ${file}\n` +
        `It reads the app's command data from ${RENDERER_SRC}. If those files moved, update ` +
        `SOURCE_FILES in docs-site/scripts/lib/app-source.mjs.`
    );
  }
  return readFileSync(file, 'utf8');
}

/** Resolve a relative specifier to a real file, trying the extensions the renderer omits. */
function resolveRelative(specifier, importer) {
  const base = resolve(dirname(importer), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base];
  const found = candidates.find(
    candidate => /\.tsx?$/.test(candidate) && existsSync(candidate) && !candidate.endsWith('.d.ts')
  );
  if (found === undefined) {
    throw new Error(`\`${specifier}\` (imported by ${importer}) resolved to no .ts/.tsx file.`);
  }
  return found;
}

/**
 * One platform pass: a module registry whose `load` transpiles and runs a renderer module inside
 * `context`, resolving imports through the rules at the top of this file.
 */
function createLoader(context, stubsByPath) {
  const cache = new Map();

  const load = file => {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    if (cache.size >= MAX_MODULES_PER_PASS) {
      throw new Error(
        `The reference generator loaded ${MAX_MODULES_PER_PASS} renderer modules, which means it ` +
          `is walking the app's dependency graph rather than reading data. Add a stub.`
      );
    }

    const js = ts.transpileModule(readSource(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;

    const moduleObject = { exports: {} };
    cache.set(file, moduleObject.exports);
    const factory = vm.runInContext(`(function (require, module, exports) {${js}\n})`, context, {
      filename: file,
    });
    factory(specifier => requireFrom(specifier, file), moduleObject, moduleObject.exports);
    cache.set(file, moduleObject.exports);
    return moduleObject.exports;
  };

  const requireFrom = (specifier, importer) => {
    if (!specifier.startsWith('.')) {
      const stub = BARE_STUBS[specifier];
      if (stub === undefined) {
        throw new Error(
          `The reference generator will not resolve the package \`${specifier}\` (imported by ` +
            `${importer}). Renderer packages are not part of the docs build.`
        );
      }
      return stub;
    }
    const file = resolveRelative(specifier, importer);
    return stubsByPath[file] ?? load(file);
  };

  return load;
}

/**
 * The renderer's command data, as the app itself computes it for one platform.
 *
 * `isMac` decides the `navigator.userAgent` the vm sees, which is the single input
 * `utils/platform.ts` reads — so `formatAcceleratorList` returns macOS glyphs or `Ctrl+Shift+E`
 * words from the same catalogue, with no second table anywhere.
 */
function loadForPlatform(isMac) {
  const userAgent = isMac
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const context = vm.createContext({ navigator: { userAgent } });

  const paths = Object.fromEntries(
    Object.entries(SOURCE_FILES).map(([key, relative]) => [key, resolve(RENDERER_SRC, relative)])
  );

  // Stubbed by absolute path: the two Zustand stores `palette-actions.ts` closes over, and the
  // status bar it takes three theme names from.
  const stubsByPath = {
    [resolve(RENDERER_SRC, 'state/settings.ts')]: { settingsStore: unreachable('settingsStore') },
    [resolve(RENDERER_SRC, 'state/tab.ts')]: {
      tabStore: unreachable('tabStore'),
      selectActiveTab: unreachable('selectActiveTab'),
    },
    [paths.statusBar]: { THEME_OPTIONS: evaluateExportedConst(paths.statusBar, 'THEME_OPTIONS') },
  };

  const load = createLoader(context, stubsByPath);
  return { catalogue: load(paths.catalogue), paletteActions: load(paths.paletteActions) };
}

/** The app's command data on both platforms it ships for. */
export function loadCommandSources() {
  return { mac: loadForPlatform(true), windows: loadForPlatform(false) };
}
