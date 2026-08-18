"use client";

import { useState } from "react";
import { FlaskConical, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Match {
  rule_id: number;
  priority: number;
  category_id: number;
  category_name: string;
  logic_operator: string;
  conditions: { field: string; operator: string; value: string }[];
  account_id: number | null;
  account_name: string | null;
  /** Rule is bound to one account and no account was given for the test. */
  account_scoped_unverified: boolean;
}

interface Result {
  matched: Match | null;
  all_matches: Match[];
  rules_evaluated: number;
}

/**
 * "Paste a description, see which rule wins."
 *
 * Rules are evaluated by ascending priority and the first match wins, so the
 * losing rules are invisible in the list — which is what makes a mis-ordered
 * rule impossible to diagnose by reading it. Showing the winner AND the other
 * matches turns that into something you can see.
 */
export function RuleTester() {
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/categories/rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, amount_cents: 0, is_debit: true }),
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const losers = result?.all_matches.slice(1) ?? [];

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Tester une règle</p>
        <span className="text-xs text-muted-foreground">
          Collez un libellé de transaction pour voir quelle règle s&apos;applique.
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Ex : PAIEMENT CB AMAZON PRIME VIDEO"
          className="h-9 flex-1"
        />
        <Button variant="outline" size="sm" onClick={run} disabled={busy || !description.trim()}>
          {busy ? "Test…" : "Tester"}
        </Button>
      </div>

      {error && <p className="text-xs text-negative">{error}</p>}

      {result && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
          {result.matched ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ArrowRight className="size-4 text-positive" />
              <span className="font-semibold text-positive">{result.matched.category_name}</span>
              <span className="text-xs text-muted-foreground">
                priorité {result.matched.priority} · règle #{result.matched.rule_id}
              </span>
              {result.matched.account_scoped_unverified && result.matched.account_name && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  uniquement sur « {result.matched.account_name} »
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune règle ne correspond — la transaction resterait sans catégorie.
            </p>
          )}

          {losers.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-xs font-medium text-warning">
                {losers.length} autre(s) règle(s) correspondent aussi, mais perdent :
              </p>
              <ul className="mt-1 space-y-0.5">
                {losers.map((m) => (
                  <li key={m.rule_id} className="text-xs text-muted-foreground">
                    {m.category_name}{" "}
                    <span className="opacity-70">
                      (priorité {m.priority} · règle #{m.rule_id}
                      {m.account_name ? ` · compte ${m.account_name}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                La règle de plus petite priorité gagne. Baissez la priorité d&apos;une règle
                pour lui faire gagner.
              </p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {result.rules_evaluated} règle(s) active(s) évaluée(s).
          </p>
        </div>
      )}
    </Card>
  );
}
