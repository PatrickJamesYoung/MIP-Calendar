/**
 * Line-level diff for the wiki history viewer.
 *
 * Uses the standard LCS table approach. Fine for admin-scale wiki pages
 * (dozens of KB, ~hundreds of lines). If pages ever balloon into thousands
 * of lines this can be swapped for Myers without changing callers.
 */

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffLine {
  op: DiffOp;
  /** 1-indexed line number in the "old" version (null for inserts). */
  oldLineNo: number | null;
  /** 1-indexed line number in the "new" version (null for deletes). */
  newLineNo: number | null;
  text: string;
}

function splitLines(s: string): string[] {
  // Normalize CRLF, keep an empty trailing line so we don't lose it.
  return s.replace(/\r\n/g, "\n").split("\n");
}

function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * Compute a line-level diff. `oldText` is the earlier version, `newText`
 * is the later one. Returned lines are in output order:
 *   - "equal"  present in both
 *   - "delete" only in old
 *   - "insert" only in new
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const dp = lcsTable(a, b);

  const out: DiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ op: "equal", oldLineNo: i, newLineNo: j, text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ op: "delete", oldLineNo: i, newLineNo: null, text: a[i - 1] });
      i--;
    } else {
      out.push({ op: "insert", oldLineNo: null, newLineNo: j, text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ op: "delete", oldLineNo: i, newLineNo: null, text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ op: "insert", oldLineNo: null, newLineNo: j, text: b[j - 1] });
    j--;
  }

  return out.reverse();
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === "insert") added++;
    else if (l.op === "delete") removed++;
  }
  return { added, removed };
}
