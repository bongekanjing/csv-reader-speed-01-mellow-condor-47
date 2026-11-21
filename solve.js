// solve.js — csv-reader 1.0.0's reading, done faster.
//
// The house reader walks the text one character at a time, making every
// character its own one-character string and concatenating it onto the field,
// and hands each field's ending back as a freshly allocated object. This reader
// keeps csv-reader's reading exactly and changes only how the work is done: it
// finds the end of each field's run of ordinary characters and takes the field
// out as one slice of the text, and it reports a field's ending through the
// closure's own variable rather than an object per field.
//
// The common field — no quote, no doubled quote, no line break inside, one run
// of characters — is returned as the slice itself, never as a cons string
// built by appending to an empty one, so the answer's strings stay flat for the
// serializer that reads them next.
//
// The reading, restated so the code below can be checked against it:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote and each CRLF or lone CR inside it read as
//     LF; what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with empty strings (short_row, fields: its
//     field count) or cut (long_row, extra: the cut fields) to the first record's
//     width;
//   - each error is {code, line, row} in the order met, line the 1-based line its
//     record starts on, counting every LF, CRLF and lone CR inside quotes, and
//     row its record's index in rows, null for the header.

const CH_COMMA = 44;
const CH_LF = 10;
const CH_CR = 13;
const CH_QUOTE = 34;
const CH_BOM = 0xfeff;

/** A field ended at a comma: the record goes on. */
const COMMA = 1;
/** A field ended at a line break or the end of the text: the record is over. */
const ENDED = 2;

/** One CSV input {text, header} read into {columns, rows, errors}. */
export function readCsv(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len !== 0 && text.charCodeAt(0) === CH_BOM) pos = 1;

  // The line and row an error of the record being read is reported at.
  let recLine = 1;
  let recRow = null;

  // How the field just read ended, and whether it took any characters of its
  // own off the text (which is what tells a quoted field's junk apart).
  let ended = ENDED;
  let kept = 0;

  function pushError(code, key, value) {
    const e = { code: code, line: recLine, row: recRow };
    if (key !== undefined) e[key] = value;
    errors.push(e);
  }

  // Reads an unquoted field from pos, onto base. Returns the field and leaves
  // `ended` and `kept`. A field with one run of characters and no base is the
  // slice itself, which stays flat instead of becoming a cons string.
  function readUnquoted(base) {
    let p = pos;
    const s = p;
    while (p < len) {
      const c = text.charCodeAt(p);
      if (c === CH_COMMA || c === CH_LF || c === CH_CR) break;
      p += 1;
    }
    let out;
    if (p < len && text.charCodeAt(p) === CH_CR && !(p + 1 < len && text.charCodeAt(p + 1) === CH_LF)) {
      // A stray CR ends this run: what follows is read again, the CR dropped.
      pushError('stray_cr');
      kept = p - s;
      out = base.length === 0 ? text.slice(s, p) : base + text.slice(s, p);
      pos = p + 1;
      return readStrayTail(out, kept);
    }
    kept = p - s;
    out = base.length === 0 ? text.slice(s, p) : base + text.slice(s, p);
    if (p >= len) {
      pos = len;
      ended = ENDED;
      return out;
    }
    const c = text.charCodeAt(p);
    if (c === CH_COMMA) {
      pos = p + 1;
      ended = COMMA;
      return out;
    }
    if (c === CH_LF) {
      pos = p + 1;
      line += 1;
      ended = ENDED;
      return out;
    }
    // A CR followed by LF ends the record.
    pos = p + 2;
    line += 1;
    ended = ENDED;
    return out;
  }

  // Carries on an unquoted field after a stray CR was dropped.
  function readStrayTail(head, alreadyKept) {
    let out = head;
    let p = pos;
    for (;;) {
      const s = p;
      while (p < len) {
        const c = text.charCodeAt(p);
        if (c === CH_COMMA || c === CH_LF || c === CH_CR) break;
        p += 1;
      }
      if (p !== s) {
        out += text.slice(s, p);
        alreadyKept += p - s;
      }
      if (p >= len) {
        pos = len;
        kept = alreadyKept;
        ended = ENDED;
        return out;
      }
      const c = text.charCodeAt(p);
      if (c === CH_COMMA) {
        pos = p + 1;
        kept = alreadyKept;
        ended = COMMA;
        return out;
      }
      if (c === CH_LF) {
        pos = p + 1;
        line += 1;
        kept = alreadyKept;
        ended = ENDED;
        return out;
      }
      if (p + 1 < len && text.charCodeAt(p + 1) === CH_LF) {
        pos = p + 2;
        line += 1;
        kept = alreadyKept;
        ended = ENDED;
        return out;
      }
      pushError('stray_cr');
      p += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field and
  // leaves `ended`; no object per field.
  function readQuoted() {
    const open = pos;
    const openLine = line;

    let out = null;
    let p = open + 1;
    let q;
    let value;

    for (;;) {
      q = p;
      while (q < len) {
        const c = text.charCodeAt(q);
        if (c === CH_QUOTE || c === CH_LF || c === CH_CR) break;
        q += 1;
      }
      if (q >= len) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        return readUnquoted('"');
      }
      const c = text.charCodeAt(q);
      if (c === CH_LF) {
        out = out === null ? text.slice(p, q) : out + text.slice(p, q);
        out += '\n';
        line += 1;
        p = q + 1;
        continue;
      }
      if (c === CH_CR) {
        // CRLF and a lone CR inside quotes are each one LF.
        out = out === null ? text.slice(p, q) : out + text.slice(p, q);
        out += '\n';
        line += 1;
        p = q + 1 < len && text.charCodeAt(q + 1) === CH_LF ? q + 2 : q + 1;
        continue;
      }
      // A doubled quote is one quote; any other quote closes the field.
      if (q + 1 < len && text.charCodeAt(q + 1) === CH_QUOTE) {
        out = out === null ? text.slice(p, q) : out + text.slice(p, q);
        out += '"';
        p = q + 2;
        continue;
      }
      value = out === null ? text.slice(p, q) : out + text.slice(p, q);
      pos = q + 1;
      break;
    }

    // What follows the closing quote: a comma carries the record on, a line
    // break or the end of the text ends it, and anything else is appended as it
    // stands (quote_junk).
    if (pos >= len) {
      ended = ENDED;
      return value;
    }
    const c2 = text.charCodeAt(pos);
    if (c2 === CH_COMMA) {
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (c2 === CH_LF) {
      pos += 1;
      line += 1;
      ended = ENDED;
      return value;
    }
    if (c2 === CH_CR && pos + 1 < len && text.charCodeAt(pos + 1) === CH_LF) {
      pos += 2;
      line += 1;
      ended = ENDED;
      return value;
    }
    const junk = readUnquoted(value);
    if (kept > 0) pushError('quote_junk');
    return junk;
  }

  for (;;) {
    // A line left with no characters is no record.
    if (pos >= len) break;
    const first = text.charCodeAt(pos);
    if (first === CH_LF) {
      pos += 1;
      line += 1;
      continue;
    }
    if (first === CH_CR && pos + 1 < len && text.charCodeAt(pos + 1) === CH_LF) {
      pos += 2;
      line += 1;
      continue;
    }

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted;
    for (;;) {
      quoted = text.charCodeAt(pos) === CH_QUOTE;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    const n = fields.length;
    if (width < 0) width = n;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (n < width) {
      pushError('short_row', 'fields', n);
      for (let i = n; i < width; i += 1) fields.push('');
    } else if (n > width) {
      pushError('long_row', 'extra', fields.splice(width));
    }
    rows.push(fields);
  }

  return { columns: header ? columns ?? [] : null, rows: rows, errors: errors };
}

/** The entry's run: csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  return readCsv(input);
}
