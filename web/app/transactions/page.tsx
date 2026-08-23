"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Plus, Download, Shuffle, Trash2, CheckCheck, ArrowLeftRight, X, Inbox, ChevronLeft, ChevronRight, Pencil, Ban, Undo2, Archive } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySelect, ArchivedBadge, ClosedBadge } from "@/components/transactions/category-select";
import { SearchBox } from "@/components/transactions/search-box";
import { AccountTile } from "@/components/accounts/account-select";
import { ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  useAccounts, useAllAccounts, useCategories, useTransactionMeta, useTransactions, useTransactionCount, useTransactionStats, useTransactionMutations,
  fetchTransactionIds, type TransactionFilters, type Transaction, type Account, type Category,
} from "@/lib/api/hooks";
import { orderCategoryTree } from "@/lib/group";
import { formatCents } from "@/lib/format";

const PAGE = 100;
const ALL = "__all__";
const UNCAT = "__uncat__";
const CATEGORIZED = "__has_cat__";

export default function TransactionsPage() {
  const { data: accounts = [] } = useAccounts();
  // Closed accounts are included here so their history stays filterable and
  // attributable (they keep their transactions; only their balance is retired).
  const { data: allAccounts = [] } = useAllAccounts();
  const { data: categories = [] } = useCategories();
  const { data: meta } = useTransactionMeta();
  const mut = useTransactionMutations();
  const confirm = useConfirm();

  // The account filter only lists current accounts (no savings/credit/investment),
  // including closed ones so past transactions remain reachable.
  const txAccounts = useMemo(() => allAccounts.filter((a) => a.account_type === "courant"), [allAccounts]);
  const accountNames = useMemo(() => Object.fromEntries(allAccounts.map((a) => [a.id, a.name])) as Record<number, string>, [allAccounts]);

  const [search, setSearch] = useState("");
  const [account, setAccount] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [type, setType] = useState(ALL); // all | debit | credit
  const [hideTransfers, setHideTransfers] = useState(true);
  const [month, setMonth] = useState(ALL);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (t: Transaction) => { setEditing(t); setDialogOpen(true); };

  const isSentinel = (c: string) => c === ALL || c === UNCAT || c === CATEGORIZED;
  const filters: TransactionFilters = useMemo(() => ({
    search: search || undefined,
    account_id: account === ALL ? undefined : Number(account),
    category_id: isSentinel(category) ? undefined : Number(category),
    uncategorized: category === UNCAT ? true : undefined,
    categorized: category === CATEGORIZED ? true : undefined,
    is_debit: type === ALL ? undefined : type === "debit",
    is_internal_transfer: hideTransfers ? false : undefined,
    month: month === ALL ? undefined : month,
    limit: PAGE,
    offset: page * PAGE,
  }), [search, account, category, type, hideTransfers, month, page]);

  const { data: rows = [], isLoading, isFetching } = useTransactions(filters);
  const { data: countData } = useTransactionCount(filters);
  const { data: stats } = useTransactionStats(filters);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleRow = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelection = () => setSelected(new Set());

  // "Select all matching" across pages (not just the visible page).
  const total = countData?.total ?? rows.length;
  const hasMorePages = total > rows.length;
  const allMatchingSelected = total > 0 && selected.size >= total;
  const selectAllMatching = async () => {
    try {
      const allIds = await fetchTransactionIds(filters);
      setSelected(new Set(allIds));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const ids = [...selected];
  const runBulk = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); clearSelection(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const exportHref = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "" && k !== "limit" && k !== "offset") p.set(k, String(v));
    });
    return `/api/transactions/export?${p}`;
  }, [filters]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox onSearch={(v) => { setSearch(v); setPage(0); }} />
        <AccountFilter value={account} onChange={(v) => { setAccount(v); setPage(0); }} accounts={txAccounts} width="w-44" />
        <CategoryFilter value={category} onChange={(v) => { setCategory(v); setPage(0); }} categories={categories}
          accountNames={accountNames} accountFilter={account === ALL ? null : Number(account)} width="w-56" />
        <FilterSelect value={type} onChange={(v) => { setType(v); setPage(0); }} placeholder="Type" width="w-32"
          options={[{ value: ALL, label: "Tout" }, { value: "debit", label: "Dépenses" }, { value: "credit", label: "Revenus" }]} />
        <FilterSelect value={month} onChange={(v) => { setMonth(v); setPage(0); }} placeholder="Mois" width="w-32"
          options={[{ value: ALL, label: "Tous les mois" }, ...(meta?.available_months ?? []).map((m) => ({ value: m, label: m }))]} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={hideTransfers} onCheckedChange={(v) => { setHideTransfers(v); setPage(0); }} />
          Masquer virements
        </label>
      </div>

      {/* Stats + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-muted-foreground">
          {stats ? (
            <>
              <span className="font-semibold text-foreground">{stats.total}</span> transactions
              <span className="mx-1.5 text-border">·</span>
              <span className="text-positive">{stats.categorized}</span> catégorisées
              <span className="mx-1.5 text-border">·</span>
              <span className="text-warning">{stats.uncategorized}</span> sans catégorie
              <span className="mx-1.5 text-border">·</span>
              <span className="text-info">{stats.transfers}</span> virements
            </>
          ) : (
            <span className="opacity-0">—</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.detectTransfers.mutateAsync(), "Virements détectés")}>
            <Shuffle className="size-4" /> Détecter virements
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download><Download className="size-4" /> Exporter</a>
          </Button>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> Nouvelle</Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-medium">{selected.size} sélectionnée(s)</span>
          {allSelected && hasMorePages && !allMatchingSelected && (
            <button className="text-xs font-medium text-brand underline underline-offset-2 hover:text-brand/80" onClick={selectAllMatching}>
              Sélectionner les {total} transactions correspondantes
            </button>
          )}
          {allMatchingSelected && hasMorePages && (
            <span className="text-xs text-muted-foreground">Toutes les transactions correspondantes sont sélectionnées.</span>
          )}
          <div className="ml-2 w-48">
            <CategorySelect value={null} placeholder="Catégoriser…" categories={categories} accountNames={accountNames} hideNone
              onChange={(cid) => runBulk(() => mut.bulkCategory.mutateAsync({ ids, category_id: cid }), "Catégorie appliquée")} />
          </div>
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.bulkCategory.mutateAsync({ ids, category_id: null }), "Catégorie retirée")}>
            <Ban className="size-4" /> Sans catégorie
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.bulkReviewed.mutateAsync({ ids, value: true }), "Marquées vérifiées")}>
            <CheckCheck className="size-4" /> Vérifié
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.bulkReviewed.mutateAsync({ ids, value: false }), "Marquées non vérifiées")}>
            <Undo2 className="size-4" /> Non vérifié
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.bulkTransfer.mutateAsync({ ids, value: true }), "Marquées virement")}>
            <ArrowLeftRight className="size-4" /> Virement
          </Button>
          <Button variant="destructive" size="sm"
            onClick={async () => {
              const ok = await confirm({
                title: `Supprimer ${selected.size} transaction(s) ?`,
                description: "Cette action est définitive.",
                confirmLabel: "Supprimer",
                destructive: true,
              });
              if (ok) runBulk(() => mut.bulkDelete.mutateAsync(ids), "Supprimées");
            }}>
            <Trash2 className="size-4" /> Supprimer
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}><X className="size-4" /> Annuler</Button>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Aucune transaction" description="Ajustez les filtres ou importez un relevé." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10"><Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} /></TableHead>
                <TableHead className="w-24">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-52">Catégorie</TableHead>
                <TableHead className="w-32 text-right">Montant</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} data-selected={selected.has(t.id)} className="group">
                  <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleRow(t.id)} /></TableCell>
                  <TableCell className="nums whitespace-nowrap text-xs text-muted-foreground">
                    {format(new Date(t.date), "dd MMM yy", { locale: fr })}
                  </TableCell>
                  <TableCell>
                    <p className="line-clamp-1 font-medium" title={t.description}>{t.description}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {t.account_name}
                      {t.is_internal_transfer && <span className="rounded bg-info/12 px-1 text-info">virement</span>}
                      {t.is_manually_reviewed && <span className="rounded bg-positive/12 px-1 text-positive">vérifié</span>}
                      {t.is_manually_edited && <span className="rounded bg-warning/15 px-1 text-warning" title="Transaction modifiée manuellement">modifié</span>}
                      {t.category_conflict && <ConflictBadge categories={t.conflict_categories} />}
                    </p>
                  </TableCell>
                  <TableCell>
                    <CategorySelect
                      value={t.category_id}
                      categories={categories}
                      accountId={t.account_id}
                      accountNames={accountNames}
                      showNamespace
                      className="h-8 border-transparent bg-transparent text-xs shadow-none hover:border-border"
                      onChange={(cid) => mut.update.mutate({ id: t.id, body: { category_id: cid } }, { onSuccess: () => toast.success("Catégorie mise à jour") })}
                    />
                  </TableCell>
                  <TableCell className={`nums blurable text-right font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                    {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency, { decimals: 2 })}
                    {/* What the bank actually charged abroad. Shown under the
                        account-currency figure, which is what every total uses. */}
                    {t.original_currency && t.original_amount_cents != null && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {formatCents(t.original_amount_cents, t.original_currency, { decimals: 2 })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-2">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      title="Modifier la transaction" aria-label="Modifier la transaction" onClick={() => openEdit(t)}>
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{countData?.total ?? rows.length} transaction(s){isFetching ? " · …" : ""}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="size-4" /></Button>
          <span>Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
        </div>
      </div>

      <TransactionDialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }} transaction={editing} />
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder, width }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string; width: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${width} h-9`}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Rich account filter: coloured tile + name + "bank · type". */
function AccountFilter({ value, onChange, accounts, width }: {
  value: string; onChange: (v: string) => void; accounts: Account[]; width: string;
}) {
  const sel = accounts.find((a) => String(a.id) === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${width} h-9`}>
        {sel ? (
          <span className="flex min-w-0 items-center gap-2">
            <AccountTile account={sel} className="size-5 text-[9px]" />
            <span className="truncate">{sel.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Tous les comptes</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Tous les comptes</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)} className={`py-1.5 ${a.is_active ? "" : "opacity-60"}`}>
            <span className="flex items-center gap-2">
              <AccountTile account={a} className="size-5 text-[9px]" />
              <span className="flex flex-col items-start leading-tight">
                <span className="flex items-center gap-1.5 text-sm">
                  {a.name}
                  {!a.is_active && <ClosedBadge />}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {a.bank_name}{a.account_type ? ` · ${ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type}` : ""}
                </span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Rich category filter: colour dots, type tint, scope, indentation; parents are
 *  selectable (the backend expands a namespace to its sub-categories). */
function CategoryFilter({ value, onChange, categories, accountNames, accountFilter, width }: {
  value: string; onChange: (v: string) => void; categories: Category[]; accountNames: Record<number, string>; accountFilter: number | null; width: string;
}) {
  const [reveal, setReveal] = useState(false);
  const visible = accountFilter == null ? categories : categories.filter((c) => c.account_id == null || c.account_id === accountFilter);
  const ordered = orderCategoryTree(visible);
  const parentIds = new Set(visible.filter((c) => c.parent_id != null).map((c) => c.parent_id));
  const anyArchived = visible.some((c) => c.archived);
  const shown = ordered.filter(({ cat }) => reveal || !cat.archived || String(cat.id) === value);
  const tint = (c: Category) => c.is_income ? "text-emerald-600 dark:text-emerald-400" : c.expense_type === "fixed" ? "text-indigo-600 dark:text-indigo-400" : c.expense_type === "variable" ? "text-amber-600 dark:text-amber-400" : "";
  const scope = (c: Category) => c.account_id == null ? "Global" : accountNames[c.account_id] ?? "Compte";
  const selCat = /^\d+$/.test(value) ? categories.find((c) => c.id === Number(value)) : undefined;
  const sentinelLabel = value === CATEGORIZED ? "Catégorisées" : value === UNCAT ? "Sans catégorie" : "Toutes catégories";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${width} h-9`}>
        {selCat ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: selCat.color }} />
            <span className={`truncate ${tint(selCat)} ${selCat.archived ? "opacity-60" : ""}`}>{selCat.name}</span>
            {selCat.archived && <ArchivedBadge className="shrink-0" />}
          </span>
        ) : (
          <span className="truncate">{sentinelLabel}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Toutes catégories</SelectItem>
        <SelectItem value={CATEGORIZED}>Catégorisées</SelectItem>
        <SelectItem value={UNCAT}>Sans catégorie</SelectItem>
        {shown.map(({ cat: c, child }) => {
          const isParent = parentIds.has(c.id);
          return (
            <SelectItem key={c.id} value={String(c.id)} className={`${child ? "pl-12" : ""} ${c.archived ? "opacity-60" : ""}`}>
              <span className={`flex items-center gap-2 ${tint(c)}`}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                {c.name}
                {c.archived && <ArchivedBadge />}
                {isParent && <span className="rounded bg-muted px-1 text-[9px] font-normal text-muted-foreground">groupe</span>}
                {!child && <span className="text-[10px] font-normal text-muted-foreground">· {scope(c)}</span>}
              </span>
            </SelectItem>
          );
        })}
        {anyArchived && (
          <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => setReveal((v) => !v)}
            className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground">
            <Archive className="size-3" /> {reveal ? "Masquer les archivées" : "Afficher les archivées"}
          </button>
        )}
      </SelectContent>
    </Select>
  );
}
