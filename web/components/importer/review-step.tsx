"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Wallet } from "lucide-react";
import { AccountSelect } from "@/components/accounts/account-select";
import { CategorySelect } from "@/components/transactions/category-select";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { formatCents } from "@/lib/format";
import type { Account, Category } from "@/lib/api/hooks";
import type { ParsePreviewTransaction } from "@/lib/api/upload";

// Same formatting as the transactions table: 2 decimals, in the destination
// account's currency. amount_cents is a positive magnitude; is_debit gives the sign.
function money(cents: number, isDebit: boolean, currency: string) {
  return `${isDebit ? "−" : "+"}${formatCents(cents, currency, { decimals: 2 })}`;
}

export function ReviewStep({
  transactions, categories, accounts, selectedAccount, onSelectAccount, loading, error, onConfirm, onBack, fileName,
}: {
  transactions: ParsePreviewTransaction[];
  categories: Category[];
  accounts: Account[];
  selectedAccount: string;
  onSelectAccount: (v: string) => void;
  loading: boolean;
  error: string;
  onConfirm: (overrides: Record<string, number | null>, force: string[]) => void;
  onBack: () => void;
  fileName?: string;
}) {
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [filterUncat, setFilterUncat] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [force, setForce] = useState<Set<string>>(new Set());

  const destCurrency = accounts.find((a) => String(a.id) === selectedAccount)?.currency ?? "EUR";
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>;
  const catId = (t: ParsePreviewTransaction) => (t.import_hash in overrides ? overrides[t.import_hash] : t.category_id);
  const duplicateTxns = useMemo(() => transactions.filter((t) => t.is_duplicate), [transactions]);
  const duplicates = duplicateTxns.length;
  const forcedCount = duplicateTxns.filter((t) => force.has(t.import_hash)).length;
  const uncategorized = transactions.filter((t) => (!t.is_duplicate || force.has(t.import_hash)) && catId(t) === null).length;
  const toImport = transactions.filter((t) => !t.is_duplicate).length + forcedCount;
  const canImport = toImport > 0 && !!selectedAccount;

  const displayed = (filterUncat
    ? transactions.filter((t) => (!t.is_duplicate || force.has(t.import_hash)) && catId(t) === null)
    : transactions.filter((t) => !t.is_duplicate || force.has(t.import_hash)));

  const toggleForce = (h: string) => setForce((p) => { const n = new Set(p); n.has(h) ? n.delete(h) : n.add(h); return n; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          Révision avant import
          {fileName && <span className="truncate font-mono text-sm font-normal text-muted-foreground">{fileName}</span>}
        </h2>
        <Button variant="ghost" size="sm" onClick={onBack}>← Retour</Button>
      </div>

      <Card className="flex flex-col gap-2.5 p-4 sm:flex-row sm:items-center sm:gap-4">
        <Label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground">
          <Wallet className="size-4" /> Compte destination
        </Label>
        <AccountSelect accounts={accounts} value={selectedAccount} onChange={onSelectAccount} className="flex-1" />
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center"><p className="text-2xl font-bold text-positive">{toImport}</p><p className="mt-0.5 text-xs text-positive">à importer</p></Card>
        <Card className={cn("p-3 text-center", uncategorized > 0 && "border-warning/40")}>
          <p className={cn("text-2xl font-bold", uncategorized > 0 ? "text-warning" : "text-muted-foreground")}>{uncategorized}</p>
          <p className={cn("mt-0.5 text-xs", uncategorized > 0 ? "text-warning" : "text-muted-foreground")}>non catégorisées</p>
        </Card>
        <Card onClick={() => duplicates > 0 && setShowDuplicates((v) => !v)} className={cn("p-3 text-center", duplicates > 0 && "cursor-pointer")}>
          <p className={cn("text-2xl font-bold", duplicates > 0 ? "text-warning" : "text-muted-foreground")}>{duplicates}</p>
          <p className={cn("mt-0.5 text-xs", duplicates > 0 ? "text-warning" : "text-muted-foreground")}>doublons {force.size > 0 ? `(${force.size} inclus)` : "· cliquer"}</p>
        </Card>
      </div>

      {showDuplicates && duplicates > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between bg-warning/10 px-4 py-2.5">
            <p className="text-sm font-medium text-warning">{duplicates} doublon(s) — déjà importé(s)</p>
            <Button variant="outline" size="sm" onClick={() => setForce(force.size < duplicates ? new Set(duplicateTxns.map((t) => t.import_hash)) : new Set())}>
              {force.size < duplicates ? "Tout inclure" : "Tout exclure"}
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {duplicateTxns.map((t, i) => (
                  <tr key={`${t.import_hash}-${i}`} className={cn("border-t border-border", force.has(t.import_hash) && "bg-positive/8")}>
                    <td className="w-8 px-4 py-1.5"><Checkbox checked={force.has(t.import_hash)} onCheckedChange={() => toggleForce(t.import_hash)} /></td>
                    <td className="nums px-2 py-1.5 text-xs text-muted-foreground">{t.date}</td>
                    <td className="max-w-xs truncate px-2 py-1.5 text-xs">{t.description}</td>
                    <td className={cn("nums whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium", t.is_debit ? "text-negative" : "text-positive")}>{money(t.amount_cents, t.is_debit, destCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={filterUncat} onCheckedChange={(v) => setFilterUncat(!!v)} />
        Afficher seulement les non catégorisées ({uncategorized})
      </label>

      <Card className="overflow-hidden p-0">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th className="w-24 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Description</th>
                <th className="w-28 px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Montant</th>
                <th className="w-44 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Catégorie</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">{filterUncat ? "Toutes catégorisées !" : "Aucune transaction à importer."}</td></tr>
              )}
              {displayed.map((t, i) => {
                const cid = catId(t);
                const uncat = cid === null;
                return (
                  <tr key={`${t.import_hash}-${i}`} className={cn("border-t border-border", uncat ? "bg-warning/8" : t.categorization_source === "rule" ? "bg-positive/6" : "")}>

                    <td className="nums whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{t.date}</td>
                    <td className="max-w-xs px-4 py-2 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate" title={t.description}>{t.description}</span>
                        {t.category_conflict && <ConflictBadge className="shrink-0 text-[10px]" />}
                      </span>
                    </td>
                    <td className={cn("nums whitespace-nowrap px-4 py-2 text-right text-xs font-medium", t.is_debit ? "text-negative" : "text-positive")}>{money(t.amount_cents, t.is_debit, destCurrency)}</td>
                    <td className="px-4 py-2">
                      <CategorySelect
                        value={cid}
                        onChange={(v) => setOverrides((p) => ({ ...p, [t.import_hash]: v }))}
                        categories={categories}
                        accountId={selectedAccount ? Number(selectedAccount) : null}
                        accountNames={accountNames}
                        className={cn("h-8 w-full text-xs", uncat && "border-warning/50")}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</div>}

      <div className="flex justify-end">
        <Button disabled={loading || !canImport} onClick={() => onConfirm(overrides, [...force])}>
          {loading ? "Import en cours…" : `Importer ${toImport} transaction${toImport !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
