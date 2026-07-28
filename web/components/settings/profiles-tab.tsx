"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, FileSpreadsheet, LineChart, Pencil, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useBankProfiles, useBankProfileMutations, useInvestmentAccounts, type BankProfile } from "@/lib/api/hooks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EditBankProfileDialog } from "./edit-bank-profile-dialog";

// Read-only reference of the columns each investment format consumes.
const INVEST_FORMAT_COLUMNS: Record<string, string[]> = {
  Boursorama: ["name", "isin", "quantity", "buyingPrice", "lastPrice"],
  IBKR: ["Symbol", "Quantity", "Price", "Price Currency", "Transaction Type", "Description"],
};

const FIELD_LABELS: Record<string, string> = {
  date: "Date", description: "Libellé", amount: "Montant", debit: "Débit", credit: "Crédit", balance: "Solde",
  ticker: "Ticker", isin: "ISIN", name: "Nom", quantity: "Qté", buyingPrice: "Pr. revient", lastPrice: "Der. cours", currency: "Devise",
};

export function ProfilesTab() {
  const { data: profiles = [] } = useBankProfiles();
  const { data: investAccounts = [] } = useInvestmentAccounts();
  const { remove } = useBankProfileMutations();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<any | null>(null);
  const [isInvestment, setIsInvestment] = useState(false);

  const askDelete = async (p: { id: number; name: string }) => {
    const ok = await confirm({
      title: `Supprimer le profil « ${p.name} » ?`,
      description: "Ce profil d'import sera supprimé. Vos transactions déjà importées ne sont pas affectées.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (ok) remove.mutate(p.id, { onSuccess: () => toast.success("Profil supprimé") });
  };

  const inferFormat = (bank: string, name: string) => {
    const s = `${bank} ${name}`;
    if (/bourso/i.test(s)) return "Boursorama";
    if (/ibkr|interactive/i.test(s)) return "IBKR";
    return bank || "CSV";
  };

  const isInvestProfile = (p: BankProfile) => {
    return p.column_mapping && ("quantity" in p.column_mapping || "buyingPrice" in p.column_mapping || "ticker" in p.column_mapping || "isin" in p.column_mapping);
  };

  const bankProfiles = profiles.filter((p) => !isInvestProfile(p));
  const customInvestProfiles = profiles.filter((p) => isInvestProfile(p));

  const activeInvestAccounts = investAccounts
    .filter((a) => a.has_holdings)
    .map((a) => ({ id: a.id, name: a.name, bank: a.bank_name, format: inferFormat(a.bank_name, a.name), count: a.holdings?.length ?? 0 }));

  const startCreateBankProfile = () => {
    setEditing({ id: undefined, name: "", delimiter: ";", encoding: "utf-8", date_format: "%d/%m/%Y", column_mapping: {} });
    setIsInvestment(false);
  };

  const startCreateInvestProfile = () => {
    setEditing({
      id: undefined,
      name: "",
      delimiter: ";",
      encoding: "utf-8",
      date_format: "%d/%m/%Y",
      column_mapping: { ticker: "", isin: "", name: "", quantity: "", buyingPrice: "", lastPrice: "", currency: "" }
    });
    setIsInvestment(true);
  };

  const startCreateFromTemplate = (format: "Boursorama" | "IBKR") => {
    if (format === "Boursorama") {
      setEditing({
        id: undefined,
        name: "Boursorama (Personnalisé)",
        delimiter: ";",
        encoding: "utf-8",
        date_format: "%d/%m/%Y",
        column_mapping: { name: "name", isin: "isin", quantity: "quantity", buyingPrice: "buyingPrice", lastPrice: "lastPrice" }
      });
    } else {
      setEditing({
        id: undefined,
        name: "IBKR (Personnalisé)",
        delimiter: ";",
        encoding: "utf-8",
        date_format: "%d/%m/%Y",
        column_mapping: { ticker: "Symbol", name: "Description", quantity: "Quantity", buyingPrice: "Price", currency: "Price Currency" }
      });
    }
    setIsInvestment(true);
  };

  const editProfile = (p: BankProfile) => {
    setEditing(p);
    setIsInvestment(isInvestProfile(p));
  };

  if (profiles.length === 0 && activeInvestAccounts.length === 0) {
    return (
      <Card>
        <EmptyState icon={FileSpreadsheet} title="Aucun profil bancaire" description="Créez un profil pour commencer à importer vos relevés ou positions." />
        <div className="flex justify-center gap-3 pb-6">
          <Button onClick={startCreateBankProfile} size="sm"><Plus className="mr-1.5 size-4" /> Créer un profil bancaire</Button>
          <Button onClick={startCreateInvestProfile} size="sm" variant="outline"><Plus className="mr-1.5 size-4" /> Créer un profil d&apos;investissement</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bank Statements Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">Relevés bancaires</h3>
          <Button onClick={startCreateBankProfile} size="sm" variant="ghost"><Plus className="mr-1 size-3" /> Nouveau profil</Button>
        </div>
        <Card className="divide-y divide-border p-0">
          {bankProfiles.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Aucun profil de relevé bancaire personnalisé.</p>
          ) : (
            bankProfiles.map((p) => (
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
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => editProfile(p)} title="Modifier">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative"
                  onClick={() => askDelete(p)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* Database Custom Investment Profiles */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">Profils d&apos;investissement personnalisés</h3>
          <Button onClick={startCreateInvestProfile} size="sm" variant="ghost"><Plus className="mr-1 size-3" /> Nouveau profil</Button>
        </div>
        <Card className="divide-y divide-border p-0">
          {customInvestProfiles.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Aucun profil d&apos;investissement personnalisé. Créez-en un pour les courtiers non-standards.</p>
          ) : (
            customInvestProfiles.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <LineChart className="mt-0.5 size-4 shrink-0 text-brand" />
                <div className="flex-1 space-y-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">délim. « {p.delimiter} » · {p.encoding}</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {Object.entries(p.column_mapping ?? {}).map(([field, col]) => (
                      <span key={field} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        <span className="text-muted-foreground">{FIELD_LABELS[field] ?? field}</span> → <span className="font-mono">{String(col)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => editProfile(p)} title="Modifier">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative"
                  onClick={() => askDelete(p)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* Auto-detected / Fixed formats info */}
      {activeInvestAccounts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Profils d&apos;investissement actifs (Format fixe)</h3>
          <Card className="divide-y divide-border p-0">
            {activeInvestAccounts.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <LineChart className="mt-0.5 size-4 shrink-0 text-brand/50" />
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
                <div className="flex items-center gap-2">
                  {(p.format === "Boursorama" || p.format === "IBKR") && (
                    <Button variant="outline" size="sm" onClick={() => startCreateFromTemplate(p.format as "Boursorama" | "IBKR")}>
                      Personnaliser
                    </Button>
                  )}
                  <Badge variant="neutral">{p.format}</Badge>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      <EditBankProfileDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} profile={editing} isInvestment={isInvestment} />
    </div>
  );
}
