"use client";

import { useState } from "react";
import { ChevronDown, Plus, Upload, X } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PctBadge } from "./pct-badge";
import { HoldingsTable } from "./holdings-table";
import { AllocationDonut } from "./allocation-donut";
import { AddHoldingDialog } from "./add-holding-dialog";
import { ImportHoldingsDialog } from "./import-holdings-dialog";
import { BenchmarkChart } from "./benchmark-chart";
import { useSnapshotMutations, type InvestmentAccount } from "@/lib/api/hooks";
import { formatCents, currencySymbol, parseAmountToCents } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "positions" | "snapshots";

export function InvestmentRow({ acc }: { acc: InvestmentAccount }) {
  const [expanded, setExpanded] = useState(false);
  const defaultTab: Tab = acc.has_holdings ? "positions" : "snapshots";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [contribution, setContribution] = useState("");
  const [notes, setNotes] = useState("");
  const { create, remove } = useSnapshotMutations();

  const spark = acc.monthly.map((m) => ({ v: m.amount_cents / 100 }));

  const addSnapshot = async () => {
    try {
      await create.mutateAsync({
        accountId: acc.id,
        body: { date, amount_cents: parseAmountToCents(amount), contribution_cents: contribution ? parseAmountToCents(contribution) : 0, currency: acc.currency, notes: notes || null },
      });
      toast.success("Relevé ajouté");
      setAmount(""); setContribution(""); setNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: acc.color }}>
          {acc.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{acc.name}</p>
          <p className="text-xs text-muted-foreground">{acc.bank_name}</p>
        </div>
        {spark.length >= 2 && (
          <div className="hidden h-8 w-24 sm:block">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line type="monotone" dataKey="v" stroke={acc.color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {acc.has_holdings && acc.holdings_gain_pct != null && (
          <div className="hidden shrink-0 text-right sm:block">
            <PctBadge value={acc.holdings_gain_pct} amountCents={acc.holdings_gain_cents} currency={acc.currency} />
            <p className="mt-0.5 text-[10px] text-muted-foreground">perf. positions</p>
          </div>
        )}
        {!acc.has_holdings && (
          <>
            <div className="hidden shrink-0 text-right md:block">
              <PctBadge value={acc.perf_pct_from_last_month} amountCents={acc.perf_from_last_month_cents} currency={acc.currency} />
              <p className="mt-0.5 text-[10px] text-muted-foreground">perf. ce mois</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <PctBadge value={acc.perf_pct_from_start} amountCents={acc.perf_from_start_cents} currency={acc.currency} />
              <p className="mt-0.5 text-[10px] text-muted-foreground">perf. totale</p>
            </div>
          </>
        )}
        <div className="w-32 shrink-0 text-right">
          <p className="nums blurable text-sm font-semibold">{acc.current_value_cents != null ? formatCents(acc.current_value_cents, acc.currency) : "—"}</p>
          {acc.money_added_cents > 0 && (
            <p className="nums blurable mt-0.5 text-[10px] text-muted-foreground">{formatCents(acc.money_added_cents, acc.currency)} investi</p>
          )}
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-5 py-4">
          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border">
            <button
              onClick={() => setTab("positions")}
              className={cn("px-3 py-1.5 text-sm font-medium transition-colors", tab === "positions" ? "border-b-2 border-brand text-brand" : "text-muted-foreground hover:text-foreground")}
            >
              Positions ({acc.holdings?.length ?? 0})
            </button>
            <button
              onClick={() => setTab("snapshots")}
              className={cn("px-3 py-1.5 text-sm font-medium transition-colors", tab === "snapshots" ? "border-b-2 border-brand text-brand" : "text-muted-foreground hover:text-foreground")}
            >
              Relevés manuels ({acc.monthly.length})
            </button>
          </div>

          {tab === "positions" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {acc.allocation_by_type && Object.keys(acc.allocation_by_type).length > 1 && (
                    <AllocationDonut
                      allocation={acc.allocation_by_type}
                      currency={acc.currency}
                      holdings={(acc.holdings ?? []).map((h) => ({
                        asset_type: h.asset_type,
                        name: h.name,
                        ticker: h.ticker,
                        value_cents: h.value_in_account_ccy_cents ?? h.current_value_cents ?? 0,
                      }))}
                    />
                  )}
                  {acc.has_holdings && acc.holdings_value_cents != null && (
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">Valeur totale positions</p>
                      <p className="nums blurable text-lg font-semibold">{formatCents(acc.holdings_value_cents, acc.currency, { decimals: 2 })}</p>
                      {acc.holdings_gain_cents != null && (
                        <PctBadge value={acc.holdings_gain_pct} amountCents={acc.holdings_gain_cents} currency={acc.currency} />
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                    <Upload className="mr-1 size-3.5" /> Importer CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                    <Plus className="mr-1 size-3.5" /> Position
                  </Button>
                </div>
              </div>
              <HoldingsTable holdings={acc.holdings ?? []} currency={acc.currency} />
              {(acc.holdings?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="mb-3 text-sm font-semibold">Performance vs indices</p>
                  <BenchmarkChart
                    accountId={acc.id}
                    accountName={acc.name}
                    accountColor={acc.color}
                    holdings={(acc.holdings ?? []).map((h) => ({
                      ticker: h.ticker,
                      quantity: h.quantity,
                      cost_basis_cents: h.cost_basis_cents,
                      current_value_cents: h.current_value_cents,
                    }))}
                  />
                </div>
              )}
              <AddHoldingDialog open={addOpen} onOpenChange={setAddOpen} accountId={acc.id} />
              <ImportHoldingsDialog open={importOpen} onOpenChange={setImportOpen} accountId={acc.id} />
            </div>
          )}

          {tab === "snapshots" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
                <div className="space-y-1"><Label>Valeur totale ({currencySymbol(acc.currency)})</Label><Input inputMode="decimal" placeholder="12 500,00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" /></div>
                <div className="space-y-1"><Label>Versement ({currencySymbol(acc.currency)})</Label><Input inputMode="decimal" placeholder="0" value={contribution} onChange={(e) => setContribution(e.target.value)} className="w-28" /></div>
                <div className="min-w-[140px] flex-1 space-y-1"><Label>Notes</Label><Input placeholder="Optionnel" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <Button onClick={addSnapshot} disabled={create.isPending || !amount}>{create.isPending ? "…" : "Ajouter"}</Button>
              </div>

              {acc.monthly.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-2 text-left font-medium">Date</th>
                        <th className="py-2 text-right font-medium">Valeur</th>
                        <th className="py-2 text-right font-medium">Versement</th>
                        <th className="py-2 text-right font-medium">Évolution</th>
                        <th className="py-2 text-right font-medium">Performance</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...acc.monthly].reverse().map((entry, idx, arr) => {
                        const prev = arr[idx + 1];
                        let pctChange: number | null = null, perfCents: number | null = null, perfPct: number | null = null;
                        if (prev && prev.amount_cents !== 0) {
                          const raw = entry.amount_cents - prev.amount_cents;
                          pctChange = Math.round((raw / Math.abs(prev.amount_cents)) * 1000) / 10;
                          perfCents = raw - (entry.contribution_cents || 0);
                          perfPct = Math.round((perfCents / Math.abs(prev.amount_cents)) * 1000) / 10;
                        }
                        return (
                          <tr key={entry.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="nums py-2">{new Date(entry.date + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</td>
                            <td className="nums blurable py-2 text-right font-medium">{formatCents(entry.amount_cents, entry.currency)}</td>
                            <td className="nums py-2 text-right text-muted-foreground">{entry.contribution_cents ? formatCents(entry.contribution_cents, entry.currency) : "—"}</td>
                            <td className="py-2 text-right"><PctBadge value={pctChange} /></td>
                            <td className="py-2 text-right"><PctBadge value={perfPct} amountCents={perfCents} currency={entry.currency} /></td>
                            <td className="py-2 text-right">
                              <button onClick={() => remove.mutate({ accountId: acc.id, snapshotId: entry.id })} className="text-muted-foreground transition-colors hover:text-negative" title="Supprimer">
                                <X className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
