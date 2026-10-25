"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, FileUp, LayoutGrid, PenLine, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SituationDialog } from "@/components/payroll/situation-dialog";
import { PayslipDialog, type PayslipDialogMode } from "@/components/payroll/payslip-dialog";
import { CustomizeDialog, EmployersDialog } from "@/components/payroll/board-dialogs";
import { WIDGET_COMPONENTS } from "@/components/payroll/widgets";
import {
  usePayrollEmployers, usePayrollMutations, usePayrollPacks, usePayrollSituations, usePayslips, useSettingMutation, useSettings,
  type Payslip,
} from "@/lib/api/hooks";
import { inRange, monthName, situationFor, type Range } from "@/lib/payroll";
import { mergeLayout, parseLayout, toLayout } from "@/lib/payroll-widgets";
import { cn } from "@/lib/utils";

/** Salaire & impôts: the user's situation, their payslips, and a board they
 *  arrange themselves. Everything is read from the payslips they imported. */
export default function SalairePage() {
  const { data: packs = [] } = usePayrollPacks();
  const { data: situations = [], isLoading: loadingSituations } = usePayrollSituations();
  const { data: employers = [] } = usePayrollEmployers();
  const { data: payslips = [], isLoading: loadingPayslips } = usePayslips();
  const { data: settings } = useSettings();
  const saveSetting = useSettingMutation();
  const { deletePayslip } = usePayrollMutations();
  const confirm = useConfirm();

  const [situationOpen, setSituationOpen] = useState(false);
  const [dialog, setDialog] = useState<PayslipDialogMode | null>(null);
  const [employersOpen, setEmployersOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [rangeKey, setRangeKey] = useState("12m");
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);

  const situation = situationFor(situations, new Date().getFullYear());
  const pack = packs.find((p) => p.id === situation?.pack);
  const defaults = useMemo(() => pack?.widgets ?? [], [pack]);
  const items = useMemo(() => mergeLayout(parseLayout(settings?.payroll_board), defaults), [settings?.payroll_board, defaults]);

  const currencies = [...new Set(payslips.map((p) => p.currency))];
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : (payslips.at(-1)?.currency ?? pack?.currency ?? "EUR");
  const years = [...new Set(payslips.map((p) => p.period.slice(0, 4)))].sort().reverse();
  const range: Range = rangeKey === "all" ? { kind: "all" } : rangeKey === "12m" ? { kind: "12m" } : { kind: "year", year: Number(rangeKey) };
  const all = payslips.filter((p) => p.currency === currency);
  const shown = inRange(all, range);

  const remove = async (p: Payslip) => {
    const ok = await confirm({
      title: `Supprimer la fiche de ${monthName(p.period)} ?`, destructive: true, confirmLabel: "Supprimer",
      description: "La fiche, ses lignes et son PDF sont supprimés de l'application.",
    });
    if (ok) deletePayslip.mutate(p.id, {
      onSuccess: () => toast.success("Fiche supprimée"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  };

  const saveLayout = (next: { id: string; visible: boolean }[]) =>
    saveSetting.mutate({ key: "payroll_board", value: JSON.stringify(toLayout(next)) }, { onSuccess: () => toast.success("Tableau enregistré") });

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Salaire &amp; impôts</h1>
        {situation ? (
          <p className="text-muted-foreground">
            {situation.summary} ·{" "}
            <button type="button" className="text-brand hover:underline" onClick={() => setSituationOpen(true)}>Modifier</button>
          </p>
        ) : (
          <p className="text-muted-foreground">Vos fiches de paie, lues sur cet ordinateur, et leur évolution.</p>
        )}
      </div>
      {situation && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog({ kind: "import" })}><FileUp className="mr-1.5 size-4" /> Importer des fiches</Button>
          <Button variant="outline" onClick={() => setDialog({ kind: "manual" })}><PenLine className="mr-1.5 size-4" /> Saisir</Button>
          <Button variant="outline" onClick={() => setEmployersOpen(true)}><Building2 className="mr-1.5 size-4" /> Employeurs</Button>
          <Button variant="outline" onClick={() => setCustomizeOpen(true)}><LayoutGrid className="mr-1.5 size-4" /> Personnaliser</Button>
        </div>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (loadingSituations || loadingPayslips) {
    body = <Skeleton className="h-80 w-full rounded-2xl" />;
  } else if (!situation) {
    body = (
      <Card>
        <EmptyState icon={ReceiptText} title="Décrivez d'abord votre situation"
          description="France ou Zurich, imposition à la source ou ordinaire : elle décide comment vos fiches de paie sont lues."
          action={<Button onClick={() => setSituationOpen(true)}>Choisir ma situation</Button>} />
      </Card>
    );
  } else if (payslips.length === 0) {
    body = (
      <Card>
        <EmptyState icon={FileUp} title="Importez vos fiches de paie"
          description="Déposez les PDF : chaque fiche est lue sur cet ordinateur, vous la vérifiez, puis vous l'enregistrez."
          action={<div className="flex gap-2">
            <Button onClick={() => setDialog({ kind: "import" })}>Importer des fiches</Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "manual" })}>Saisir à la main</Button>
          </div>} />
      </Card>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={rangeKey} onValueChange={setRangeKey}>
            <SelectTrigger aria-label="Période" className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="12m">12 derniers mois</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              <SelectItem value="all">Tout</SelectItem>
            </SelectContent>
          </Select>
          {currencies.length > 1 && (
            <Select value={currency} onValueChange={setChosenCurrency}>
              <SelectTrigger aria-label="Devise" className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground">{shown.length} fiche{shown.length > 1 ? "s" : ""}</span>
        </div>
        {/* Dense: a half-width card fills the gap a full-width one left, whatever the order chosen. */}
        <div className="grid gap-4 lg:grid-flow-row-dense lg:grid-cols-2">
          {items.filter((w) => w.visible && WIDGET_COMPONENTS[w.id]).map((w) => {
            const { component: Widget, wide } = WIDGET_COMPONENTS[w.id];
            return (
              <div key={w.id} className={cn("min-w-0", wide && "lg:col-span-2")}>
                <Widget payslips={shown} all={all} employers={employers} currency={currency}
                  onEdit={(p) => setDialog({ kind: "edit", payslip: p })} onDelete={remove} />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      {body}
      <SituationDialog open={situationOpen} onOpenChange={setSituationOpen} current={situation} />
      {dialog && <PayslipDialog open onOpenChange={(v) => { if (!v) setDialog(null); }} mode={dialog} pack={pack} />}
      <EmployersDialog open={employersOpen} onOpenChange={setEmployersOpen} />
      <CustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} items={items} defaults={defaults} onSave={saveLayout} />
    </div>
  );
}
