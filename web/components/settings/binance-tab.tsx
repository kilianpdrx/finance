"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PlugZap, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useSettingMutation,
  useBinanceStatus,
  useBinanceTest,
  useInvestmentAccounts,
} from "@/lib/api/hooks";

/** A write-only field: what is stored is never shown again (the API does not
 *  send it back), only whether there is one. */
function SecretField({ id, label, stored, placeholder, onSave, saving }: {
  id: string; label: string; stored: boolean; placeholder: string;
  onSave: (value: string) => void; saving: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-md space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={stored ? "•••••••• (enregistrée)" : placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={!value.trim() || saving} onClick={() => { onSave(value.trim()); setValue(""); }}>
          Enregistrer
        </Button>
      </div>
      {stored && (
        <p className="flex items-center gap-1 text-xs text-positive">
          <CheckCircle2 className="size-3" /> Enregistrée
        </p>
      )}
    </div>
  );
}

export function BinanceTab() {
  const { data: status } = useBinanceStatus();
  const { data: accounts = [] } = useInvestmentAccounts();
  const mutation = useSettingMutation();
  const test = useBinanceTest();
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (key: string, value: string, msg: string) =>
    mutation.mutate({ key, value }, { onSuccess: () => { toast.success(msg); setVerdict(null); } });

  const handleTest = () => {
    test.mutate(undefined, {
      onSuccess: () => setVerdict({ ok: true, text: "Connexion réussie : la clé est en lecture seule." }),
      onError: (e) => setVerdict({ ok: false, text: e instanceof Error ? e.message : "Échec de la connexion" }),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="size-4" /> Connexion Binance (lecture seule)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Lit vos soldes Binance (portefeuilles Spot, Funding et Earn) et les tient à jour comme positions du compte
            choisi, au cours de Binance en euros. Binance ne communique pas vos prix d&apos;achat : indiquez le PRU de
            chaque position pour voir son gain.
          </p>

          <ol className="max-w-2xl list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Dans Binance : Compte → Gestion des API → Créer une API → « Générée par le système ».</li>
            <li>
              Ne laissez cochée que <span className="font-medium text-foreground">« Enable Reading »</span>. Une clé qui
              peut trader, transférer ou retirer est refusée : elle serait enregistrée dans la base et dans chaque
              sauvegarde.
            </li>
            <li>Collez ci-dessous la clé API et la clé secrète (Binance n&apos;affiche la clé secrète qu&apos;une fois).</li>
          </ol>

          <SecretField
            id="binance-key" label="Clé API" stored={!!status?.has_key} placeholder="Collez la clé API"
            saving={mutation.isPending} onSave={(v) => save("binance_api_key", v, "Clé API enregistrée")}
          />
          <SecretField
            id="binance-secret" label="Clé secrète" stored={!!status?.has_secret} placeholder="Collez la clé secrète"
            saving={mutation.isPending} onSave={(v) => save("binance_api_secret", v, "Clé secrète enregistrée")}
          />

          <div className="max-w-md space-y-1">
            <Label>Compte d&apos;investissement qui reçoit les positions</Label>
            <Select
              value={status?.account_id != null ? String(status.account_id) : undefined}
              onValueChange={(v) => save("binance_account_id", v, "Compte mis à jour")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir un compte…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} {a.bank_name ? `· ${a.bank_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Une position par crypto ; les euros présents sur Binance deviennent des liquidités. Une fois synchronisé, le
              compte est valorisé par ses positions, plus par ses relevés manuels.
            </p>
          </div>

          <div className="flex max-w-md items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Synchroniser au démarrage</p>
              <p className="text-xs text-muted-foreground">Met les quantités à jour à chaque lancement de l&apos;application.</p>
            </div>
            <Switch
              checked={!!status?.auto_sync}
              onCheckedChange={(v) => save("binance_auto_sync", v ? "true" : "false", v ? "Synchronisation au démarrage activée" : "Synchronisation au démarrage désactivée")}
            />
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" disabled={!status?.has_key || !status?.has_secret || test.isPending} onClick={handleTest}>
                {test.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 size-3.5" />}
                Tester la connexion
              </Button>
              {status?.last_status && (
                <span className="text-xs text-muted-foreground">
                  Dernière synchro : {status.last_sync ? new Date(status.last_sync + "Z").toLocaleString("fr-FR") : "—"} · {status.last_status}
                </span>
              )}
            </div>
            {verdict && (
              <p role="status" className={verdict.ok ? "text-sm text-positive" : "max-w-2xl text-sm text-negative"}>
                {verdict.text}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
