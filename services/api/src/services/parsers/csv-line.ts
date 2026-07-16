/**
 * Split one CSV line into fields, honouring double-quoted values (which may contain
 * the delimiter and doubled `""` quotes). Broker exports (IBKR, Coinbase) quote free-text
 * columns, so the generic comma-split isn't safe for them.
 *
 * @param delimiter - The field separator (default `,` for comma-CSV, use `;` for
 *                    semicolon-delimited formats like DKB).
 */
export function splitCsvLine(line: string, delimiter = ","): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}
