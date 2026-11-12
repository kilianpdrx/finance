"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, GripVertical, Plus, Undo2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Employer, Payslip, PayslipLabelRule } from "@/lib/api/hooks";
import {
  BLOCKS, EFFECT, KIND_LABEL, KIND_ORDER, blockOf, blockTotal, formatRate, linesNet, monthName, ofMonth, type Block, type Kind,
} from "@/lib/payroll";
import {
  addLine, checkDraft, comparisonNotes, draftFigures, forEmployer, grossFromLines, labelKey, lineLikes, moveLine, moveLineTo, restoreLine, setKind,
  type Comparison, type Draft, type DraftLine,
} from "@/lib/payroll-review";
import { amountToCents, centsToAmount } from "@/lib/budget-plan";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PdfTarget } from "./pdf-viewer";

export const NEW_EMPLOYER = "__new__";
const UNSET = "__unset__";

/** One payslip under review: the figures read (or typed), each line in its
 *  block with what it does to the pay, a subtotal per block checked against
 *  what the PDF prints, and the payslip before it from the same employer.
 *  Nothing is saved from here; the dialog saves. */
export function PayslipReview({ draft, onChange, employers, rules, existing, comparison, currency, onNewEmployer, onTarget }: {
  draft: Draft;
  onChange: (d: Draft) => void;
  employers: Employer[];
  rules: PayslipLabelRule[];
  /** Saved payslips: to say when this month is already there, and the employer's memory. */
  existing: Payslip[];
  comparison: Comparison;
  currency: string;
  onNewEmployer: () => void;
  /** The line being checked, to highlight in the PDF. */
  onTarget?: (t: PdfTarget | null) => void;
}) {
  const checks = checkDraft(draft);
  const figures = draftFigures(draft);
  const withLines = draft.lines.length > 0;

  // The PDF read, viewable in its own tab before anything is saved.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.file) { setPdfUrl(null); return; }
    const url = URL.createObjectURL(draft.file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.file]);

  const set = (change: Partial<Draft>) => onChange({ ...draft, ...change });
  const employerName = useMemo(() => new Map(employers.map((e) => [e.id, e.name])), [employers]);
  const money = (cents: number | null | undefined) => (cents == null ? "—" : formatCents(cents, currency, { decimals: 2 }));
  const field = (id: string, label: string, value: string, onValue: (v: string) => void, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} inputMode="decimal" placeholder="0" className="nums text-right" onChange={(e) => onValue(e.target.value)} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );

  const notes: { tone: "warn" | "ok"; text: string }[] = [];
  if (draft.saved) notes.push({ tone: "ok", text: "Fiche enregistrée." });
  if (draft.error) notes.push({ tone: "warn", text: draft.error });
  if (draft.noText) notes.push({ tone: "warn", text: "Ce PDF ne contient pas de texte (un scan ?) : saisissez les montants ci-dessous." });
  if (draft.duplicatePayslipId != null) notes.push({ tone: "warn", text: "Ce PDF est déjà enregistré : il n'est pas importé une deuxième fois." });
  if (draft.filledFrom) notes.push({ tone: "warn", text: `Repris ${ofMonth(draft.filledFrom)} : modifiez ce qui a changé.` });
  if (checks.unclassified) notes.push({ tone: "warn", text: `${checks.unclassified} ligne${checks.unclassified > 1 ? "s" : ""} à classer : choisissez ce que fait chacune. Votre choix vaudra pour les fiches suivantes de cet employeur.` });
  if (!checks.periodOk) notes.push({ tone: "warn", text: "Le mois de la fiche n'a pas été trouvé : choisissez-le." });
  if (checks.netGap) {
    notes.push({ tone: "warn", text: `Les lignes donnent ${money(figures.net_paid_cents + checks.netGap)} de net, la fiche imprime ${money(figures.net_paid_cents)} (écart ${money(checks.netGap)}) : vérifiez le type des lignes.` });
  } else if (withLines && !checks.unclassified && draft.net.trim()) {
    notes.push({ tone: "ok", text: "Les lignes retombent exactement sur le net versé." });
  }
  if (!draft.saved && !draft.error) notes.push(...comparisonNotes(comparison));

  return (
    <div className="space-y-4">
      {(draft.filename || pdfUrl) && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="truncate font-medium">{draft.filename}</span>
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
              <ExternalLink className="size-3" /> Voir le PDF
            </a>
          )}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.text} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
              n.tone === "ok" ? "bg-positive/10 text-positive" : "bg-warning/10 text-foreground")}>
              {n.tone === "ok" ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />}
              {n.text}
            </li>
          ))}
        </ul>
      )}

      {!draft.error && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`${draft.uid}-employer`}>Employeur</Label>
              <Select value={draft.employerId != null ? String(draft.employerId) : UNSET}
                onValueChange={(v) => (v === NEW_EMPLOYER ? onNewEmployer() : onChange(forEmployer(draft, rules, existing, Number(v))))}>
                <SelectTrigger id={`${draft.uid}-employer`}><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>
                  {draft.employerId == null && <SelectItem value={UNSET} disabled>Choisir…</SelectItem>}
                  {employers.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                  <SelectItem value={NEW_EMPLOYER}>+ Nouvel employeur…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${draft.uid}-period`}>Mois payé</Label>
              <Input id={`${draft.uid}-period`} type="month" value={draft.period} onChange={(e) => set({ period: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${draft.uid}-paydate`}>Date de versement</Label>
              <Input id={`${draft.uid}-paydate`} type="date" value={draft.payDate} onChange={(e) => set({ payDate: e.target.value })} />
            </div>
          </div>

          {/* One payslip per employer and month: another employer the same month is welcome,
              so the first answer offered is to choose (or add) that employer, not to replace. */}
          {comparison.clash && draft.employerId != null && (
            <div role="alert" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p>
                {employerName.get(draft.employerId)} a déjà une fiche {ofMonth(draft.period)}
                {comparison.clash === "draft" ? " dans cet import" : ""}. Si celle-ci vient d&apos;un autre employeur, choisissez-le
                ci-dessus ou{" "}
                <button type="button" className="text-brand hover:underline" onClick={onNewEmployer}>ajoutez-le</button>.
              </p>
              {comparison.clash === "saved" && (
                <label className="flex items-center gap-2">
                  <Checkbox checked={draft.replace} onCheckedChange={(v) => set({ replace: v === true })} />
                  C&apos;est la même fiche, corrigée : remplacer celle enregistrée.
                </label>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {grossFromLines(draft) ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">Salaire brut</p>
                <p className="nums py-2 text-sm">{money(figures.gross_cents)}</p>
                <p className="text-[11px] text-muted-foreground">la somme des lignes</p>
              </div>
            ) : field(`${draft.uid}-gross`, `Salaire brut (${currency})`, draft.gross, (v) => set({ gross: v }))}
            {withLines ? (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Cotisations</p>
                  <p className="nums py-2 text-sm">{money(figures.employee_contributions_cents)}</p>
                  <p className="text-[11px] text-muted-foreground">la somme des lignes</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Impôt à la source</p>
                  <p className="nums py-2 text-sm">{money(figures.withholding_cents)} <span className="text-muted-foreground">· {formatRate(figures.withholding_rate_bp)}</span></p>
                  <p className="text-[11px] text-muted-foreground">la somme des lignes</p>
                </div>
              </>
            ) : (
              <>
                {field(`${draft.uid}-contributions`, "Cotisations", draft.contributions, (v) => set({ contributions: v }), "AVS, chômage, prévoyance…")}
                {field(`${draft.uid}-withholding`, "Impôt à la source", draft.withholding, (v) => set({ withholding: v }))}
              </>
            )}
            {field(`${draft.uid}-net`, `Net versé (${currency})`, draft.net, (v) => set({ net: v }), "tel qu'imprimé")}
          </div>
          {!withLines && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {field(`${draft.uid}-rate`, "Taux de l'impôt (%)", draft.withholdingRate, (v) => set({ withholdingRate: v }))}
              {field(`${draft.uid}-taxable`, "Salaire imposable", draft.taxable, (v) => set({ taxable: v }))}
            </div>
          )}

          <Lines draft={draft} onChange={onChange} comparison={comparison} money={money} onTarget={onTarget} />
        </>
      )}
    </div>
  );
}

/** The lines block by block: drag (or ↑/↓) inside a block, change a line's
 *  type to move it to another, and a subtotal under each block. */
function Lines({ draft, onChange, comparison, money, onTarget }: {
  draft: Draft;
  onChange: (d: Draft) => void;
  comparison: Comparison;
  money: (c: number | null | undefined) => string;
  onTarget?: (t: PdfTarget | null) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ref = comparison.ref;
  const likes = lineLikes(draft);
  const refLikes = ref?.lines.map((l) => ({ kind: l.kind, amount_cents: l.amount_cents })) ?? [];
  const setLine = (uid: string, change: Partial<DraftLine>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.uid === uid ? { ...l, ...change } : l)) });
  const blocks = BLOCKS.filter((b) => draft.lines.some((l) => blockOf(l.kind) === b));
  const lastCounted = blocks.filter((b) => b.id !== "info").at(-1);
  const cols = ref ? 8 : 7;

  // The n-th line of a label in the PDF is the n-th row printing it.
  const target = (l: DraftLine): PdfTarget => ({
    key: l.key,
    occurrence: draft.lines.filter((x) => x.key === l.key).sort((a, b) => a.seq - b.seq).indexOf(l),
  });

  const check = (computed: number, printed: number | null) => {
    if (printed == null) return null;
    return computed === printed
      ? <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="size-3" /> fiche</span>
      : <span className="text-warning" title={`Écart ${money(computed - printed)}`}>fiche : {money(printed)}</span>;
  };

  const subtotal = (b: Block) => {
    const total = blockTotal(b, likes);
    const printed = b.id === "gross" ? draft.printedGross : b.id === "contributions" ? draft.printedContributions : null;
    const before = ref ? blockTotal(b, refLikes) : null;
    return (
      <tr className="border-b border-border">
        <td colSpan={2} />
        <td colSpan={3} className={cn("py-1.5 pr-2 text-xs font-semibold", b.tone.text)}>── {b.subtotal}</td>
        <td className={cn("nums py-1.5 pr-3 text-right text-sm font-semibold", b.tone.text)} aria-label={b.subtotal ?? undefined}>
          {b.signed && total > 0 ? "+" : ""}{money(total)}
        </td>
        {ref && <td className="nums py-1.5 pr-2 text-right text-xs text-muted-foreground">{before != null ? money(before) : ""}</td>}
        <td className="py-1.5 text-[11px] whitespace-nowrap">{check(total, printed)}</td>
      </tr>
    );
  };

  const net = linesNet(likes, draftFigures(draft).gross_cents);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Lignes <span className="font-normal text-muted-foreground">· {draft.lines.length}</span></p>
      {draft.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label="Lignes de la fiche" className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="w-16" />
                <th className="py-1.5 pr-2 text-left font-medium">Libellé</th>
                <th className="w-48 py-1.5 pr-2 text-left font-medium">Ce qu&apos;elle fait</th>
                <th className="py-1.5 pr-2 text-right font-medium">Base</th>
                <th className="py-1.5 pr-2 text-right font-medium">Taux</th>
                <th className="w-32 py-1.5 pr-3 text-right font-medium">Montant</th>
                {ref && <th className="w-24 py-1.5 pr-2 text-right font-medium" title={monthName(ref.period)}>Mois préc.</th>}
                <th className="w-16" />
              </tr>
            </thead>
            {blocks.map((b) => {
              const lines = draft.lines.filter((l) => blockOf(l.kind) === b);
              return (
                <Fragment key={b.id}>
                  <tbody aria-label={b.title}>
                    <tr>
                      <th colSpan={cols} className={cn("border-l-4 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide", b.tone.border, b.tone.tint, b.tone.text)}>
                        {b.title}
                      </th>
                    </tr>
                    {lines.map((l, i) => {
                      const previous = comparison.previous.get(l.uid);
                      const amountCents = amountToCents(l.amount);
                      const changed = previous != null && previous.amount_cents !== amountCents;
                      const rateChanged = previous != null && previous.rate_bp != null && l.rate != null && previous.rate_bp !== l.rate;
                      const sign = l.kind && l.kind !== "gross" && l.kind !== "info" ? (EFFECT[l.kind] < 0 ? "−" : "+") : "";
                      return (
                        <tr key={l.uid}
                          onFocusCapture={() => onTarget?.(target(l))} onClick={() => onTarget?.(target(l))}
                          onDragOver={(e) => {
                            const from = draft.lines.find((x) => x.uid === dragging);
                            if (from && blockOf(from.kind) === b) { e.preventDefault(); setOver(l.uid); }
                          }}
                          onDrop={(e) => { e.preventDefault(); if (dragging) onChange(moveLineTo(draft, dragging, l.uid)); setDragging(null); setOver(null); }}
                          className={cn("border-b border-border/60", l.kind == null && "bg-warning/10",
                            over === l.uid && dragging !== l.uid && "outline-2 -outline-offset-2 outline-brand")}>
                          <td className={cn("border-l-4 py-1 pl-1", b.tone.border)}>
                            <span className="flex items-center text-muted-foreground">
                              <span draggable aria-hidden title="Glisser pour déplacer" className="cursor-grab p-0.5 hover:text-foreground"
                                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.uid); setDragging(l.uid); }}
                                onDragEnd={() => { setDragging(null); setOver(null); }}>
                                <GripVertical className="size-3.5" />
                              </span>
                              <button type="button" aria-label={`Monter ${l.label || "la ligne"}`} disabled={i === 0}
                                className="rounded p-0.5 hover:text-foreground disabled:opacity-30" onClick={() => onChange(moveLine(draft, l.uid, -1))}>
                                <ChevronUp className="size-3.5" />
                              </button>
                              <button type="button" aria-label={`Descendre ${l.label || "la ligne"}`} disabled={i === lines.length - 1}
                                className="rounded p-0.5 hover:text-foreground disabled:opacity-30" onClick={() => onChange(moveLine(draft, l.uid, 1))}>
                                <ChevronDown className="size-3.5" />
                              </button>
                            </span>
                          </td>
                          <td className="min-w-40 py-1 pr-2">
                            <span className="flex items-center gap-1.5">
                              <Input aria-label="Libellé" value={l.label} className="h-8"
                                onChange={(e) => setLine(l.uid, { label: e.target.value, key: labelKey(e.target.value) })} />
                              {comparison.fresh.has(l.uid) && (
                                <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand"
                                  title={ref ? `Absente en ${monthName(ref.period)}` : undefined}>nouvelle</span>
                              )}
                            </span>
                          </td>
                          <td className="py-1 pr-2">
                            <Select value={l.kind ?? UNSET} onValueChange={(v) => onChange(setKind(draft, l.uid, v as Kind))}>
                              <SelectTrigger aria-label={`Ce que fait ${l.label || "la ligne"}`}
                                className={cn("h-8 whitespace-nowrap text-xs [&>span]:truncate", l.kind == null && "border-warning")}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {l.kind == null && <SelectItem value={UNSET} disabled>À classer</SelectItem>}
                                {KIND_ORDER.map((k) => (
                                  <SelectItem key={k} value={k}>
                                    <span className={cn("mr-1.5 inline-block size-2 rounded-full", blockOf(k).tone.bar)} />{KIND_LABEL[k]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="nums whitespace-nowrap py-1 pr-2 text-right text-xs text-muted-foreground">{l.base != null ? centsToAmount(l.base) : ""}</td>
                          <td className="nums whitespace-nowrap py-1 pr-2 text-right text-xs text-muted-foreground">
                            {l.rate != null ? formatRate(l.rate) : ""}
                            {rateChanged && <span className="block text-[10px] text-warning">avant {formatRate(previous!.rate_bp)}</span>}
                          </td>
                          <td className="py-1 pr-3">
                            <span className="flex items-center gap-1">
                              <span className="w-2 text-xs text-muted-foreground">{sign}</span>
                              <Input aria-label={`Montant de ${l.label || "la ligne"}`} value={l.amount} inputMode="decimal"
                                className="nums h-8 text-right" title={l.negative ? "Imprimé en négatif sur la fiche" : undefined}
                                onChange={(e) => setLine(l.uid, { amount: e.target.value })} />
                            </span>
                          </td>
                          {ref && (
                            <td className={cn("nums py-1 pr-2 text-right text-xs", changed ? "font-medium text-foreground" : "text-muted-foreground")}
                              title={changed ? `${money(amountCents - previous!.amount_cents)} par rapport à ${monthName(ref.period)}` : undefined}>
                              {previous ? money(previous.amount_cents) : "—"}
                            </td>
                          )}
                          <td className="py-1">
                            <button type="button" aria-label={`Retirer ${l.label || "la ligne"}`} className="rounded p-1 text-muted-foreground hover:text-negative"
                              onClick={() => onChange({ ...draft, lines: draft.lines.filter((x) => x.uid !== l.uid) })}><X className="size-3.5" /></button>
                          </td>
                        </tr>
                      );
                    })}
                    {b.subtotal && subtotal(b)}
                  </tbody>
                  {b === lastCounted && (
                    <tbody>
                      <tr className="border-y-2 border-border">
                        <td colSpan={2} />
                        <td colSpan={3} className="py-2 pr-2 text-sm font-semibold">═ Net versé</td>
                        <td className="nums py-2 pr-3 text-right text-sm font-semibold" aria-label="Net des lignes">{money(net)}</td>
                        {ref && <td className="nums py-2 pr-2 text-right text-xs text-muted-foreground">{money(ref.net_paid_cents)}</td>}
                        <td className="py-2 text-[11px] whitespace-nowrap">{check(net, draft.net.trim() ? amountToCents(draft.net) : null)}</td>
                      </tr>
                    </tbody>
                  )}
                </Fragment>
              );
            })}
          </table>
        </div>
      )}

      {comparison.missing.length > 0 && ref && (
        <section aria-label="Lignes absentes" className="space-y-1 rounded-lg border border-dashed border-warning/60 px-3 py-2">
          <p className="text-xs font-medium">Présentes en {monthName(ref.period)}, absentes ici</p>
          <ul className="space-y-1">
            {comparison.missing.map((m, i) => (
              <li key={`${m.key}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  <span className={cn("mr-1.5 inline-block size-2 rounded-full", blockOf(m.kind).tone.bar)} />
                  {m.label} <span className="text-muted-foreground">· {KIND_LABEL[m.kind]} · {money(m.amount_cents)}</span>
                </span>
                <button type="button" className="inline-flex items-center gap-1 text-brand hover:underline" aria-label={`Reprendre ${m.label}`}
                  onClick={() => onChange(restoreLine(draft, m))}>
                  <Undo2 className="size-3" /> Reprendre
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onChange(addLine(draft))}>
        <Plus className="size-3" /> Ligne
      </button>
    </div>
  );
}
