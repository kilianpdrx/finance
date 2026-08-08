"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Search, Plus, Download, Shuffle, Trash2, CheckCheck, ArrowLeftRight, X, Inbox, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySelect } from "@/components/transactions/category-select";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  useAccounts, useCategories, useTransactionMeta, useTransactions, useTransactionCount, useTransactionMutations,
  type TransactionFilters, type Transaction,
} from "@/lib/api/hooks";
import { orderCategoryTree } from "@/lib/group";
import { formatCents } from "@/lib/format";

const PAGE = 100;
const ALL = "__all__";
const UNCAT = "__uncat__";
const CATEGORIZED = "__has_cat__";

export default function TransactionsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: meta } = useTransactionMeta();
  const mut = useTransactionMutations();
  const confirm = useConfirm();

  // The account filter only lists current accounts (no savings/credit/investment).
  const txAccounts = useMemo(() => accounts.filter((a) => a.account_type === "courant"), [accounts]);
  const accountNames = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>, [accounts]);

  const [searchInput, setSearchInput] = useState("");
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

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Rechercher…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <FilterSelect value={account} onChange={(v) => { setAccount(v); setPage(0); }} placeholder="Compte" width="w-40"
          options={[{ value: ALL, label: "Tous les comptes" }, ...txAccounts.map((a) => ({ value: String(a.id), label: a.name }))]} />
        <FilterSelect value={category} onChange={(v) => { setCategory(v); setPage(0); }} placeholder="Catégorie" width="w-48"
          options={[
            { value: ALL, label: "Toutes catégories" },
            { value: CATEGORIZED, label: "Catégorisées" },
            { value: UNCAT, label: "Sans catégorie" },
            ...orderCategoryTree(
              categories.filter((c) => account === ALL || c.account_id == null || c.account_id === Number(account)),
            ).map(({ cat: c, child }) => ({
              value: String(c.id),
              label: `${child ? "   ↳ " : ""}${c.name}${child ? "" : ` · ${c.account_id == null ? "Global" : accountNames[c.account_id] ?? "Compte"}`}`,
            })),
          ]} />
        <FilterSelect value={type} onChange={(v) => { setType(v); setPage(0); }} placeholder="Type" width="w-32"
          options={[{ value: ALL, label: "Tout" }, { value: "debit", label: "Dépenses" }, { value: "credit", label: "Revenus" }]} />
        <FilterSelect value={month} onChange={(v) => { setMonth(v); setPage(0); }} placeholder="Mois" width="w-32"
          options={[{ value: ALL, label: "Tous les mois" }, ...(meta?.available_months ?? []).map((m) => ({ value: m, label: m }))]} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={hideTransfers} onCheckedChange={(v) => { setHideTransfers(v); setPage(0); }} />
          Masquer virements
        </label>
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
          <div className="ml-2 w-48">
            <CategorySelect value={null} placeholder="Catégoriser…" categories={categories} accountNames={accountNames}
              onChange={(cid) => runBulk(() => mut.bulkCategory.mutateAsync({ ids, category_id: cid }), "Catégorie appliquée")} />
          </div>
          <Button variant="outline" size="sm" onClick={() => runBulk(() => mut.bulkReviewed.mutateAsync({ ids, value: true }), "Marquées vérifiées")}>
            <CheckCheck className="size-4" /> Vérifié
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
                    <p className="line-clamp-1 font-medium">{t.description}</p>
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
                      className="h-8 border-transparent bg-transparent text-xs shadow-none hover:border-border"
                      onChange={(cid) => mut.update.mutate({ id: t.id, body: { category_id: cid } }, { onSuccess: () => toast.success("Catégorie mise à jour") })}
                    />
                  </TableCell>
                  <TableCell className={`nums blurable text-right font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                    {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency, { decimals: 2 })}
                  </TableCell>
                  <TableCell className="pr-2">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      title="Modifier la transaction" onClick={() => openEdit(t)}>
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
