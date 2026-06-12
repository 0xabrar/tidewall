// Pure helpers — no chrome APIs. Normalizes user input to a registrable host.
export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = "https://" + s;
  let host;
  try { host = new URL(s).hostname; } catch { return null; }
  if (host.startsWith("www.")) host = host.slice(4);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}
export function isValidDomain(input) {
  return normalizeDomain(input) !== null;
}
