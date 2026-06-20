// Tiny CSV helpers — RFC-4180-ish, good enough for product/supplier lists.

export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const cols = columns ?? Array.from(rows.reduce<Set<string>>((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set()));
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const str = String(v);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const header = cols.join(",");
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some(v => v.length > 0)) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); if (cur.some(v => v.length > 0)) rows.push(cur); }
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
}

export async function readFileText(file: File): Promise<string> {
  return await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result || ""));
    reader.onerror = () => rej(reader.error);
    reader.readAsText(file);
  });
}
