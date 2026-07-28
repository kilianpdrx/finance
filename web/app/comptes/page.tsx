"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Wallet } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NetworthArea } from "@/components/charts/networth-area";
import { AccountDialog, ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import { SnapshotDialog } from "@/components/accounts/snapshot-dialog";
import { useAccounts, useNetWorth, useAccountMutations, type Account } from "@/lib/api/hooks";
import { balancesFromNetWorth } from "@/lib/networth";
import { deleteWithUndo } from "@/lib/undo";
import { formatCents } from "@/lib/format";

export default function ComptesPage() {
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: netWorth = [] } = useNetWorth({});
  const { remove } = useAccountMutations();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [snapshotAccount, setSnapshotAccount] = useState<Account | null>(null);

  const balances = balancesFromNetWorth(netWorth, accounts);
  const total = Object.values(balances).reduce((s, v) => s + v, 0);
  const byType = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.account_type] = (acc[a.account_type] ?? 0) + (balances[a.id] ?? 0);
    return acc;
  }, {});

  const banks = Array.from(new Set(accounts.map((a) => a.bank_name))).sort((a, b) => a.localeCompare(b));
  const useTabs = banks.length >= 2;
  const bankTotal = (bank: string) =>
    accounts.filter((a) => a.bank_name === bank).reduce((s, a) => s + (balances[a.id] ?? 0), 0);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (a: Account) => { setEditing(a); setDialogOpen(true); };
  const onDelete = (a: Account) =>
    deleteWithUndo({
      queryClient: qc,
      queryKeys: [["accounts"]],
      message: `Compte « ${a.name} » désactivé`,
      optimisticRemove: () => qc.setQueryData<Account[]>(["accounts"], (o) => o?.filter((x) => x.id !== a.id)),
      apiDelete: () => remove.mutateAsync(a.id),
    });

  const AccountCard = (acc: Account) => (
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
  );

  const Grid = ({ items }: { items: Account[] }) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{items.map(AccountCard)}</div>
  );

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
      ) : useTabs ? (
        <Tabs defaultValue="__all__">
          <TabsList>
            <TabsTrigger value="__all__">Tous</TabsTrigger>
            {banks.map((b) => <TabsTrigger key={b} value={b}>{b}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="__all__"><Grid items={accounts} /></TabsContent>
          {banks.map((b) => {
            const items = accounts.filter((a) => a.bank_name === b);
            return (
              <TabsContent key={b} value={b}>
                <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{items.length} compte{items.length > 1 ? "s" : ""}</span>
                  <span>Sous-total : <span className="nums blurable font-semibold text-foreground">{formatCents(bankTotal(b))}</span></span>
                </div>
                <Grid items={items} />
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <Grid items={accounts} />
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
