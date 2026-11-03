import { describe, expect, it } from 'vitest';
import { parseCharterDetails } from './charterDetails.js';

const emptyDetails = {
  charterSummary: null, expertise: null, responsibilities: null, boundaries: null,
};

describe('parseCharterDetails', () => {
  it.each(['\n', '\r\n'])('parses rich fields with %j line endings', newline => {
    const source = [
      '# Ada',
      '',
      'First sentence. Second sentence.',
      'Third sentence. Fourth sentence.',
      '',
      '## Identity',
      '- **Expertise:** TypeScript, parsing',
      '## What I Own',
      '  - Extension host  ',
      '',
      '- Message protocol',
      '## Boundaries',
      '**I handle:** Parsing',
      '**I do not handle:** Rendering',
      '## Model',
      '- **Preferred:** auto',
    ].join(newline);
    expect(parseCharterDetails(source)).toEqual({
      charterSummary: 'First sentence. Second sentence. Third sentence.',
      expertise: 'TypeScript, parsing',
      responsibilities: '- Extension host\n- Message protocol',
      boundaries: '**I handle:** Parsing\n**I do not handle:** Rendering',
    });
  });

  it('accepts case-insensitive headings, closing hashes and star expertise bullets', () => {
    expect(parseCharterDetails([
      '# Ada', '', 'A short summary', '', '* **expertise:**  Parsing  ',
      '  ### rEsPoNsIbIlItIeS ###  ', '  - Own this  ',
      '###### bOuNdArIeS ##', ' Stay scoped ', '# Next', 'Not boundaries',
    ].join('\n'))).toEqual({
      charterSummary: 'A short summary.',
      expertise: 'Parsing',
      responsibilities: '- Own this',
      boundaries: 'Stay scoped',
    });
  });

  it('uses the first matching alias and ends sections at any heading level', () => {
    expect(parseCharterDetails([
      '## What I Own', '- First', '### Nested', 'Not included',
      '## Responsibilities', '- Second', '## Boundaries', 'First boundary',
      '## Boundaries', 'Second boundary',
    ].join('\n'))).toEqual({
      ...emptyDetails, responsibilities: '- First', boundaries: 'First boundary',
    });
  });

  it.each([
    '',
    'Plain text without a title.',
    '# Ada\n\n## Responsibilities\n\n## Boundaries\n  ',
    '#Ada\n##Responsibilities\n- Not a section\n####### Boundaries\nNot a section',
    '## Responsibilities extra\nNot a section\n## Boundaries extra\nNot a section',
  ])('keeps absent, empty or malformed fields null: %j', source => {
    expect(parseCharterDetails(source)).toEqual(emptyDetails);
  });

  it('does not skip a heading or blank paragraph to invent a later summary', () => {
    expect(parseCharterDetails('# Ada\n\n## Identity\nLater prose.').charterSummary).toBeNull();
    expect(parseCharterDetails('# Ada\n\nFirst paragraph.\n\nLater prose.').charterSummary)
      .toBe('First paragraph.');
    expect(parseCharterDetails('# Ada\n\n## Identity\n# Later title\n\nLater prose.').charterSummary)
      .toBeNull();
  });

  it('preserves existing summary punctuation and blockquote handling', () => {
    expect(parseCharterDetails('# Ada\n\n> A quote!').charterSummary).toBe('> A quote!.');
    expect(parseCharterDetails('# Ada\n\nAlready punctuated.').charterSummary).toBe('Already punctuated.');
  });

  it('selects the first nonempty expertise bullet, not plain or empty fields', () => {
    expect(parseCharterDetails([
      '**Expertise:** Not a bullet', '- **Expertise:**   ',
      '* **Expertise:** First', '- **Expertise:** Second',
    ].join('\n'))).toEqual({ ...emptyDetails, expertise: 'First' });
  });

  it('bounds each descriptive section to 4096 characters independently', () => {
    expect(parseCharterDetails(`## Responsibilities\n${'r'.repeat(4100)}\n## Boundaries\n${'b'.repeat(4100)}`))
      .toEqual({ ...emptyDetails, responsibilities: 'r'.repeat(4096), boundaries: 'b'.repeat(4096) });
  });

  it('leaves model declarations outside the descriptive result', () => {
    expect(parseCharterDetails('## Model\n- **Preferred:** auto\n- **Fallback:** other')).toEqual(emptyDetails);
  });
});
