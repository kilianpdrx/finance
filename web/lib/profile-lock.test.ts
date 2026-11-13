import { describe, it, expect } from "vitest";
import { profileToUnlock, resolveActiveProfile, isValidPin, cleanPinInput } from "./profile-lock";

const KILIAN = { id: 1, is_default: true, has_pin: true };
const MAMAN = { id: 2, is_default: false, has_pin: false };
const PROFILES = [KILIAN, MAMAN];

describe("resolveActiveProfile", () => {
  it("is the stored profile, else the default, else the first", () => {
    expect(resolveActiveProfile(PROFILES, 2)).toBe(MAMAN);
    expect(resolveActiveProfile(PROFILES, null)).toBe(KILIAN);
    expect(resolveActiveProfile(PROFILES, 99)).toBe(KILIAN);
    expect(resolveActiveProfile([MAMAN], null)).toBe(MAMAN);
    expect(resolveActiveProfile([], 1)).toBeUndefined();
  });
});

describe("profileToUnlock", () => {
  it("asks for the PIN of the active profile when this tab has no token", () => {
    expect(profileToUnlock(PROFILES, 1, {}, null)).toBe(1);
    expect(profileToUnlock(PROFILES, null, {}, null)).toBe(1); // default profile
  });

  it("opens with a token", () => {
    expect(profileToUnlock(PROFILES, 1, { "1": "t" }, null)).toBeNull();
  });

  it("never asks for a profile without PIN", () => {
    expect(profileToUnlock(PROFILES, 2, {}, null)).toBeNull();
  });

  it("believes the API when it says the active profile is locked", () => {
    // PIN set in another tab: the cached list does not know yet.
    expect(profileToUnlock(PROFILES, 2, {}, 2)).toBe(2);
    // Before any profile is stored, requests go to the default one.
    expect(profileToUnlock([], null, {}, 1)).toBe(1);
  });

  it("ignores a lock reported for another profile", () => {
    expect(profileToUnlock(PROFILES, 2, {}, 1)).toBeNull();
  });
});

describe("PIN input", () => {
  it("accepts 4 to 8 digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });

  it("keeps only digits, at most 8", () => {
    expect(cleanPinInput("12 34-56")).toBe("123456");
    expect(cleanPinInput("1234567890")).toBe("12345678");
    expect(cleanPinInput("abc")).toBe("");
  });
});
