// @covers AC-027, AC-033
// @assumption AS-012
// ノート本文を検索用のチャンクに分割する。見出し単位で区切り、長い節は最大800文字・前後100文字の重なりで分ける。
// 先頭チャンクにはタイトルを含め、タイトルでも検索に当たるようにする。
export const CHUNK_MAX = 800;
export const CHUNK_OVERLAP = 100;

export function chunkNote(title: string, body: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    if (/^#{1,6}\s/.test(line) && current.join("\n").trim() !== "") {
      sections.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
  }
  if (current.join("\n").trim() !== "") sections.push(current.join("\n").trim());

  const chunks: string[] = [];
  for (const section of sections.length > 0 ? sections : [""]) {
    const chars = [...section];
    if (chars.length <= CHUNK_MAX) {
      chunks.push(section);
      continue;
    }
    for (let start = 0; start < chars.length; start += CHUNK_MAX - CHUNK_OVERLAP) {
      chunks.push(chars.slice(start, start + CHUNK_MAX).join(""));
      if (start + CHUNK_MAX >= chars.length) break;
    }
  }
  chunks[0] = chunks[0] ? `# ${title}\n\n${chunks[0]}` : `# ${title}`;
  return chunks;
}
