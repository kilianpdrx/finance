"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  readPayslips, useAccounts, usePayrollEmployers, usePayrollLabelRules, usePayrollMutations, usePayslips,
  type Payslip, type PayslipLabelRule, type PayrollPack,
} from "@/lib/api/hooks";
import { monthName } from "@/lib/payroll";
import {
  canSave, compare, draftFromPayslip, draftFromRead, draftManual, draftStatus, draftToBody, forEmployer, nextMonth,
  type Draft, type DraftStatus,
} from "@/lib/payroll-review";
import { cn } from "@/lib/utils";
import { PayslipReview } from "./payslip-review";
import { PdfViewer, type PdfTarget } from "./pdf-viewer";

export type PayslipDialogMode = { kind: "import" } | { kind: "manual" } | { kind: "edit"; payslip: Payslip };

const STATUS: Record<DraftStatus, { label: string; className: string }> = {
  ready: { label: "prête", className: "bg-positive/10 text-positive" },
  check: { label: "à vérifier", className: "bg-warning/15 text-foreground" },
  duplicate: { label: "déjà importée", className: "bg-muted text-muted-foreground" },
  error: { label: "illisible", className: "bg-negative/10 text-negative" },
  saved: { label: "enregistrée", className: "bg-brand/10 text-brand" },
};

const NO_ACCOUNT = "__none__";
// Stable while loading: the effect re-arranging the drafts depends on them.
const NO_RULES: PayslipLabelRule[] = [];
const NO_PAYSLIPS: Payslip[] = [];

/** Import payslips: drop PDFs, check each one, save. Also the form for a
 *  payslip typed by hand, and the correction of a saved one — the same review.
 *  Nothing is saved before « Enregistrer »: reading a PDF keeps nothing. */
export function PayslipDialog({ open, onOpenChange, mode, pack }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: PayslipDialogMode;
  /** The situation in force: its vocabulary reads the PDFs, its currency is the employer's default. */
  pack: PayrollPack | undefined;
}) {
  const { data: employers = [] } = usePayrollEmployers();
  const rules = usePayrollLabelRules().data ?? NO_RULES;
  const payslips = usePayslips().data ?? NO_PAYSLIPS;
  const { data: accounts = [] } = useAccounts();
  const { savePayslip, updatePayslip, createEmployer } = usePayrollMutations();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newEmployer, setNewEmployer] = useState<{ name: string; accountId: string; currency: string } | null>(null);
  const [target, setTarget] = useState<PdfTarget | null>(null);
  const [showPdf, setShowPdf] = useState(true);
  const [view, setView] = useState<"review" | "pdf">("review");
  const input = useRef<HTMLInputElement>(null);
  const currency = pack?.currency ?? "EUR";
  const defaultEmployer = employers.length === 1 ? employers[0].id : null;

  useEffect(() => {
    if (!open) return;
    setNewEmployer(null);
    if (mode.kind === "edit") {
      const d = draftFromPayslip(mode.payslip);
      setDrafts([d]);
      setSelected(d.uid);
    } else if (mode.kind === "manual") {
      // The month after the employer's latest payslip: the one to type next.
      const now = new Date();
      const latest = payslips.filter((p) => p.employer_id === defaultEmployer).map((p) => p.period).sort().at(-1);
      const period = latest ? nextMonth(latest) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const d = forEmployer(draftManual(defaultEmployer, period), rules, payslips, defaultEmployer);
      setDrafts([d]);
      setSelected(d.uid);
    } else {
      setDrafts([]);
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const update = (d: Draft) => setDrafts((all) => all.map((x) => (x.uid === d.uid ? { ...d, edited: true } : x)));
  const current = drafts.find((d) => d.uid === selected) ?? null;
  useEffect(() => { setTarget(null); }, [selected]);

  // What was just saved (a classification, an order) applies to every draft
  // the user has not touched yet: arrange January, save, and the rest follows.
  useEffect(() => {
    setDrafts((all) => all.map((d) => (d.saved || d.edited || d.error || d.payslipId != null || d.employerId == null
      ? d : forEmployer(d, rules, payslips, d.employerId))));
  }, [rules, payslips]);

  // Each draft against the employer's payslip before it, saved or in this import.
  const comparisons = useMemo(() => new Map(drafts.map((d) => [d.uid, compare(d, payslips, drafts)])), [drafts, payslips]);
  const status = (d: Draft) => draftStatus(d, comparisons.get(d.uid));
  const pdfSource = current && !current.error
    ? (current.file ?? (current.documentId != null ? `/api/payroll/documents/${current.documentId}` : null)) : null;
  const pdfOpen = pdfSource != null && showPdf;

  const read = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length || !pack) return;
    setReading(true);
    try {
      const results = await readPayslips(pdfs, pack.id, defaultEmployer);
      const next = results.map((r, i) => forEmployer(draftFromRead(r, pdfs[i], defaultEmployer), rules, payslips, defaultEmployer))
        .sort((a, b) => (a.period || "9999").localeCompare(b.period || "9999"));
      setDrafts((old) => [...old.filter((d) => d.saved), ...next]);
      setSelected(next.find((d) => draftStatus(d) !== "ready")?.uid ?? next[0]?.uid ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lecture impossible");
    } finally {
      setReading(false);
    }
  };

  const saveOne = async (d: Draft): Promise<boolean> => {
    try {
      const body = draftToBody(d);
      if (d.payslipId != null) await updatePayslip.mutateAsync({ id: d.payslipId, body });
      else await savePayslip.mutateAsync({ body, file: d.file });
      setDrafts((all) => all.map((x) => (x.uid === d.uid ? { ...x, saved: true } : x)));
      return true;
    } catch (e) {
      toast.error(`${d.period ? monthName(d.period) : d.filename ?? "Fiche"} : ${e instanceof Error ? e.message : "erreur"}`);
      return false;
    }
  };

  const saveCurrent = async () => {
    if (!current) return;
    setSaving(true);
    const ok = await saveOne(current);
    setSaving(false);
    if (!ok) return;
    toast.success("Fiche de paie enregistrée");
    if (mode.kind !== "import") { onOpenChange(false); return; }
    const next = drafts.find((d) => d.uid !== current.uid && !d.saved && status(d) !== "error" && status(d) !== "duplicate");
    if (next) setSelected(next.uid);
  };

  const ready = drafts.filter((d) => status(d) === "ready");
  const saveReady = async () => {
    setSaving(true);
    let n = 0;
    for (const d of ready) if (await saveOne(d)) n += 1;
    setSaving(false);
    if (n) toast.success(`${n} fiche${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""}`);
  };

  const addEmployer = () => {
    if (!newEmployer?.name.trim()) return;
    createEmployer.mutate({
      name: newEmployer.name, currency: newEmployer.currency,
      account_id: newEmployer.accountId === NO_ACCOUNT ? null : Number(newEmployer.accountId),
    }, {
      onSuccess: (e) => {
        setNewEmployer(null);
        // Every draft still without an employer gets this one.
        setDrafts((all) => all.map((d) => (d.uid === selected || d.employerId == null ? forEmployer(d, rules, payslips, e.id) : d)));
        toast.success(`Employeur « ${e.name} » ajouté`);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  };

  const title = mode.kind === "edit" ? `Fiche de paie · ${monthName(mode.payslip.period)}`
    : mode.kind === "manual" ? "Saisir une fiche de paie" : "Importer des fiches de paie";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Escape leaves a field, never the dialog: it may hold a dozen checked payslips. */}
      <DialogContent onEscapeKeyDown={(e) => e.preventDefault()} className="flex h-[94vh] w-[98vw] max-w-[120rem] flex-col">
        <DialogHeader className="shrink-0 flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="space-y-1.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode.kind === "import"
                ? "Les PDF sont lus sur cet ordinateur. Vérifiez chaque fiche : rien n'est enregistré avant « Enregistrer »."
                : "Les montants tels qu'imprimés sur la fiche."}
            </DialogDescription>
          </div>
          {pdfSource != null && (
            <>
              {/* Narrow: the review or the PDF, one at a time. */}
              <div role="tablist" aria-label="Affichage" className="mr-8 inline-flex rounded-lg border border-border p-0.5 text-xs xl:hidden">
                {([["review", "Fiche"], ["pdf", "PDF"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                    className={cn("rounded-md px-2.5 py-1", view === v ? "bg-brand/15 text-brand" : "text-muted-foreground")}>{l}</button>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mr-8 hidden xl:inline-flex" onClick={() => setShowPdf(!showPdf)}>
                {showPdf ? <PanelRightClose className="mr-1.5 size-3.5" /> : <PanelRightOpen className="mr-1.5 size-3.5" />}
                {showPdf ? "Masquer le PDF" : "Afficher le PDF"}
              </Button>
            </>
          )}
        </DialogHeader>

        <div className={cn("min-h-0 flex-1 overflow-y-auto md:grid md:gap-5 md:overflow-hidden",
          mode.kind === "import"
            ? cn("md:grid-cols-[16rem_minmax(0,1fr)]", pdfOpen && "xl:grid-cols-[13rem_minmax(0,1.3fr)_minmax(0,1fr)]")
            : cn("md:grid-cols-1", pdfOpen && "xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"))}>
          {mode.kind === "import" && (
            <aside aria-label="Fichiers" className="mb-4 space-y-2 md:mb-0 md:overflow-y-auto">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void read(Array.from(e.dataTransfer.files)); }}
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground"
              >
                {reading ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}
                <span>Déposez vos fiches de paie (PDF)</span>
                <Button size="sm" variant="outline" disabled={reading || !pack} onClick={() => input.current?.click()}>Choisir des fichiers</Button>
                <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Fiches de paie (PDF)"
                  onChange={(e) => { void read(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              </div>
              <ul className="space-y-1">
                {drafts.map((d) => {
                  const st = status(d);
                  return (
                    <li key={d.uid}>
                      <button type="button" onClick={() => setSelected(d.uid)}
                        className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                          d.uid === selected ? "bg-muted" : "hover:bg-muted/50")}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{d.period ? monthName(d.period) : "Mois inconnu"}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{d.filename}</span>
                        </span>
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS[st].className)}>{STATUS[st].label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}

          <div className={cn("min-w-0 md:overflow-y-auto md:pr-1", pdfSource != null && view === "pdf" && "hidden xl:block")}>
            {newEmployer ? (
              <section aria-label="Nouvel employeur" className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-sm font-medium">Nouvel employeur</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="employer-name">Nom</Label>
                    <Input id="employer-name" value={newEmployer.name} autoFocus onChange={(e) => setNewEmployer({ ...newEmployer, name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="employer-account">Compte où arrive le salaire</Label>
                    <Select value={newEmployer.accountId} onValueChange={(v) => setNewEmployer({ ...newEmployer, accountId: v })}>
                      <SelectTrigger id="employer-account"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ACCOUNT}>Aucun pour l&apos;instant</SelectItem>
                        {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} · {a.currency}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="employer-currency">Devise du salaire</Label>
                    <Input id="employer-currency" value={newEmployer.currency} maxLength={3} className="w-24 uppercase"
                      onChange={(e) => setNewEmployer({ ...newEmployer, currency: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={addEmployer} disabled={!newEmployer.name.trim() || newEmployer.currency.length !== 3 || createEmployer.isPending}>Ajouter</Button>
                  <Button size="sm" variant="outline" onClick={() => setNewEmployer(null)}>Annuler</Button>
                </div>
              </section>
            ) : current ? (
              <PayslipReview draft={current} onChange={update} employers={employers} rules={rules} existing={payslips}
                comparison={comparisons.get(current.uid)!} onTarget={setTarget}
                currency={employers.find((e) => e.id === current.employerId)?.currency ?? currency}
                onNewEmployer={() => setNewEmployer({ name: "", accountId: NO_ACCOUNT, currency })} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {reading ? "Lecture des fiches…" : "Déposez une ou plusieurs fiches de paie à gauche."}
              </p>
            )}
          </div>

          {pdfSource != null && (
            <div className={cn("h-[75vh] min-w-0 md:h-full md:min-h-0", view === "pdf" ? "block" : "hidden", showPdf ? "xl:block" : "xl:hidden")}>
              <PdfViewer source={pdfSource} target={target} />
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {mode.kind === "import" && drafts.length > 0 && `${drafts.filter((d) => d.saved).length} enregistrée(s) sur ${drafts.length}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
            {mode.kind === "import" && ready.length > 1 && (
              <Button variant="outline" onClick={saveReady} disabled={saving}>Enregistrer les {ready.length} fiches prêtes</Button>
            )}
            <Button onClick={saveCurrent} disabled={saving || !current || !canSave(current) || newEmployer != null}>
              {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
