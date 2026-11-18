// CSV untuk Excel locale Indonesia: pemisah `;` + BOM UTF-8, karena Excel ID
// memakai `;` sebagai list separator (koma membuat semua kolom jadi satu sel).
export function downloadCsv(
  filename: string,
  rows: (string | number | null | undefined)[][]
) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
