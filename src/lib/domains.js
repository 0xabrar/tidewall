// Pure helpers — no chrome APIs. Normalizes user input to a registrable host.

function parseUrlLike(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s); } catch { return null; }
}

function normalizeHost(host) {
  if (typeof host !== "string") return null;
  let h = host.trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
  return h;
}

export function normalizeDomain(input) {
  const url = parseUrlLike(input);
  return url ? normalizeHost(url.hostname) : null;
}
export function isValidDomain(input) {
  return normalizeDomain(input) !== null;
}
