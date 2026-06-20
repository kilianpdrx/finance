"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet, Inbox } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { NetworthArea } from "@/components/charts/networth-area";
import { AccountDialog, ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import { SnapshotDialog } from "@/components/accounts/snapshot-dialog";
import { useAccounts, useNetWorth, useAccountMutations, type Account, type NetWorthPoint } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

function balancesFromNetWorth(nw: NetWorthPoint[], accounts: Account[]): Record<number, number> {
  if (!nw.length) return {};
  const last = nw[nw.length - 1];
  const map: Record<number, number> = {};
  for (const a of accounts) {
    const v = (last[`${a.name}_native`] ?? last[a.name]) as number | undefined;
    if (typeof v === "number") map[a.id] = v;
  }
  return map;
}

export default function ComptesPage() {
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: netWorth = [] } = useNetWorth({});
  const { remove } = useAccountMutations();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [snapshotAccount, setSnapshotAccount] = useState<Account | null>(null);

  const balances = balancesFromNetWorth(netWorth, accounts);
  const total = Object.values(balances).reduce((s, v) => s + v, 0);
  const byType = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.account_type] = (acc[a.account_type] ?? 0) + (balances[a.id] ?? 0);
    return acc;
  }, {});

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (a: Account) => { setEditing(a); setDialogOpen(true); };
  const onDelete = (a: Account) => {
    if (confirm(`Désactiver le compte « ${a.name} » ?`)) remove.mutate(a.id);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          {Object.keys(balances).length > 0 && (
            <p className="text-sm text-muted-foreground">
              Patrimoine total : <span className="nums blurable font-semibold text-brand">{formatCents(total)}</span>
            </p>
          )}
        </div>
        <Button onClick={openCreate}><Plus className="size-4" /> Nouveau compte</Button>
      </div>

      {Object.keys(byType).length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(byType).map(([type, sum]) => (
            <Card key={type} className="p-4">
              <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[type] ?? type}</p>
              <p className={`nums blurable mt-0.5 text-base font-semibold ${sum >= 0 ? "" : "text-negative"}`}>{formatCents(sum)}</p>
            </Card>
          ))}
        </div>
      )}

      {accounts.length === 0 ? (
        <Card><EmptyState icon={Wallet} title="Aucun compte" description="Créez un compte pour commencer à suivre vos finances." action={<Button onClick={openCreate}><Plus className="size-4" /> Nouveau compte</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((acc) => (
            <Card key={acc.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl text-lg font-semibold text-white" style={{ backgroundColor: acc.color }}>
                    {acc.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{acc.name}</p>
                    <p className="text-xs text-muted-foreground">{acc.bank_name}</p>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-brand" title="Soldes manuels" onClick={() => setSnapshotAccount(acc)}><Plus className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => openEdit(acc)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" onClick={() => onDelete(acc)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Badge variant="neutral">{ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type}</Badge>
                {balances[acc.id] !== undefined ? (
                  <span className={`nums blurable text-sm font-semibold ${balances[acc.id] >= 0 ? "" : "text-negative"}`}>{formatCents(balances[acc.id], acc.currency)}</span>
                ) : (
                  <button className="text-xs text-brand hover:underline" onClick={() => setSnapshotAccount(acc)}>+ Ajouter un solde</button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {netWorth.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Évolution du patrimoine</CardTitle></CardHeader>
          <CardContent className="pt-2"><NetworthArea data={netWorth} currency="EUR" /></CardContent>
        </Card>
      )}

      <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} account={editing} />
      <SnapshotDialog account={snapshotAccount} onOpenChange={(v) => !v && setSnapshotAccount(null)} />
    </div>
  );
}
