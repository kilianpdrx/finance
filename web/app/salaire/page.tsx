"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, FileUp, PenLine, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SituationDialog } from "@/components/payroll/situation-dialog";
import { PayslipDialog, type PayslipDialogMode } from "@/components/payroll/payslip-dialog";
import { EmployersDialog } from "@/components/payroll/employers-dialog";
import { Swatch, employerName, type PayrollView } from "@/components/payroll/common";
import { EmployerTimeline } from "@/components/payroll/timeline";
import { EvolutionCard, RatesCard, RetainedCard, SummaryTiles, hasRetained } from "@/components/payroll/overview";
import { EmployerCards, EmployerCompare, MonthCard } from "@/components/payroll/by-employer";
import { PayslipList } from "@/components/payroll/payslip-list";
import {
  usePayrollEmployers, usePayrollMutations, usePayrollPacks, usePayrollSituations, usePayslips, type Payslip,
} from "@/lib/api/hooks";
import { bounds, employerColors, monthName, situationFor, within, yearBefore, type Bounds, type Range } from "@/lib/payroll";

type Tab = "synthese" | "employeurs" | "fiches";
const ALL = "__all__";

/** Salaire & impôts: the user's situation and their payslips, in three tabs.
 *  The period, the employer and the currency chosen above the tabs apply to
 *  every figure, chart and list in them. Everything is read from the payslips
 *  they imported. */
export default function SalairePage() {
  const { data: packs = [] } = usePayrollPacks();
  const { data: situations = [], isLoading: loadingSituations } = usePayrollSituations();
  const { data: employers = [] } = usePayrollEmployers();
  const { data: payslips = [], isLoading: loadingPayslips } = usePayslips();
  const { deletePayslip } = usePayrollMutations();
  const confirm = useConfirm();

  const [situationOpen, setSituationOpen] = useState(false);
  const [dialog, setDialog] = useState<PayslipDialogMode | null>(null);
  const [employersOpen, setEmployersOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("synthese");
  const [rangeKey, setRangeKey] = useState("12m");
  const [custom, setCustom] = useState<Bounds | null>(null);
  const [employerId, setEmployerId] = useState<number | null>(null);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);

  const situation = situationFor(situations, new Date().getFullYear());
  const pack = packs.find((p) => p.id === situation?.pack);
  const colors = useMemo(() => employerColors(payslips, employers), [payslips, employers]);

  // Employers that paid something, in the order they started: their colours' order.
  const paying = [...colors.keys()].map((id) => employers.find((e) => e.id === id)!)
    .filter((e) => payslips.some((p) => p.employer_id === e.id));
  const employer = employerId != null && paying.some((e) => e.id === employerId) ? employerId : null;
  const currencies = [...new Set(payslips.map((p) => p.currency))];
  const currency = employer != null ? payslips.find((p) => p.employer_id === employer)!.currency
    : chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : (payslips.at(-1)?.currency ?? pack?.currency ?? "EUR");

  const ofEmployer = payslips.filter((p) => employer == null || p.employer_id === employer);
  const all = ofEmployer.filter((p) => p.currency === currency);
  const years = [...new Set(ofEmployer.map((p) => p.period.slice(0, 4)))].sort().reverse();
  const range: Range = rangeKey === "all" ? { kind: "all" } : rangeKey === "12m" ? { kind: "12m" }
    : rangeKey === "custom" ? (custom ? { kind: "custom", ...custom } : { kind: "12m" }) : { kind: "year", year: Number(rangeKey) };
  const shownBounds = bounds(all, range);
  const shown = within(all, shownBounds);
  const previous = range.kind === "all" || !shownBounds ? null : yearBefore(shownBounds, shown);

  const remove = async (p: Payslip) => {
    const ok = await confirm({
      title: `Supprimer la fiche de ${monthName(p.period)} (${employerName(employers, p.employer_id)}) ?`, destructive: true, confirmLabel: "Supprimer",
      description: "La fiche, ses lignes et son PDF sont supprimés de l'application.",
    });
    if (ok) deletePayslip.mutate(p.id, {
      onSuccess: () => toast.success("Fiche supprimée"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  };

  const view: PayrollView = {
    payslips: shown, all, bounds: shownBounds, before: previous ? { bounds: previous, payslips: within(all, previous) } : null,
    employers, colors, currency, onEdit: (p) => setDialog({ kind: "edit", payslip: p }), onDelete: remove,
  };
  const choosePeriod = (v: string) => {
    if (v === "custom" && !custom) setCustom(shownBounds ?? bounds(all, { kind: "12m" }));
    setRangeKey(v);
  };
  const showAll = () => { setRangeKey("all"); setEmployerId(null); };

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
    const listed = within(ofEmployer, shownBounds);
    body = (
      <>
        <div role="group" aria-label="Ce qui est affiché" className="flex flex-wrap items-center gap-2">
          <Select value={rangeKey} onValueChange={choosePeriod}>
            <SelectTrigger aria-label="Période" className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="12m">12 derniers mois</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              <SelectItem value="all">Tout</SelectItem>
              <SelectItem value="custom">Personnalisée…</SelectItem>
            </SelectContent>
          </Select>
          {rangeKey === "custom" && custom && (
            <span className="flex items-center gap-1.5 text-sm">
              <label htmlFor="period-from" className="text-muted-foreground">du</label>
              <Input id="period-from" type="month" className="h-9 w-40" value={custom.from}
                onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
              <label htmlFor="period-to" className="text-muted-foreground">au</label>
              <Input id="period-to" type="month" className="h-9 w-40" value={custom.to}
                onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
            </span>
          )}
          {paying.length > 1 && (
            <Select value={employer != null ? String(employer) : ALL} onValueChange={(v) => setEmployerId(v === ALL ? null : Number(v))}>
              <SelectTrigger aria-label="Employeur" className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les employeurs</SelectItem>
                {paying.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    <span className="flex items-center gap-2"><Swatch color={colors.get(e.id)} />{e.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {currencies.length > 1 && employer == null && (
            <Select value={currency} onValueChange={setChosenCurrency}>
              <SelectTrigger aria-label="Devise" className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground">
            {shown.length} fiche{shown.length > 1 ? "s" : ""}{currencies.length > 1 && ` en ${currency}`}
          </span>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="synthese">Synthèse</TabsTrigger>
            <TabsTrigger value="employeurs">Par employeur</TabsTrigger>
            <TabsTrigger value="fiches">Fiches de paie</TabsTrigger>
          </TabsList>

          <TabsContent value="synthese" className="space-y-4">
            <SummaryTiles view={view} />
            <EmployerTimeline payslips={within(payslips, shownBounds)} bounds={shownBounds} employers={employers} colors={colors}
              selected={employer} onSelect={(id) => setEmployerId(id === employer ? null : id)}
              onGap={(id) => { setEmployerId(id); setTab("fiches"); }}
              onShowAll={range.kind === "all" ? undefined : () => setRangeKey("all")} />
            <div className="grid gap-4 lg:grid-flow-row-dense lg:grid-cols-2">
              <div className="min-w-0 lg:col-span-2"><EvolutionCard view={view} /></div>
              <RatesCard view={view} className={hasRetained(view) ? undefined : "lg:col-span-2"} />
              {hasRetained(view) && <RetainedCard view={view} />}
            </div>
          </TabsContent>

          <TabsContent value="employeurs" className="space-y-4">
            <EmployerCards view={view} onShowPayslips={(id) => { setEmployerId(id); setTab("fiches"); }} />
            <EmployerCompare view={view} />
            <MonthCard view={view} />
          </TabsContent>

          <TabsContent value="fiches">
            <PayslipList payslips={listed} total={payslips.length} employers={employers} colors={colors}
              onEdit={view.onEdit} onDelete={remove} onShowAll={showAll} />
          </TabsContent>
        </Tabs>
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
    </div>
  );
}
