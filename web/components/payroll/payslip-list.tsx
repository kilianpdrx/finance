"use client";

import { toast } from "sonner";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPayslipDocument, type Employer, type Payslip } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { gaps, monthName } from "@/lib/payroll";
import { DepositBadge, Empty, Frame, Swatch, employerName } from "./common";

/** Every payslip of the period and employer shown, newest first — in its own
 *  currency, whatever the currency of the figures — with its deposit, its
 *  PDF, its correction. « Toutes les fiches » lifts the period and the filter. */
export function PayslipList({ payslips, total, employers, colors, onEdit, onDelete, onShowAll }: {
  payslips: Payslip[];
  /** Every payslip of the profile: the list says when it shows fewer. */
  total: number;
  employers: Employer[];
  colors: Map<number, string>;
  onEdit: (p: Payslip) => void;
  onDelete: (p: Payslip) => void;
  onShowAll: () => void;
}) {
  const rows = [...payslips].sort((a, b) => b.period.localeCompare(a.period)
    || employerName(employers, a.employer_id).localeCompare(employerName(employers, b.employer_id)));
  const missing = gaps(payslips);
  const byEmployer = [...new Set(missing.map((g) => g.employer_id))];
  const money = (p: Payslip, c: number) => formatCents(c, p.currency, { decimals: 2 });
  const of = (p: Payslip) => `${monthName(p.period)} · ${employerName(employers, p.employer_id)}`;
  return (
    <Frame title="Fiches de paie" action={
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {payslips.length} fiche{payslips.length > 1 ? "s" : ""} affichée{payslips.length > 1 ? "s" : ""} sur {total}
        {payslips.length < total && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onShowAll}>Afficher toutes les fiches</Button>}
      </span>
    }>
      {rows.length === 0 ? <Empty /> : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table aria-label="Fiches de paie" className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Mois</th>
                  <th className="py-1.5 text-left font-medium">Employeur</th>
                  <th className="py-1.5 text-right font-medium">Brut</th>
                  <th className="py-1.5 text-right font-medium">Cotisations</th>
                  <th className="py-1.5 text-right font-medium">Impôt</th>
                  <th className="py-1.5 text-right font-medium">Net versé</th>
                  <th className="py-1.5 pl-3 text-left font-medium">Versement</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="py-1.5 whitespace-nowrap capitalize">{monthName(p.period)}</td>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Swatch color={colors.get(p.employer_id)} />{employerName(employers, p.employer_id)}</span>
                    </td>
                    <td className="nums blurable py-1.5 text-right whitespace-nowrap">{money(p, p.gross_cents)}</td>
                    <td className="nums blurable py-1.5 text-right whitespace-nowrap text-muted-foreground">{money(p, p.employee_contributions_cents)}</td>
                    <td className="nums blurable py-1.5 text-right whitespace-nowrap text-muted-foreground">{money(p, p.withholding_cents)}</td>
                    <td className="nums blurable py-1.5 text-right whitespace-nowrap font-medium">{money(p, p.net_paid_cents)}</td>
                    <td className="py-1.5 pl-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <DepositBadge deposit={p.deposit} />
                        <span className="text-xs text-muted-foreground">
                          {p.deposit.date && new Date(p.deposit.date).toLocaleDateString("fr-FR")}
                          {p.deposit.status === "gap" && ` · ${formatCents(p.deposit.difference_cents, p.currency, { sign: true, decimals: 2 })}`}
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex items-center gap-0.5">
                        {p.document_id != null && (
                          <Button variant="ghost" size="icon" className="size-7" title="Ouvrir le PDF" aria-label={`PDF de ${of(p)}`}
                            onClick={() => openPayslipDocument(p.document_id!).catch((e) => toast.error(e instanceof Error ? e.message : "Erreur"))}>
                            <FileText className="size-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="size-7" title="Corriger" aria-label={`Corriger ${of(p)}`} onClick={() => onEdit(p)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-negative" title="Supprimer"
                          aria-label={`Supprimer ${of(p)}`} onClick={() => onDelete(p)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {byEmployer.map((id) => {
            const months = missing.filter((g) => g.employer_id === id).map((g) => monthName(g.period));
            const s = months.length > 1 ? "s" : "";
            return (
              <p key={id} className="rounded-lg bg-warning/10 px-3 py-2 text-xs">
                {employerName(employers, id)} : fiche{s} manquante{s} pour {months.join(", ")}.
              </p>
            );
          })}
        </div>
      )}
    </Frame>
  );
}
