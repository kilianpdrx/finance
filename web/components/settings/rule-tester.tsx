"use client";

import { useState } from "react";
import { FlaskConical, ArrowRight, AlertTriangle, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ruleSummary, type RuleCondition } from "@/lib/rules";

interface Match {
  rule_id: number;
  category_id: number;
  category_name: string;
  logic_operator: string;
  conditions: RuleCondition[];
  account_id: number | null;
  account_name: string | null;
  /** Rule is bound to one account and no account was given for the test. */
  account_scoped_unverified: boolean;
}

interface Result {
  matched: Match | null;
  /** Rules of different categories match: none is applied. */
  conflict: boolean;
  all_matches: Match[];
  rules_evaluated: number;
}

/**
 * "Paste a description, see which rule classifies it."
 *
 * Rules have no priority: a label is classified only when every matching rule
 * agrees on the category. When they don't, the transaction stays uncategorised —
 * and nothing in the rule list shows that two rules overlap. The tester does: it
 * lists every rule involved, each one a click away from being edited.
 */
export function RuleTester({ onEditRule }: { onEditRule?: (ruleId: number) => void }) {
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

  const scope = (m: Match) =>
    m.account_scoped_unverified && m.account_name ? (
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        uniquement sur « {m.account_name} »
      </span>
    ) : null;

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
          {result.conflict ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                <AlertTriangle className="size-4" />
                Conflit — la transaction resterait sans catégorie
              </div>
              <ul className="space-y-1.5">
                {result.all_matches.map((m) => (
                  <li key={m.rule_id} className="flex items-start gap-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{m.category_name}</span>{" "}
                      <span className="text-muted-foreground">— {ruleSummary(m)}</span> {scope(m)}
                    </span>
                    {onEditRule && (
                      <Button variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-1.5 text-xs" onClick={() => onEditRule(m.rule_id)}>
                        <Pencil className="size-3" /> Modifier
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Les règles n&apos;ont pas de priorité. Pour lever le conflit, modifiez l&apos;une d&apos;elles :
                un mot-clé plus précis, une condition « ne contient pas », ou un compte.
              </p>
            </>
          ) : result.matched ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ArrowRight className="size-4 text-positive" />
              <span className="font-semibold text-positive">{result.matched.category_name}</span>
              <span className="text-xs text-muted-foreground">{ruleSummary(result.matched)}</span>
              {scope(result.matched)}
              {result.all_matches.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  · {result.all_matches.length} règles de cette catégorie correspondent
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune règle ne correspond — la transaction resterait sans catégorie.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            {result.rules_evaluated} règle(s) active(s) évaluée(s).
          </p>
        </div>
      )}
    </Card>
  );
}
