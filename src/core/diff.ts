// @covers AC-057
// 比較ビュー用の行単位の差分（LCS）。両側で共通でない行に changed を付ける
export type DiffLine = { text: string; changed: boolean };

export function diffLines(a: string, b: string): { left: DiffLine[]; right: DiffLine[] } {
  const x = a.split("\n");
  const y = b.split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const keepX = new Set<number>();
  const keepY = new Set<number>();
  for (let i = 0, j = 0; i < x.length && j < y.length; ) {
    if (x[i] === y[j]) {
      keepX.add(i++);
      keepY.add(j++);
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return {
    left: x.map((text, i) => ({ text, changed: !keepX.has(i) })),
    right: y.map((text, j) => ({ text, changed: !keepY.has(j) })),
  };
}
