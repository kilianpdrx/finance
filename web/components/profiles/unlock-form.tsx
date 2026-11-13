"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProfilePin } from "@/lib/api/hooks";
import { isValidPin } from "@/lib/profile-lock";
import { PinInput } from "./pin-input";

/** Type the profile's PIN; `onUnlocked` runs once the token is stored. */
export function UnlockForm({ profileId, profileName, onUnlocked, autoFocus = true }: {
  profileId: number;
  profileName: string;
  onUnlocked: () => void;
  autoFocus?: boolean;
}) {
  const { unlock } = useProfilePin();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPin(pin) || unlock.isPending) return;
    setError(null);
    try {
      await unlock.mutateAsync({ id: profileId, pin });
      setPin("");
      onUnlocked();
    } catch (err) {
      setPin("");
      setError(err instanceof Error ? err.message : "Déverrouillage impossible.");
      inputRef.current?.focus();
    }
  };

  const errorId = `pin-error-${profileId}`;
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="sr-only" htmlFor={`pin-${profileId}`}>Code PIN de {profileName}</label>
      <PinInput
        id={`pin-${profileId}`}
        ref={inputRef}
        value={pin}
        onValueChange={(v) => { setPin(v); setError(null); }}
        placeholder="Code PIN"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-11 text-center text-lg"
      />
      {error && <p id={errorId} role="alert" className="text-sm text-negative">{error}</p>}
      <Button type="submit" className="w-full" disabled={!isValidPin(pin) || unlock.isPending}>
        <LockKeyhole className="mr-1.5 size-4" />
        {unlock.isPending ? "Vérification…" : "Déverrouiller"}
      </Button>
    </form>
  );
}
