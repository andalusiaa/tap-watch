// Minimal CSV read/write (RFC 4180 style) so the seed scripts need no packages.

/** @param {unknown} value */
function cell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {string[]} columns
 * @param {Record<string, unknown>[]} rows
 */
export function toCsv(columns, rows) {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Parses CSV text into objects keyed by the header row.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header = [], ...body] = records.filter((r) => r.some((f) => f.trim() !== ''));
  const columns = header.map((h) => h.trim().replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()])));
}
