// Name similarity for voice-transcribed queries. Spoken tenant names arrive
// misheard ("Peter Otino" for Peter Otieno, "Wanjiku" for Wanjiru) — exact
// and substring matching miss them all. Jaro-Winkler with token averaging:
// full-name closeness OR every query word close to some name word. Pure
// functions, no dependencies, no database.
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = Array.from({ length: a.length }, () => false);
  const bFlags = Array.from({ length: b.length }, () => false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bFlags[j] && a[i] === b[j]) {
        aFlags[i] = true;
        bFlags[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

function tokens(s: string): string[] {
  return s.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * Similarity of a (possibly misheard) query against a tenant name, 0–1.
 * Best of full-string closeness and per-token averaging, so both "Peter
 * Otino" and a lone "Otino" still find Peter Otieno, while unrelated names
 * score low. Queries under 3 characters always score 0 (too little signal).
 */
export function nameSimilarity(query: string, target: string): number {
  const q = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const t = target.toLowerCase().trim().replace(/\s+/g, ' ');
  if (q.length < 3 || t.length === 0) return 0;
  const full = jaroWinkler(q, t);
  const qTokens = tokens(q);
  const tTokens = tokens(t);
  const avg =
    qTokens.reduce((sum, qt) => sum + Math.max(...tTokens.map((tt) => jaroWinkler(qt, tt))), 0) /
    qTokens.length;
  return Math.max(full, avg);
}

/** Top matches at or above `threshold`, best first. Empty when nothing is close. */
export function bestMatches<T>(query: string, candidates: T[], pickName: (c: T) => string, limit = 3, threshold = 0.7): { candidate: T; score: number }[] {
  return candidates
    .map((candidate) => ({ candidate, score: nameSimilarity(query, pickName(candidate)) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
