/**
 * PROPOSAL §2.3, re-measured in the browser from the values the theme actually
 * resolved. The `proposal` column is what the audit recorded, so a drift shows up as a
 * mismatch rather than as a stale comment.
 */

import { useEffect, useMemo } from 'react';

import { measurePair, type MeasuredPair, type PairSpec } from './contrast';

const VERDICT_LABEL: Readonly<Record<MeasuredPair['verdict'], string>> = {
  'aa-body': 'AA body',
  'aa-large': 'AA large / UI',
  fail: 'fail',
};

const VERDICT_CLASS: Readonly<Record<MeasuredPair['verdict'], string>> = {
  'aa-body': 'text-success',
  'aa-large': 'text-warning',
  fail: 'text-danger',
};

export function ContrastTable({
  caption,
  pairs,
  themeKey,
}: {
  caption: string;
  pairs: readonly PairSpec[];
  themeKey: string;
}) {
  // Measured during render for the same reason as useResolvedTokens: the DOM read is
  // idempotent and `data-theme` is already current by the time this render runs.
  const { rows, unmeasurable, measuredUnder } = useMemo(() => {
    const root = document.documentElement;
    const measured: MeasuredPair[] = [];
    const failures: string[] = [];
    for (const pair of pairs) {
      try {
        measured.push(measurePair(pair, root));
      } catch (error) {
        failures.push(`${pair.label} (${String(error)})`);
      }
    }
    // themeKey is carried through, not merely depended on — see useResolvedTokens.
    return { rows: measured, unmeasurable: failures, measuredUnder: themeKey };
  }, [pairs, themeKey]);

  // Measuring nothing means no stylesheet is attached (jsdom, or a build that lost
  // theme.css) and the table has nothing to say. A partial failure is a real theme.css
  // bug and gets reported.
  const partial = unmeasurable.length > 0 && rows.length > 0;
  useEffect(() => {
    if (!partial) return;
    // eslint-disable-next-line no-console
    console.error('[joinery] could not measure:', unmeasurable.join('; '));
  }, [partial, unmeasurable]);

  return (
    // Tables sit directly on the background with horizontal row rules only, and the
    // wrapper only exists so a narrow dock panel scrolls the table instead of the page.
    <div className="-my-2 overflow-x-auto whitespace-nowrap">
      <div className="inline-block min-w-full py-2 align-middle">
        <table data-measured-under={measuredUnder} className="w-full text-left">
          <caption className="pb-2 text-left text-sm text-fg-muted">{caption}</caption>
          <thead>
            <tr className="border-b border-rule-strong">
              <th className="py-1 pr-6 text-sm font-medium whitespace-nowrap text-fg-muted">
                Pair
              </th>
              <th className="py-1 pr-6 text-sm font-medium whitespace-nowrap text-fg-muted">
                Resolved
              </th>
              <th className="py-1 pr-6 text-sm font-medium whitespace-nowrap text-fg-muted">
                Measured
              </th>
              <th className="py-1 pr-6 text-sm font-medium whitespace-nowrap text-fg-muted">
                §2.3
              </th>
              <th className="py-1 text-sm font-medium whitespace-nowrap text-fg-muted">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {rows.map(row => (
              <tr
                key={row.label}
                data-testid="contrast-row"
                data-pair={row.label}
                data-ratio={row.ratio.toFixed(2)}
                data-verdict={row.verdict}
              >
                <td className="py-1.5 pr-6 align-top">
                  <p className="text-sm text-fg">{row.label}</p>
                  {row.note === undefined ? null : (
                    <p className="text-2xs text-fg-muted">{row.note}</p>
                  )}
                </td>
                <td className="py-1.5 pr-6 font-mono text-2xs text-fg-subtle">
                  {row.foreground} on {row.background}
                </td>
                <td className="py-1.5 pr-6 font-mono text-sm tabular-nums text-fg">
                  {row.ratio.toFixed(2)}:1
                </td>
                <td className="py-1.5 pr-6 font-mono text-sm tabular-nums text-fg-subtle">
                  {row.proposal === undefined ? '—' : `${row.proposal.toFixed(2)}:1`}
                </td>
                <td className={`py-1.5 text-sm ${VERDICT_CLASS[row.verdict]}`}>
                  {VERDICT_LABEL[row.verdict]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
