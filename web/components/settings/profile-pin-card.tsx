"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinInput } from "@/components/profiles/pin-input";
import { useActiveProfile, useProfilePin } from "@/lib/api/hooks";
import { isValidPin } from "@/lib/profile-lock";

type Mode = "idle" | "set" | "change" | "remove";

/** Paramètres → Général: set, change or remove the active profile's PIN. */
export function ProfilePinCard() {
  const profile = useActiveProfile();
  const { setPin } = useProfilePin();
  const [mode, setMode] = useState<Mode>("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;
  const hasPin = !!profile.has_pin;

  const reset = () => {
    setMode("idle");
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const needsNew = mode === "set" || mode === "change";
  const needsCurrent = mode === "change" || mode === "remove";
  const mismatch = needsNew && confirm.length > 0 && confirm !== next;
  const ready =
    (!needsCurrent || isValidPin(current)) &&
    (!needsNew || (isValidPin(next) && next === confirm));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || setPin.isPending) return;
    setError(null);
    try {
      await setPin.mutateAsync({
        id: profile.id,
        pin: mode === "remove" ? null : next,
        currentPin: needsCurrent ? current : undefined,
      });
      toast.success(
        mode === "set" ? "Code PIN défini" : mode === "change" ? "Code PIN modifié" : "Code PIN retiré",
      );
      reset();
    } catch (err) {
      setCurrent("");
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {hasPin ? <Lock className="size-4 text-brand" /> : <LockOpen className="size-4 text-muted-foreground" />}
          Code PIN du profil
        </CardTitle>
        <CardDescription>
          Facultatif. Avec un code, ouvrir « {profile.name} » depuis un autre profil, après la fermeture de
          l&apos;onglet ou après un redémarrage de l&apos;application le demande.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-1.5 text-sm">
            {hasPin ? (
              <><ShieldCheck className="size-4 text-positive" /> Un code PIN protège ce profil.</>
            ) : (
              <span className="text-muted-foreground">Aucun code PIN : le profil s&apos;ouvre sans code.</span>
            )}
          </p>
          {mode === "idle" && (
            <div className="ml-auto flex gap-2">
              {hasPin ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setMode("change")}>Modifier le code</Button>
                  <Button variant="outline" size="sm" onClick={() => setMode("remove")}>Retirer le code</Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setMode("set")}>Définir un code PIN</Button>
              )}
            </div>
          )}
        </div>

        {mode !== "idle" && (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {needsCurrent && (
                <div className="space-y-1.5">
                  <Label htmlFor="pin-current">Code actuel</Label>
                  <PinInput id="pin-current" value={current} onValueChange={(v) => { setCurrent(v); setError(null); }} autoFocus />
                </div>
              )}
              {needsNew && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="pin-new">{mode === "change" ? "Nouveau code" : "Code PIN"}</Label>
                    <PinInput id="pin-new" value={next} onValueChange={(v) => { setNext(v); setError(null); }} autoFocus={mode === "set"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pin-confirm">Confirmer</Label>
                    <PinInput
                      id="pin-confirm"
                      value={confirm}
                      onValueChange={(v) => { setConfirm(v); setError(null); }}
                      aria-invalid={mismatch || undefined}
                    />
                  </div>
                </>
              )}
            </div>
            {needsNew && <p className="text-xs text-muted-foreground">4 à 8 chiffres.</p>}
            {mismatch && <p className="text-sm text-negative">Les deux codes ne sont pas identiques.</p>}
            {error && <p role="alert" className="text-sm text-negative">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={reset}>Annuler</Button>
              <Button
                type="submit"
                size="sm"
                variant={mode === "remove" ? "destructive" : "default"}
                disabled={!ready || setPin.isPending}
              >
                {mode === "set" ? "Définir le code" : mode === "change" ? "Changer le code" : "Retirer le code"}
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Ce que le code protège :</span> l&apos;accès à ce profil dans
            l&apos;application — son tableau de bord, ses comptes, ses transactions — et sa modification ou sa
            suppression. Après 5 codes faux, il faut attendre avant de réessayer.
          </p>
          <p>
            <span className="font-medium text-foreground">Ce qu&apos;il ne protège pas :</span> les données ne sont pas
            chiffrées. La sauvegarde (Sauvegarde &amp; Données) contient tous les profils, et quelqu&apos;un qui a accès
            aux fichiers de cet ordinateur peut lire la base. Un code oublié ne peut pas être retrouvé dans
            l&apos;application.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
