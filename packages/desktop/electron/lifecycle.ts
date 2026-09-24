let quitting = false;

export function beginQuit(): boolean {
  if (quitting) return false;
  quitting = true;
  return true;
}

export function isQuitting(): boolean {
  return quitting;
}
