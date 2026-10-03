"use client";

import { Landmark, TrendingUp, TrendingDown, Scale, PieChart as PieIcon, Inbox, Upload, Wallet, Table2, ArrowRight, AlertTriangle, Info, X, Check } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { KpiStat } from "@/components/dashboard/kpi-stat";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { PatrimoineDonut } from "@/components/charts/patrimoine-donut";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { NetworthArea } from "@/components/charts/networth-area";
import { TopExpenses } from "@/components/dashboard/top-expenses";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import { LoansWidget } from "@/components/dashboard/loans-widget";
import { PatrimoineNetWidget } from "@/components/dashboard/patrimoine-net-widget";
import { CurrencyBreakdownWidget } from "@/components/dashboard/currency-breakdown-widget";
import {
  useAnalyticsContext,
  useSummary,
  useCashFlow,
  useByCategory,
  useNetWorth,
  useActiveProfile,
  useSettings,
} from "@/lib/api/hooks";
import { patrimoineByType } from "@/lib/networth";
import { DEFAULT_MODULES } from "@/lib/nav";
import { useHintsStore } from "@/lib/stores";

const fade = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] } }),
};

export default function DashboardPage() {
  const { query, currency, accounts, accountsLoaded } = useAnalyticsContext();
  const summary = useSummary(query);
  const cashFlow = useCashFlow(query);
  const byCategory = useByCategory(query);
  const netWorth = useNetWorth(query);
  const activeProfile = useActiveProfile();
  const baseCurrency = useSettings().data?.base_currency;
  const { dismissed: dismissedHints, dismiss: dismissHint } = useHintsStore();
  const modules = activeProfile?.enabled_modules ?? DEFAULT_MODULES;
  const showGoals = modules.includes("goals");
  const showLoans = modules.includes("loans");

  // Only blank the page on a genuine first paint (nothing resolved yet). Each card
  // then handles its own pending state, so one slow query can't hide the fast ones.
  const initialLoading =
    summary.isLoading && cashFlow.isLoading && byCategory.isLoading && netWorth.isLoading;

  if (initialLoading) return <DashboardSkeleton />;

  // Only offer first-run onboarding once we KNOW the account list is empty. If the
  // backend is unreachable the query fails and `accounts` is [] — showing the
  // wizard then tells an existing user their data is gone. The ConnectionBanner
  // explains the real problem instead.
  if (accountsLoaded && accounts.length === 0) {
    return <GettingStarted showBudget={modules.includes("budgeting")} />;
  }

  // Every total here is converted to the base currency. When no account is held
  // in it — typically an install whose base currency was never chosen — the
  // figures look wrong for no visible reason, so say it and point to the setting.
  // `baseCurrency` is undefined until the settings have really loaded.
  const mismatchHintId = `base-currency:${activeProfile?.id ?? 0}:${baseCurrency}`;
  const currencyMismatch =
    baseCurrency !== undefined &&
    accounts.length > 0 &&
    !accounts.some((a) => a.currency === baseCurrency) &&
    !dismissedHints.includes(mismatchHintId);

  const s = summary.data;
  // The welcome steps used to vanish the moment the first account existed, so
  // nothing pointed to the import. Keep them, as a card above the dashboard, until
  // the profile has a transaction (`last_transaction_date` is profile-wide) — or
  // until the user closes it, for those who never import (investments, manual
  // balances).
  const onboardingHintId = `onboarding:${activeProfile?.id ?? 0}`;
  const showNextStep = s !== undefined && s.last_transaction_date == null && !dismissedHints.includes(onboardingHintId);
  const nw = netWorth.data ?? [];
  const patrimoine = patrimoineByType(nw, accounts);
  const nwDelta =
    nw.length >= 2
      ? ((Number(nw[nw.length - 1].total) - Number(nw[nw.length - 2].total)) / Math.abs(Number(nw[nw.length - 2].total) || 1)) * 100
      : null;

  const kpis = [
    { label: "Patrimoine", valueCents: s?.net_worth_cents ?? 0, icon: Landmark, accent: "brand" as const, deltaPercent: nwDelta, hint: "vs mois précédent" },
    { label: "Revenus", valueCents: s?.total_income_cents ?? 0, icon: TrendingUp, accent: "positive" as const, hint: "sur la période" },
    { label: "Dépenses", valueCents: s?.total_expenses_cents ?? 0, icon: TrendingDown, accent: "negative" as const, hint: "sur la période" },
    {
      label: "Flux net",
      valueCents: s?.net_cash_flow_cents ?? 0,
      icon: Scale,
      accent: (s && s.net_cash_flow_cents >= 0 ? "positive" : "negative") as "positive" | "negative",
      signed: true,
      hint: "épargne nette",
    },
  ];

  return (
    <div className="space-y-5">
      {showNextStep && (
        <GettingStarted showBudget={modules.includes("budgeting")} accountDone onDismiss={() => dismissHint(onboardingHintId)} />
      )}

      {s?.fx_incomplete && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Taux de change indisponibles pour certains montants — les totaux multidevises sont provisoires.</span>
        </div>
      )}

      {currencyMismatch && (
        <div className="flex items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <Info className="size-4 shrink-0" />
          <span className="flex-1">
            Les montants sont convertis en {baseCurrency}, mais aucun de vos comptes n&apos;est dans cette devise.{" "}
            <Link href="/parametres" className="font-medium underline underline-offset-2">Changer la devise de base</Link>
          </span>
          <button type="button" onClick={() => dismissHint(mismatchHintId)} className="shrink-0 rounded p-0.5 hover:bg-info/15" aria-label="Masquer ce message">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div key={k.label} variants={fade} initial="hidden" animate="show" custom={i}>
            <KpiStat currency={currency} {...k} />
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        <motion.div className="h-full lg:col-span-2" variants={fade} initial="hidden" animate="show" custom={4}>
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Évolution du patrimoine</CardTitle>
              <CardDescription>Solde net cumulé par mois</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
              {netWorth.isLoading ? (
                <Skeleton className="min-h-[280px] flex-1 rounded-xl" />
              ) : nw.length ? (
                <div className="min-h-[280px] flex-1">
                  <NetworthArea data={nw} currency={currency} height="100%" />
                </div>
              ) : (
                <EmptyState icon={Inbox} title="Pas encore de données" />
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={5}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Répartition du patrimoine</CardTitle>
              <CardDescription>Par type de compte</CardDescription>
            </CardHeader>
            <CardContent>
              {netWorth.isLoading ? (
                <Skeleton className="mx-auto size-44 rounded-full" />
              ) : Object.keys(patrimoine).length ? (
                <PatrimoineDonut byType={patrimoine} currency={currency} />
              ) : (
                <EmptyState icon={PieIcon} title="Aucun patrimoine" />
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {(s?.net_worth_by_currency?.length ?? 0) > 1 && (
        <motion.div variants={fade} initial="hidden" animate="show" custom={5.2}>
          <CurrencyBreakdownWidget summary={s} />
        </motion.div>
      )}

      {(showGoals || showLoans) && (
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
          {showLoans && (
            <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={5.5}>
              <PatrimoineNetWidget
                netWorthCents={s?.net_worth_cents ?? 0}
                exclLoansCents={s?.net_worth_excl_loans_cents ?? 0}
                totalLoansCents={s?.total_loans_cents ?? 0}
                currency={currency}
              />
            </motion.div>
          )}
          {showGoals && (
            <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={5.7}>
              <GoalsWidget currency={currency} />
            </motion.div>
          )}
          {showLoans && (
            <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={5.9}>
              <LoansWidget />
            </motion.div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={6}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Répartition des dépenses</CardTitle>
              <CardDescription>Par catégorie</CardDescription>
            </CardHeader>
            <CardContent>
              {byCategory.isLoading ? (
                <Skeleton className="mx-auto size-44 rounded-full" />
              ) : byCategory.data?.length ? (
                <SpendingDonut data={byCategory.data} currency={currency} />
              ) : (
                <EmptyState icon={PieIcon} title="Aucune dépense" />
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={7}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Top 10 des dépenses</CardTitle>
              <CardDescription>Sur la période sélectionnée</CardDescription>
            </CardHeader>
            <CardContent>
              <TopExpenses query={query} currency={currency} />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={fade} initial="hidden" animate="show" custom={8}>
        <Card>
          <CardHeader>
            <CardTitle>Revenus & dépenses</CardTitle>
            <CardDescription>Flux mensuels et solde net</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {cashFlow.isLoading ? (
              <Skeleton className="h-[260px] w-full rounded-xl" />
            ) : cashFlow.data?.length ? (
              <CashflowChart data={cashFlow.data} currency={currency} />
            ) : (
              <EmptyState icon={Inbox} title="Pas encore de données" />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

/** First-run checklist. With no account it is the whole page; once an account
 *  exists (`accountDone`) it stays as a card above the dashboard, first step
 *  ticked, until a statement has been imported or the user closes it. */
function GettingStarted({ showBudget, accountDone = false, onDismiss }: {
  showBudget: boolean;
  accountDone?: boolean;
  onDismiss?: () => void;
}) {
  const steps = [
    {
      icon: Wallet,
      title: "Créez un compte",
      description: "Ajoutez votre compte bancaire (nom, banque, type, devise). C'est la destination de vos imports, et sa devise devient votre devise de base (modifiable dans Paramètres).",
      href: "/comptes",
      cta: "Créer un compte",
      done: accountDone,
    },
    {
      icon: Upload,
      title: "Importez un relevé bancaire",
      description: "Téléchargez vos opérations au format CSV depuis le site de votre banque, puis glissez le fichier dans l'onglet Importer — les colonnes sont détectées automatiquement.",
      href: "/importer",
      cta: "Importer un relevé",
      done: false,
    },
    ...(showBudget
      ? [{
          icon: Table2,
          title: "Définissez votre budget",
          description: "Planifiez vos dépenses et suivez-les mois par mois.",
          href: "/budget",
          cta: "Ouvrir le budget",
          done: false,
        }]
      : []),
  ];
  const next = steps.findIndex((step) => !step.done);

  return (
    <Card className="relative mx-auto max-w-2xl p-8">
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Masquer les premiers pas"
          className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold tracking-tight">{accountDone ? "Votre compte est créé" : "Bienvenue 👋"}</h1>
        <p className="text-sm text-muted-foreground">
          {accountDone
            ? "Importez un relevé pour voir apparaître vos dépenses et vos revenus."
            : "Quelques étapes pour commencer à suivre vos finances. Vos données restent sur votre machine."}
        </p>
      </div>
      <ol className="mt-6 space-y-3">
        {steps.map((step, i) => (
          <li key={step.href}
            className={`flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-muted/40 ${step.done ? "opacity-60" : ""}`}>
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${step.done ? "bg-positive/15 text-positive" : "bg-brand/10 text-brand"}`}>
              {step.done ? <Check className="size-4" aria-label="Fait" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <step.icon className="size-4 text-muted-foreground" /> {step.title}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
            </div>
            {!step.done && (
              <Button asChild variant={i === next ? "default" : "outline"} size="sm" className="shrink-0">
                <Link href={step.href}>{step.cta} <ArrowRight className="ml-1 size-3.5" /></Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-9 rounded-xl" />
            </div>
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mx-auto mt-6 size-44 rounded-full" />
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mx-auto mt-6 size-44 rounded-full" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
        </Card>
      </div>
      <Card className="p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
      </Card>
    </div>
  );
}
