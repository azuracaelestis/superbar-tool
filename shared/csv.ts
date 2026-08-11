// Minimal RFC4180-ish CSV parser -- Excel exports quote fields containing commas/quotes/newlines
// ("" escapes an embedded quote), which a naive split(',') would mangle.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Final field/row, unless the input ended cleanly on a newline (which already pushed one).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_CANDIDATES = ['text', 'name', 'title', 'label'];

// If row 0 has a cell matching one of HEADER_CANDIDATES, treat row 0 as a header and read that
// column from every following row; otherwise every row (including row 0) is data, column 0.
// Blank rows/cells are skipped -- a trailing empty line in an Excel export shouldn't produce a
// bar named "".
export function extractTextColumn(rows: string[][]): string[] {
  if (rows.length === 0) return [];

  let startRow = 0;
  let colIndex = 0;
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const matchIndex = header.findIndex((c) => HEADER_CANDIDATES.includes(c));
  if (matchIndex !== -1) {
    startRow = 1;
    colIndex = matchIndex;
  }

  const out: string[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const value = (rows[i][colIndex] ?? '').trim();
    if (value.length > 0) out.push(value);
  }
  return out;
}
