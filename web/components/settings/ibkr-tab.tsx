"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PlugZap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useSettings,
  useSettingMutation,
  useIbkrStatus,
  useIbkrSyncPreview,
  useInvestmentAccounts,
} from "@/lib/api/hooks";

export function IbkrTab() {
  const { data: settings } = useSettings();
  const { data: status } = useIbkrStatus();
  const { data: accounts = [] } = useInvestmentAccounts();
  const mutation = useSettingMutation();
  const testSync = useIbkrSyncPreview();

  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState(settings?.ibkr_query_id ?? "");

  const liveAccounts = accounts.filter((a) => a.has_holdings || a.id === status?.account_id);
  const accountId = settings?.ibkr_account_id ?? "";
  const autoSync = settings?.ibkr_auto_sync === "true";

  const save = (key: string, value: string, msg: string) =>
    mutation.mutate({ key, value }, { onSuccess: () => toast.success(msg) });

  const handleTest = () => {
    testSync.mutate(undefined, {
      onSuccess: (data) => toast.success(`Connexion réussie — ${data.total} position(s) trouvée(s)`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Échec de la connexion"),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="size-4" /> Connexion IBKR (Flex Web Service)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Récupère automatiquement vos positions ouvertes depuis Interactive Brokers. Les quantités et prix de
            revient proviennent d&apos;IBKR ; les cours en direct restent fournis par Yahoo Finance. Créez un jeton et
            une requête Flex « Open Positions » dans IBKR, puis renseignez-les ci-dessous.
          </p>

          {/* Token */}
          <div className="max-w-md space-y-1">
            <Label>Jeton Flex (token)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder={status?.configured ? "•••••••• (configuré)" : "Collez votre jeton Flex"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!token.trim() || mutation.isPending}
                onClick={() => { save("ibkr_flex_token", token.trim(), "Jeton enregistré"); setToken(""); }}
              >
                Enregistrer
              </Button>
            </div>
            {status?.configured && (
              <p className="flex items-center gap-1 text-xs text-positive">
                <CheckCircle2 className="size-3" /> Jeton configuré
              </p>
            )}
          </div>

          {/* Query ID */}
          <div className="max-w-md space-y-1">
            <Label>Identifiant de requête (Query ID)</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="ex. 1554219"
                value={queryId}
                onChange={(e) => setQueryId(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!queryId.trim() || mutation.isPending}
                onClick={() => save("ibkr_query_id", queryId.trim(), "Requête enregistrée")}
              >
                Enregistrer
              </Button>
            </div>
          </div>

          {/* Target account */}
          <div className="max-w-md space-y-1">
            <Label>Compte d&apos;investissement cible</Label>
            <Select
              value={accountId ? String(accountId) : undefined}
              onValueChange={(v) => save("ibkr_account_id", v, "Compte cible mis à jour")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir un compte…" />
              </SelectTrigger>
              <SelectContent>
                {liveAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} {a.bank_name ? `· ${a.bank_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Les positions IBKR seront synchronisées dans ce compte. Un seul compte IBKR par requête Flex est recommandé.
            </p>
          </div>

          {/* Auto-sync toggle */}
          <div className="flex max-w-md items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Synchroniser au démarrage</p>
              <p className="text-xs text-muted-foreground">Récupère les positions à chaque lancement de l&apos;application.</p>
            </div>
            <Switch
              checked={autoSync}
              onCheckedChange={(v) => save("ibkr_auto_sync", v ? "true" : "false", v ? "Synchronisation auto activée" : "Synchronisation auto désactivée")}
            />
          </div>

          {/* Test + last sync */}
          <div className="flex items-center gap-3 pt-1">
            <Button variant="outline" size="sm" disabled={!status?.configured || testSync.isPending} onClick={handleTest}>
              {testSync.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PlugZap className="mr-1.5 size-3.5" />}
              Tester la connexion
            </Button>
            {status?.last_status && (
              <span className="text-xs text-muted-foreground">
                Dernière synchro : {status.last_sync ? new Date(status.last_sync).toLocaleString("fr-FR") : "—"} · {status.last_status}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
