"use client";

import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, useSettingMutation, useActiveProfile, useProfileMutations, useAppVersion } from "@/lib/api/hooks";
import { CURRENCIES } from "@/lib/format";
import { DEFAULT_MODULES } from "@/lib/nav";
import { TrendingUp, Wallet, Check, Target, BadgeMinus, Info, ShieldAlert, type LucideIcon } from "lucide-react";

const TOGGLEABLE_MODULES: { key: string; icon: LucideIcon; title: string; description: string }[] = [
  { key: "budgeting", icon: Wallet, title: "Budget & Prévisions", description: "Budgets mensuels par catégorie et suivi des dépenses récurrentes." },
  { key: "investments", icon: TrendingUp, title: "Investissements & Bourse", description: "Portefeuille d'actions, ETF, dividendes, synchro IBKR et cours en direct." },
  { key: "goals", icon: Target, title: "Objectifs d'épargne", description: "Objectifs avec contributions manuelles ou compte lié, et suivi de progression." },
  { key: "loans", icon: BadgeMinus, title: "Emprunts & Dettes", description: "Prêts amortis : capital restant, échéancier, intérêts et paiements anticipés." },
];


export function GeneralTab() {
  const { data: settings } = useSettings();
  const mutation = useSettingMutation();
  const activeProfile = useActiveProfile();
  const profileMutations = useProfileMutations();
  const baseCurrency = settings?.base_currency ?? "CHF";

  const enabledModules = activeProfile?.enabled_modules ?? DEFAULT_MODULES;

  const onCurrencyChange = (value: string) => {
    mutation.mutate(
      { key: "base_currency", value },
      { onSuccess: () => toast.success("Devise de base mise à jour") },
    );
  };

  const toggleModule = (moduleKey: string) => {
    if (!activeProfile) return;
    const isEnabled = enabledModules.includes(moduleKey);
    const nextModules = isEnabled
      ? enabledModules.filter((m) => m !== moduleKey)
      : [...enabledModules, moduleKey];

    profileMutations.update.mutate(
      { id: activeProfile.id, body: { enabled_modules: nextModules } },
      { onSuccess: () => toast.success("Modules du profil mis à jour") },
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Section 1: Devise ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Devise de base</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tous les montants dans les analyses et le tableau de bord seront convertis dans cette devise.
          </p>
          <div className="max-w-xs space-y-1">
            <Label>Devise</Label>
            <Select value={baseCurrency} onValueChange={onCurrencyChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.symbol} — {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Modules du profil ────────────────────────────────── */}
      {activeProfile && (
        <Card>
          <CardHeader>
            <CardTitle>Modules & Fonctionnalités</CardTitle>
            <CardDescription>
              Personnalisez les fonctionnalités actives pour le profil <strong className="text-foreground">{activeProfile.name}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Module 1: Core Banking (Fixed) */}
            <div className="flex items-center justify-between rounded-xl border border-border p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Check className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Gestion bancaire & Transactions</p>
                  <p className="text-xs text-muted-foreground">Comptes courants, épargne, catégories et importation CSV.</p>
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-md">Toujours actif</span>
            </div>

            {/* Toggleable modules */}
            {TOGGLEABLE_MODULES.map((m) => {
              const on = enabledModules.includes(m.key);
              const Icon = m.icon;
              return (
                <div key={m.key} className="flex items-center justify-between rounded-xl border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleModule(m.key)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${on ? "bg-brand" : "bg-muted"}`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? "translate-x-5" : "translate-x-0"}`}
                    />
                  </button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Section 3: À propos ─────────────────────────────────────────── */}
      <AboutCard />
    </div>
  );
}

/** Version + how to update. Gives a bug report something to name, and puts the
 *  "sauvegardez d'abord" reminder where the update instructions are — the
 *  migrations only run forwards, so a backup is the only way back. */
function AboutCard() {
  const { data: info } = useAppVersion();
  const version = info?.version ?? "…";
  const isContainer = info?.is_container ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>À propos</CardTitle>
        <CardDescription>Version installée et mise à jour.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Info className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              Version <span className="font-mono">{version}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {version === "dev"
                ? "Version de développement (lancée depuis les sources)."
                : "Indiquez ce numéro si vous signalez un problème."}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-semibold">Mettre à jour</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isContainer ? (
              <>
                Fermez l&apos;application (<span className="font-mono">Arrêter</span>), puis
                relancez-la avec <span className="font-mono">Finance</span>. La dernière
                version est téléchargée automatiquement au démarrage.
              </>
            ) : (
              <>
                Récupérez la dernière version des sources, puis relancez{" "}
                <span className="font-mono">./start.sh</span>.
              </>
            )}
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            Faites une sauvegarde avant chaque mise à jour (onglet « Sauvegarde &amp;
            Données ») : une mise à jour ne peut pas être annulée.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

