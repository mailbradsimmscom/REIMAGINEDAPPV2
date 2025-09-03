export function joinUrl(base, path = '') {
  // Robust join that avoids double slashes
  return new URL(path, base).toString().replace(/(?<!:)\/{2,}/g, '/');
}
