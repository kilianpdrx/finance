"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, FlaskConical, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, unwrap } from "@/lib/api/client";
import { useCategories, useRuleMutations, useCategoryMutations, previewRescan, type CategoryRule, type Account, type Transaction } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { DIRECTIONS, RULE_FIELDS, amountConditionIssue, operatorsFor, previewBreakdown, type RuleCondition } from "@/lib/rules";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { CategorySelect } from "@/components/transactions/category-select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

type Cond = RuleCondition;

// Switching a condition's field resets what no longer applies: « Sens » has two
// possible values (it starts on Dépense), every other field starts empty.
const withField = (c: Cond, field: string): Cond => ({
  field,
  operator: operatorsFor(field)[0].value,
  value: field === "is_debit" ? "true" : c.field === "is_debit" ? "" : c.value,
});

// What to say under an amount condition that cannot do what it looks like, and
// the « Sens » it was most likely meant to be.
const AMOUNT_ISSUES = {
  always: {
    text: "Un montant se compare sans son signe : cette condition est vraie pour toutes les transactions, dépenses comme revenus.",
    fix: { label: "Remplacer par Sens = Revenu", value: "false" },
  },
  never: {
    text: "Un montant se compare sans son signe : cette condition n'est jamais vraie.",
    fix: { label: "Remplacer par Sens = Dépense", value: "true" },
  },
  invalid: { text: "Ce montant n'est pas un nombre : la condition ne sera jamais vraie.", fix: null },
} as const;

/** The full categorization-rule editor: conditions builder + live "Tester"
 *  preview. Reused for creating/editing rules and for turning a recurring
 *  transaction into a rule (via `prefill`). */
export function RuleDialog({
  open,
  onOpenChange,
  accounts,
  editing = null,
  prefill = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  editing?: CategoryRule | null;
  prefill?: { description?: string; categoryId?: number | null } | null;
}) {
  const { data: categories = [] } = useCategories();
  const { create, update } = useRuleMutations();
  const { rescan } = useCategoryMutations();
  const confirm = useConfirm();

  const [conditions, setConditions] = useState<Cond[]>([{ field: "description", operator: "contains", value: "" }]);
  const [logic, setLogic] = useState<"AND" | "OR">("AND");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Transaction[] | null>(null);

  // Initialize form each time the dialog opens, from `editing` or `prefill`.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    if (editing) {
      setConditions(editing.conditions.map((c) => ({ ...c })));
      setLogic((editing.logic_operator as "AND" | "OR") ?? "AND");
      setCategoryId(editing.category_id);
      setAccountId(editing.account_id ?? null);
    } else {
      setConditions([{ field: "description", operator: "contains", value: prefill?.description ?? "" }]);
      setLogic("AND");
      // No default category: preselecting the first one of the list made it easy
      // to save a rule under a category nobody chose. 0 = "Choisir…".
      setCategoryId(prefill?.categoryId ?? 0);
      setAccountId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reapply = () =>
    rescan.mutate(undefined, {
      onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transaction(s) catégorisée(s)`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });

  // A saved rule changes nothing until it is applied, which used to be a toast
  // button that vanished after a few seconds. Say what applying would do, and
  // ask. Only uncategorised transactions are ever filled — history stays as is.
  const offerToApply = async (saved: string) => {
    let preview;
    try { preview = await previewRescan(); }
    catch { toast.success(saved); return; }
    const conflicts = preview.conflicts > 0
      ? ` ${preview.conflicts} autre(s) correspondent à des règles de catégories différentes et restent sans catégorie — le badge « conflit » dans Transactions montre lesquelles.`
      : "";
    if (preview.updated === 0) {
      toast.success(saved, { description: `Aucune transaction sans catégorie à classer.${conflicts}` });
      return;
    }
    const ok = await confirm({
      title: saved,
      description: `${preview.updated} transaction(s) sans catégorie peuvent maintenant être classées par vos règles.${conflicts} Les transactions déjà classées ne sont pas modifiées.`,
      confirmLabel: "Appliquer",
      cancelLabel: "Plus tard",
    });
    if (ok) reapply();
  };

  const runPreview = async () => {
    try {
      const res = (await unwrap(api.POST("/api/categories/rules/preview", {
        params: { query: { limit: 200 } },
        body: { conditions, account_id: accountId, logic_operator: logic },
      }))) as Transaction[];
      setPreview(res);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const submit = async () => {
    const body = { conditions, category_id: categoryId, is_active: editing?.is_active ?? true, account_id: accountId, logic_operator: logic };
    try {
      if (editing) await update.mutateAsync({ ruleId: editing.id, body });
      else await create.mutateAsync({ categoryId, body });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); return; }
    onOpenChange(false);
    await offerToApply(editing ? "Règle mise à jour" : "Règle créée");
  };

  const ruleCategory = categories.find((c) => c.id === categoryId) ?? null;
  const breakdown = previewBreakdown(preview ?? [], categoryId || null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader className="shrink-0"><DialogTitle>{editing ? "Modifier la règle" : "Nouvelle règle"}</DialogTitle></DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Catégorie</Label>
              <CategorySelect value={categoryId || null} onChange={(v) => v != null && setCategoryId(v)}
                categories={categories} accountId={accountId} hideNone placeholder="Choisir…" />
            </div>
            <div className="space-y-1"><Label>Compte</Label>
              <Select value={accountId == null ? "all" : String(accountId)} onValueChange={(v) => setAccountId(v === "all" ? null : Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Tous</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label>Conditions</Label>
            {conditions.length > 1 && (
              <div className="flex rounded-lg bg-muted p-0.5">
                {(["AND", "OR"] as const).map((l) => (
                  <button key={l} onClick={() => setLogic(l)} className={`rounded-md px-2 py-0.5 text-xs font-medium ${logic === l ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}>{l === "AND" ? "ET" : "OU"}</button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {conditions.map((cond, idx) => {
              const issue = amountConditionIssue(cond);
              return (
              <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2">
                <Select value={cond.field} onValueChange={(v) => setConditions((cs) => cs.map((c, i) => i === idx ? withField(c, v) : c))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={cond.operator} onValueChange={(v) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, operator: v } : c))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{operatorsFor(cond.field).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                {cond.field === "is_debit" ? (
                  <Select value={String(cond.value).toLowerCase() === "true" ? "true" : "false"}
                    onValueChange={(v) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, value: v } : c))}>
                    <SelectTrigger className="flex-1" aria-label="Sens"><SelectValue /></SelectTrigger>
                    <SelectContent>{DIRECTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input className="flex-1" placeholder="Valeur" value={cond.value}
                    inputMode={cond.field === "amount" ? "decimal" : undefined}
                    onChange={(e) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, value: e.target.value } : c))} />
                )}
                {conditions.length > 1 && <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => setConditions((cs) => cs.filter((_, i) => i !== idx))}><X className="size-4" /></Button>}
              </div>
              {issue && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">{AMOUNT_ISSUES[issue].text}</span>
                  {AMOUNT_ISSUES[issue].fix && (
                    <button type="button" className="shrink-0 font-semibold underline underline-offset-2"
                      onClick={() => setConditions((cs) => cs.map((c, i) => i === idx ? { field: "is_debit", operator: "equals", value: AMOUNT_ISSUES[issue].fix!.value } : c))}>
                      {AMOUNT_ISSUES[issue].fix!.label}
                    </button>
                  )}
                </p>
              )}
              </div>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => setConditions((cs) => [...cs, { field: "description", operator: "contains", value: "" }])}><Plus className="size-4" /> Condition</Button>
          </div>

          {preview != null && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-brand">
                {preview.length}{preview.length >= 200 ? "+" : ""} transaction(s) correspond(ent) à ces conditions.
              </p>
              {preview.length > 0 && (
                <>
                  {/* Where those transactions stand today: a rule only ever fills
                      the ones without a category, the others are shown so that
                      nothing it would NOT change comes as a surprise. */}
                  <p className="text-xs text-muted-foreground">
                    {breakdown.none} sans catégorie
                    {ruleCategory && <> · {breakdown.same} déjà en « {ruleCategory.name} »</>}
                    {" · "}{breakdown.other} {ruleCategory ? "dans une autre catégorie" : "déjà classée(s)"}.
                    {" "}Enregistrer la règle ne classe que celles sans catégorie.
                  </p>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                    <table className="w-full table-fixed text-xs">
                      <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="w-24 px-3 py-1.5 font-medium">Date</th>
                          <th className="px-2 py-1.5 font-medium">Libellé</th>
                          <th className="w-28 px-2 py-1.5 font-medium">Compte</th>
                          <th className="w-40 px-2 py-1.5 font-medium">Catégorie actuelle</th>
                          <th className="w-24 px-3 py-1.5 text-right font-medium">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.map((t) => {
                          const current = categories.find((c) => c.id === t.category_id);
                          return (
                            <tr key={t.id}>
                              <td className="nums whitespace-nowrap px-3 py-1.5 text-muted-foreground">{format(new Date(t.date), "dd MMM yy", { locale: fr })}</td>
                              <td className="px-2 py-1.5">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate" title={t.description}>{t.description}</span>
                                  {t.category_conflict && <ConflictBadge className="shrink-0 text-[10px]" />}
                                </span>
                              </td>
                              <td className="truncate px-2 py-1.5 text-muted-foreground">{t.account_name}</td>
                              <td className="px-2 py-1.5">
                                {current ? (
                                  <span className="flex min-w-0 items-center gap-1.5" title={current.name}>
                                    <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} />
                                    <span className={`truncate ${categoryId && current.id !== categoryId ? "font-medium text-foreground" : ""}`}>{current.name}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/70">Sans catégorie</span>
                                )}
                              </td>
                              <td className={`nums px-3 py-1.5 text-right font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                                {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={runPreview}><FlaskConical className="size-4" /> Tester</Button>
          <Button onClick={submit} disabled={!categoryId || conditions.some((c) => !c.value)}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
