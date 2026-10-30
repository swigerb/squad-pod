export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolve file-observation names, slugs, suffixes and unambiguous first names.
 * Live-event matching must keep its separate exact-identity policy.
 */
export function resolveFileAgentId(
  raw: string,
  roster: ReadonlyMap<string, { id: string; name: string }>,
): string | null {
  const key = slugify(raw);
  if (!key) {
    return null;
  }
  if (roster.has(key)) {
    return key;
  }

  const all = Array.from(roster.values());
  const byName = all.filter(a => slugify(a.name) === key);
  if (byName.length === 1) {
    return byName[0].id;
  }

  const byPrefix = all
    .filter(a => key.startsWith(`${a.id}-`))
    .sort((a, b) => b.id.length - a.id.length);
  if (byPrefix.length > 0) {
    return byPrefix[0].id;
  }

  const byFirstName = all.filter(
    a => a.id.split('-')[0] === key || slugify(a.name).split('-')[0] === key,
  );
  if (byFirstName.length === 1) {
    return byFirstName[0].id;
  }
  return null;
}
