/** Which profile the interface must ask a PIN for, if any (see backend
 *  services/profile_pin.py: the API refuses a profile with a PIN without a token). */

export interface LockableProfile {
  id: number;
  is_default: boolean;
  has_pin?: boolean;
}

/** The profile the app opens on: the stored one, else the default, else the first. */
export function resolveActiveProfile<P extends LockableProfile>(profiles: P[], activeId: number | null): P | undefined {
  const stored = activeId != null ? profiles.find((p) => p.id === activeId) : undefined;
  return stored ?? profiles.find((p) => p.is_default) ?? profiles[0];
}

/**
 * The id of the profile to unlock before showing anything, or null.
 *
 * - the active profile has a PIN and this tab holds no token for it;
 * - or the API said the active profile is locked (`lockedId`): trust it even
 *   when the cached list does not know about the PIN yet (set in another tab).
 *   With no active id stored yet, requests go to the default profile, so a lock
 *   reported then is the one that matters.
 */
export function profileToUnlock(
  profiles: LockableProfile[],
  activeId: number | null,
  tokens: Record<string, string>,
  lockedId: number | null,
): number | null {
  const active = resolveActiveProfile(profiles, activeId);
  if (active?.has_pin && !tokens[String(active.id)]) return active.id;
  if (lockedId != null && (activeId == null || lockedId === activeId || active?.id === lockedId)) return lockedId;
  return null;
}

/** 4 to 8 digits — the backend's rule, checked here only to answer sooner. */
export function isValidPin(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin);
}

/** What a PIN field keeps of what was typed or pasted: digits, at most 8. */
export function cleanPinInput(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 8);
}
