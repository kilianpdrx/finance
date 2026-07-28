"use client";

import { useState, type ElementType } from "react";
import { BadgeMinus, Home, Pencil, Trash2, CalendarClock, Percent, Coins, TableProperties, AlertTriangle } from "lucide-react";
import { useLoans, useAccounts, useAccountMutations, type Loan, type Account } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AccountDialog } from "@/components/accounts/account-dialog";
import { LoanPaymentDialog } from "@/components/loans/loan-payment-dialog";
import { LoanScheduleDialog } from "@/components/loans/loan-schedule-dialog";
import { Skeleton } from "@/components/ui/skeleton";

const fmtMonth = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function Stat({ icon: Icon, label, value, sub }: { icon: ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-1">
      <div className="mb-1 flex items-center text-sm text-muted-foreground">
        <Icon className="mr-2 size-4" /> {label}
      </div>
      <p className="nums blurable text-lg font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function LoansPage() {
  const { data: loans = [], isLoading } = useLoans();
  const { data: accounts = [] } = useAccounts();
  const { remove } = useAccountMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null);
  const [scheduleLoan, setScheduleLoan] = useState<Loan | null>(null);

  const totalDebt = loans.reduce((s, l) => s + l.remaining_cents, 0);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="flex flex-1 flex-col p-6 space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Emprunts &amp; Dettes</h1>
          <p className="text-muted-foreground">
            {loans.length > 0
              ? <>Total restant dû : <span className="nums blurable font-semibold text-destructive">{formatCents(totalDebt)}</span></>
              : "Gérez vos emprunts et suivez leur remboursement."}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <BadgeMinus className="mr-2 size-4" /> Nouvel Emprunt
        </Button>
      </div>

      <div className="grid gap-6">
        {isLoading &&
          Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="border-b bg-muted/30 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-md" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-3.5 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-8 w-28" />
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-2.5 w-full rounded-full" />
                <div className="grid gap-6 sm:grid-cols-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}

        {!isLoading && loans.map((loan) => {
          const progress = Math.min(100, Math.max(0, loan.progress_pct));
          const account = accountsById.get(loan.id) ?? null;

          return (
            <Card key={loan.id} className="overflow-hidden">
              <CardHeader className="border-b bg-muted/30 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md border bg-background p-2 shadow-sm">
                      <Home className="size-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{loan.name}</p>
                      <p className="text-sm text-muted-foreground">{loan.bank_name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="nums blurable text-2xl font-bold text-destructive">{formatCents(-loan.remaining_cents, loan.currency)}</p>
                    <p className="text-sm font-medium text-muted-foreground">Restant dû</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {!loan.computable ? (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border bg-muted/20 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="size-4" />
                      Complétez le montant emprunté, la durée et la date de début pour calculer l&apos;amortissement.
                    </div>
                    {account && <Button variant="outline" size="sm" onClick={() => setEditAccount(account)}>Compléter</Button>}
                  </div>
                ) : (
                  <>
                    {/* progress */}
                    <div className="mb-6 space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Remboursé : {formatCents(loan.paid_principal_cents, loan.currency)}</span>
                        <span>Emprunté : {formatCents(loan.principal_cents ?? 0, loan.currency)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-right text-xs font-medium text-brand">{Math.round(progress)}% remboursé</p>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-3">
                      <Stat icon={Coins} label="Mensualité" value={`${formatCents(loan.monthly_payment_cents, loan.currency)}/mois`} />
                      <Stat icon={Percent} label="Taux annuel" value={`${loan.interest_rate_pct ?? 0}%`}
                        sub={`Intérêts restants : ${formatCents(loan.interest_remaining_cents, loan.currency)}`} />
                      <Stat icon={CalendarClock} label="Fin estimée"
                        value={loan.payoff_date ? fmtMonth(loan.payoff_date) : "—"}
                        sub={loan.months_remaining > 0 ? `Dans ${loan.months_remaining} mois` : "Soldé"} />
                    </div>

                    {loan.extra_paid_cents > 0 && (
                      <p className="mt-4 text-xs text-muted-foreground">
                        Paiements anticipés : <span className="nums font-medium text-foreground">{formatCents(loan.extra_paid_cents, loan.currency)}</span>
                      </p>
                    )}
                  </>
                )}

                <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
                  {loan.computable && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setPaymentLoan(loan)}>
                        <Coins className="mr-1.5 size-4" /> Paiement anticipé
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setScheduleLoan(loan)}>
                        <TableProperties className="mr-1.5 size-4" /> Échéancier
                      </Button>
                    </>
                  )}
                  <div className="ml-auto flex gap-1">
                    {account && (
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setEditAccount(account)}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative"
                      onClick={() => { if (confirm(`Supprimer l'emprunt « ${loan.name} » ?`)) remove.mutate(loan.id); }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!isLoading && loans.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center">
            <BadgeMinus className="mx-auto mb-3 size-12 text-muted-foreground/50" />
            <h3 className="text-lg font-medium">Aucun emprunt</h3>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">Ajoutez un prêt pour suivre son amortissement.</p>
            <Button onClick={() => setCreateOpen(true)} variant="outline">Ajouter un emprunt</Button>
          </div>
        )}
      </div>

      <AccountDialog open={createOpen} onOpenChange={setCreateOpen} account={null} defaultType="emprunt" />
      <AccountDialog open={editAccount !== null} onOpenChange={(v) => !v && setEditAccount(null)} account={editAccount} />
      <LoanPaymentDialog loan={paymentLoan} onOpenChange={(v) => !v && setPaymentLoan(null)} />
      <LoanScheduleDialog loan={scheduleLoan} onOpenChange={(v) => !v && setScheduleLoan(null)} />
    </div>
  );
}
