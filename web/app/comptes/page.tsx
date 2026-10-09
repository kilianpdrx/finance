"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Wallet, ChevronDown, ChevronRight, Undo2, PlugZap } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NetworthArea } from "@/components/charts/networth-area";
import { AccountDialog, ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import { SnapshotDialog } from "@/components/accounts/snapshot-dialog";
import { useAccounts, useAllAccounts, useNetWorth, useAccountMutations, fetchAccountDeletionSummary, type Account } from "@/lib/api/hooks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSelectedAccountsStore } from "@/lib/stores";
import { ClosedBadge } from "@/components/transactions/category-select";
import { balancesFromNetWorth } from "@/lib/networth";
import { deleteWithUndo } from "@/lib/undo";
import { formatCents } from "@/lib/format";

export default function ComptesPage() {
  const { data: accounts = [], isLoading, isError } = useAccounts();
  const { data: allAccounts = [] } = useAllAccounts();
  const { data: netWorth = [] } = useNetWorth({});
  const { remove, update, purge } = useAccountMutations();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [snapshotAccount, setSnapshotAccount] = useState<Account | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // Closed accounts keep their history — they're just retired from the active
  // list and from net worth. Shown here so they can be inspected or reopened.
  const closed = allAccounts.filter((a) => !a.is_active);
  const reactivate = (a: Account) =>
    update.mutate(
      { id: a.id, body: { is_active: true } },
      {
        onSuccess: () => toast.success(`Compte « ${a.name} » réactivé`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
      },
    );

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

  // Closing keeps the history; this removes it. Only offered on an account that
  // is already closed, and only after showing what goes with it.
  const deleteForever = async (a: Account) => {
    let summary;
    try {
      summary = await fetchAccountDeletionSummary(a.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      return;
    }
    const lines = ([
      [summary.transactions, "transaction(s)"],
      [summary.snapshots, "relevé(s) de solde"],
      [summary.holdings, "position(s)"],
      [summary.imports, "import(s)"],
      [summary.rules, "règle(s) propre(s) à ce compte"],
      [summary.budget_entries, "ligne(s) de budget"],
    ] as const).filter(([n]) => n > 0);
    const ok = await confirm({
      title: `Supprimer définitivement « ${a.name} » ?`,
      description: (
        <>
          <span className="block">
            {lines.length > 0 ? "Le compte sera supprimé avec tout ce qu'il contient :" : "Ce compte ne contient aucune donnée."}
          </span>
          {lines.map(([n, what]) => (
            <span key={what} className="block pl-3 text-foreground">· <span className="nums font-medium">{n}</span> {what}</span>
          ))}
          <span className="mt-2 block">
            Ces montants disparaîtront de l&apos;historique et des analyses. C&apos;est irréversible : pour garder une
            copie, faites d&apos;abord une sauvegarde dans Paramètres → Sauvegarde.
          </span>
        </>
      ),
      confirmLabel: "Supprimer définitivement",
      destructive: true,
    });
    if (!ok) return;
    try {
      await purge.mutateAsync(a.id);
      // The account filter is remembered across sessions: don't leave it
      // pointing at an account that no longer exists.
      const { selectedAccountIds, setSelectedAccountIds } = useSelectedAccountsStore.getState();
      if (selectedAccountIds?.includes(a.id)) {
        const rest = selectedAccountIds.filter((id) => id !== a.id);
        setSelectedAccountIds(rest.length > 0 ? rest : null);
      }
      toast.success(`Compte « ${a.name} » supprimé définitivement`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

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
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-brand" title="Soldes manuels" aria-label="Soldes manuels" onClick={() => setSnapshotAccount(acc)}><Plus className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Modifier le compte" onClick={() => openEdit(acc)}><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" aria-label="Clôturer le compte" onClick={() => onDelete(acc)}><Trash2 className="size-4" /></Button>
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

      {isError ? (
        // Never claim "no accounts" when we simply couldn't load them.
        <Card><EmptyState icon={PlugZap} title="Comptes indisponibles"
          description="Impossible de contacter le serveur. Vos comptes ne sont pas perdus — ils n'ont pas pu être chargés." /></Card>
      ) : accounts.length === 0 ? (
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

      {closed.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowClosed((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            {showClosed ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Comptes clôturés · {closed.length}
          </button>
          {showClosed && (
            <Card className="divide-y divide-border p-0">
              {closed.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="text-sm font-medium">{a.name}</span>
                  <ClosedBadge />
                  <span className="text-xs text-muted-foreground">{a.bank_name}</span>
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => reactivate(a)}>
                    <Undo2 className="size-4" /> Réactiver
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-negative"
                    disabled={purge.isPending} onClick={() => deleteForever(a)}>
                    <Trash2 className="size-4" /> Supprimer définitivement
                  </Button>
                </div>
              ))}
            </Card>
          )}
          <p className="px-1 text-xs text-muted-foreground">
            Leurs transactions restent dans l&apos;historique et les analyses ; seul leur solde
            sort du patrimoine. Supprimer définitivement un compte efface aussi son historique.
          </p>
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
