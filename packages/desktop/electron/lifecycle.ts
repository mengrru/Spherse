let quitting = false;
let updateQuit = false;

export function beginQuit(): boolean {
  if (quitting) return false;
  quitting = true;
  return true;
}

export function isQuitting(): boolean {
  return quitting;
}

export function beginUpdateQuit(): boolean {
  if (updateQuit) return false;
  updateQuit = true;
  quitting = true;
  return true;
}

export function isUpdateQuit(): boolean {
  return updateQuit;
}
