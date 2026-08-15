/**
 * Proof that the three brand faces are really loading. The audit (PROPOSAL §1.5) found
 * Instrument Sans and IBM Plex Mono already being *requested* by the Angular renderer
 * and silently falling back to Inter, so "the CSS names the font" is not evidence.
 * `document.fonts.check()` is.
 */

import { useEffect, useState } from 'react';

interface FaceSpec {
  readonly role: string;
  readonly testId: string;
  /** A CSS `font` shorthand, which is what FontFaceSet.check() parses. */
  readonly shorthand: string;
  readonly family: string;
  readonly sampleClass: string;
}

const FACES: readonly FaceSpec[] = [
  {
    role: 'display',
    testId: 'font-status-display',
    shorthand: '800 16px "Archivo Variable"',
    family: 'Archivo Variable',
    sampleClass: 'font-display text-xl',
  },
  {
    role: 'interface',
    testId: 'font-status-interface',
    shorthand: '400 16px "Instrument Sans Variable"',
    family: 'Instrument Sans Variable',
    sampleClass: 'font-sans text-lg',
  },
  {
    role: 'technical',
    testId: 'font-status-technical',
    shorthand: '500 16px "IBM Plex Mono"',
    family: 'IBM Plex Mono',
    sampleClass: 'font-mono text-md',
  },
];

const SAMPLE = 'Joinery 0123 fitted';

export function FontStatus() {
  const [loaded, setLoaded] = useState<Readonly<Record<string, boolean>>>({});

  useEffect(() => {
    let live = true;
    // load() before check(): check() answers "is it loaded *now*", so asking before the
    // face has been requested reports a false negative rather than a real failure.
    const settled = FACES.map(async face => {
      try {
        await document.fonts.load(face.shorthand, SAMPLE);
      } catch (error) {
        // A rejected load is exactly the silent fallback this component exists to catch.
        // eslint-disable-next-line no-console
        console.warn(`[joinery] ${face.family} failed to load:`, error);
      }
      return [face.role, document.fonts.check(face.shorthand, SAMPLE)] as const;
    });

    void Promise.all(settled).then(entries => {
      if (live) setLoaded(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {FACES.map(face => {
        const isLoaded = loaded[face.role] ?? false;
        return (
          <li
            key={face.role}
            data-testid={face.testId}
            data-font-family={face.family}
            data-loaded={isLoaded}
            className="flex items-baseline justify-between gap-6 py-3"
          >
            <div className="min-w-0">
              <p className="font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
                {face.role} · {face.family}
              </p>
              <p className={`${face.sampleClass} truncate text-fg`}>{SAMPLE}</p>
            </div>
            <p
              className={`shrink-0 font-mono text-xs ${isLoaded ? 'text-success' : 'text-danger'}`}
            >
              {isLoaded ? 'loaded' : 'FALLBACK'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
