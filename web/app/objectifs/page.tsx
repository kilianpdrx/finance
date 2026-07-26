"use client";

import { useState } from "react";
import { Plus, Target, Check, Pencil, Trash2, Link2, CalendarClock } from "lucide-react";
import { useGoals, useGoalMutations, type Goal } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { GoalContributionsDialog } from "@/components/goals/goal-contributions-dialog";
import { formatCents } from "@/lib/format";

function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className="h-full transition-all duration-500 ease-in-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color || "var(--brand)" }} />
    </div>
  );
}

export default function GoalsPage() {
  const { data: goals = [] } = useGoals();
  const { delete: delGoal } = useGoalMutations();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);

  const openNew = () => { setEditingGoal(null); setDialogOpen(true); };
  const openEdit = (g: Goal) => { setEditingGoal(g); setDialogOpen(true); };

  return (
    <div className="flex flex-1 flex-col p-6 space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Objectifs</h1>
          <p className="text-muted-foreground">Suivez la progression de vos projets d&apos;épargne.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 size-4" /> Nouvel Objectif</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal) => {
          const progress = goal.progress_pct;
          const isCompleted = progress >= 100;
          const primary = () => (goal.is_linked ? openEdit(goal) : setContribGoal(goal));

          return (
            <div key={goal.id}
              className="group relative flex flex-col overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md cursor-pointer"
              onClick={primary}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${goal.color}20`, color: goal.color }}>
                  {isCompleted ? <Check className="size-5" /> : <Target className="size-5" />}
                </div>
                <div className="flex space-x-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon" className="size-8"
                    onClick={(e) => { e.stopPropagation(); openEdit(goal); }}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8"
                    onClick={(e) => { e.stopPropagation(); if (confirm("Supprimer cet objectif ?")) delGoal.mutate(goal.id); }}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <h3 className="line-clamp-1 text-lg font-semibold">{goal.name}</h3>
              <div className="mb-3 mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {goal.is_linked ? (
                  <Badge variant="neutral" className="gap-1"><Link2 className="size-3" /> {goal.linked_account_name ?? "Compte lié"}</Badge>
                ) : (
                  <Badge variant="neutral">Manuel</Badge>
                )}
                {goal.deadline && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3" />
                    {new Date(goal.deadline).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>

              <div className="mt-auto space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="nums blurable font-medium">{formatCents(goal.current_amount_cents, "EUR")}</span>
                  <span className="text-muted-foreground">{formatCents(goal.target_amount_cents, "EUR")}</span>
                </div>
                <ProgressBar value={progress} color={goal.color} />
                <div className="flex items-center justify-between">
                  {goal.monthly_needed_cents ? (
                    <span className="text-xs text-muted-foreground">
                      {formatCents(goal.monthly_needed_cents, "EUR")}/mois pour tenir l&apos;échéance
                    </span>
                  ) : <span />}
                  <span className="text-xs font-medium" style={{ color: goal.color }}>{Math.round(progress)}%</span>
                </div>
                {!goal.is_linked && (
                  <Button variant="outline" size="sm" className="w-full"
                    onClick={(e) => { e.stopPropagation(); setContribGoal(goal); }}>
                    <Plus className="mr-1 size-3.5" /> Contribution
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {goals.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center">
            <Target className="mx-auto mb-3 size-12 text-muted-foreground/50" />
            <h3 className="text-lg font-medium">Aucun objectif</h3>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">Créez votre premier objectif pour commencer à épargner.</p>
            <Button onClick={openNew} variant="outline">Créer un objectif</Button>
          </div>
        )}
      </div>

      <GoalDialog open={dialogOpen} onOpenChange={setDialogOpen} goal={editingGoal} />
      <GoalContributionsDialog goal={contribGoal} onOpenChange={(v) => !v && setContribGoal(null)} />
    </div>
  );
}
