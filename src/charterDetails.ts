/** Rich descriptive fields parsed from charter text, excluding model declarations. */
export interface CharterDetails {
  charterSummary: string | null;
  expertise: string | null;
  responsibilities: string | null;
  boundaries: string | null;
}

/**
 * Parse existing rich charter fields from supplied text without reading files.
 * Missing or empty sections remain null; model declarations are parsed separately.
 */
export function parseCharterDetails(source: string): CharterDetails {
  let charterSummary: string | null = null;
  const lines = source.split(/\r?\n/);
  const titleIndex = lines.findIndex(line => /^\s*#\s+/.test(line));
  const paragraphLines: string[] = [];
  if (titleIndex >= 0) {
    let index = titleIndex + 1;
    while (index < lines.length && !lines[index].trim()) {
      index++;
    }
    while (index < lines.length && lines[index].trim() && !/^\s*#{1,6}\s+/.test(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index++;
    }
  }

  if (paragraphLines.length > 0) {
    const paragraph = paragraphLines.join(' ');
    const sentences = paragraph.split(/\.\s+/);
    charterSummary = sentences.slice(0, 3).join('. ');
    if (!charterSummary.endsWith('.')) {
      charterSummary += '.';
    }
  }
  const expertise = source.split(/\r?\n/).map(line => /^\s*[-*]\s+\*\*Expertise:\*\*\s*(.+)$/i.exec(line)?.[1]?.trim() ?? '')
    .find(Boolean) ?? null;
  return {
    charterSummary,
    expertise,
    responsibilities: extractDeclaredSection(source, ['Responsibilities', 'What I Own']),
    boundaries: extractDeclaredSection(source, ['Boundaries']),
  };
}

function extractDeclaredSection(source: string, headings: string[]): string | null {
  const lines = source.split(/\r?\n/);
  const heading = new RegExp(`^#{1,6}\\s+(?:${headings.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*#*\\s*$`, 'i');
  const start = lines.findIndex(line => heading.test(line.trim()));
  if (start < 0) {return null;}
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) {break;}
    if (line.trim()) {section.push(line.trim());}
  }
  const text = section.join('\n').trim();
  return text ? text.slice(0, 4096) : null;
}
