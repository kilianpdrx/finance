"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, FileSpreadsheet, LineChart, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useBankProfiles, useBankProfileMutations, useInvestmentAccounts, type BankProfile } from "@/lib/api/hooks";
import { EditBankProfileDialog } from "./edit-bank-profile-dialog";

// Read-only reference of the columns each investment format consumes.
const INVEST_FORMAT_COLUMNS: Record<string, string[]> = {
  Boursorama: ["name", "isin", "quantity", "buyingPrice", "lastPrice"],
  IBKR: ["Symbol", "Quantity", "Price", "Price Currency", "Transaction Type", "Description"],
};

const FIELD_LABELS: Record<string, string> = {
  date: "Date", description: "Libellé", amount: "Montant", debit: "Débit", credit: "Crédit", balance: "Solde",
};

export function ProfilesTab() {
  const { data: profiles = [] } = useBankProfiles();
  const { data: investAccounts = [] } = useInvestmentAccounts();
  const { remove } = useBankProfileMutations();
  const [editing, setEditing] = useState<BankProfile | null>(null);

  const inferFormat = (bank: string, name: string) => {
    const s = `${bank} ${name}`;
    if (/bourso/i.test(s)) return "Boursorama";
    if (/ibkr|interactive/i.test(s)) return "IBKR";
    return bank || "CSV";
  };
  const investProfiles = investAccounts
    .filter((a) => a.has_holdings)
    .map((a) => ({ id: a.id, name: a.name, bank: a.bank_name, format: inferFormat(a.bank_name, a.name), count: a.holdings?.length ?? 0 }));

  if (profiles.length === 0 && investProfiles.length === 0) {
    return <Card><EmptyState icon={FileSpreadsheet} title="Aucun profil bancaire" description="Les profils sont créés lors de l'import d'un relevé CSV (option « Sauvegarder ce format »)." /></Card>;
  }

  return (
    <div className="space-y-6">
      {profiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Relevés bancaires</h3>
          <Card className="divide-y divide-border p-0">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 space-y-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">délim. « {p.delimiter} » · {p.encoding} · {p.date_format}</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {Object.entries(p.column_mapping ?? {}).map(([field, col]) => (
                      <span key={field} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        <span className="text-muted-foreground">{FIELD_LABELS[field] ?? field}</span> → <span className="font-mono">{String(col)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => setEditing(p)} title="Modifier">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative"
                  onClick={() => { if (confirm(`Supprimer le profil « ${p.name} » ?`)) remove.mutate(p.id, { onSuccess: () => toast.success("Profil supprimé") }); }}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {investProfiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Profils d&apos;investissement</h3>
          <Card className="divide-y divide-border p-0">
            {investProfiles.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <LineChart className="mt-0.5 size-4 shrink-0 text-brand" />
                <div className="flex-1 space-y-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.bank} · {p.count} position{p.count !== 1 ? "s" : ""}</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {(INVEST_FORMAT_COLUMNS[p.format] ?? []).map((c) => (
                      <span key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{c}</span>
                    ))}
                  </div>
                  <p className="pt-0.5 text-[11px] text-muted-foreground/70">Format fixe — colonnes détectées automatiquement</p>
                </div>
                <Badge variant="neutral">{p.format}</Badge>
              </div>
            ))}
          </Card>
        </div>
      )}

      <EditBankProfileDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} profile={editing} />
    </div>
  );
}
