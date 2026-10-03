// Pure mail-merge renderer for user-editable message templates. Mirrored
// client-side in pages/MessageTemplates.tsx for live previews.
//
// Tokens look like {{name}}; whitespace inside the braces is tolerated. A
// token whose key exists in `vars` is replaced (null/undefined becomes an
// empty string — the intent of a blank value). An UNKNOWN token is left
// untouched, so a typo like {{nmae}} stays visible in the preview and in the
// sent message instead of silently vanishing.

export type MergeVars = Record<string, string | number | null | undefined>;

const MERGE_TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export function renderMergeFields(text: string, vars: MergeVars): string {
  return text.replace(MERGE_TOKEN, (match, token: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, token)) return match;
    const value = vars[token];
    return value === null || value === undefined ? '' : String(value);
  });
}

export function listMergeTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(MERGE_TOKEN)) tokens.add(match[1]);
  return [...tokens];
}