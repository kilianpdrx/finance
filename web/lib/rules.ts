/** Vocabulary of categorisation rules, shared by the rule editor, the rule list,
 *  the rule tester and the conflict badge. */

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export const RULE_FIELDS = [
  { value: "description", label: "Libellé" },
  { value: "amount", label: "Montant" },
  { value: "is_debit", label: "Sens" },
  { value: "currency", label: "Devise" },
  { value: "account_id", label: "Compte (ID)" },
  { value: "date", label: "Date" },
];

// Rules have no priority, so two rules that overlap are told apart by the rules
// themselves: "ne contient pas" excludes a longer brand ("amazon" but not "amazon
// prime"), "mot entier" keeps a short keyword from firing inside another word.
export function operatorsFor(field: string) {
  if (field === "amount") return [{ value: ">", label: ">" }, { value: ">=", label: "≥" }, { value: "<", label: "<" }, { value: "<=", label: "≤" }, { value: "equals", label: "=" }];
  if (field === "is_debit") return [{ value: "equals", label: "est" }];
  return [
    { value: "contains", label: "contient" },
    { value: "not_contains", label: "ne contient pas" },
    { value: "word", label: "mot entier" },
    { value: "startswith", label: "commence par" },
    { value: "equals", label: "égal à" },
    { value: "regex", label: "regex" },
  ];
}

/** The two values of a « Sens » condition. It is stored as the `is_debit` field
 *  ("true" / "false"); the user only ever sees Dépense / Revenu. */
export const DIRECTIONS = [
  { value: "true", label: "Dépense" },
  { value: "false", label: "Revenu" },
];
export function directionLabel(value: string): string {
  return String(value).toLowerCase() === "true" ? "Dépense" : "Revenu";
}

/** An amount as typed in the editor ("12,5", "12.5", "1 850"); null if not a number. */
export function parseRuleAmount(value: string): number | null {
  const text = String(value).trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Why an amount condition cannot do what it looks like it does.
 *
 *  A rule compares the amount WITHOUT its sign — an expense of 40 € and an income
 *  of 40 € are both "40". So "montant > 0" is true for everything ("always") and
 *  "montant < 0" for nothing ("never"): neither tells income from expense, which
 *  is what « Sens » is for. "invalid" is a threshold that is not a number. */
export function amountConditionIssue(c: RuleCondition): "always" | "never" | "invalid" | null {
  if (c.field !== "amount") return null;
  const v = parseRuleAmount(c.value);
  if (v == null) return String(c.value).trim() === "" ? null : "invalid";
  switch (c.operator) {
    case ">": return v <= 0 ? "always" : null;
    case ">=": return v <= 0 ? "always" : null;
    case "<": return v <= 0 ? "never" : null;
    case "<=": return v <= 0 ? "never" : null;
    case "equals": return v < 0 ? "never" : null;
    default: return null;
  }
}

/** One-line, human-readable form of a rule's conditions. */
export function ruleSummary(rule: { conditions: RuleCondition[]; logic_operator?: string | null }): string {
  const one = (c: RuleCondition) => {
    const field = RULE_FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
    if (c.field === "is_debit") return `${field} = ${directionLabel(c.value)}`;
    const op = operatorsFor(c.field).find((o) => o.value === c.operator)?.label ?? c.operator;
    return `${field} ${op} « ${c.value} »`;
  };
  return rule.conditions.map(one).join(rule.logic_operator === "OR" ? " OU " : " ET ");
}

/** What a rule being tested would meet. Of the transactions matching its
 *  conditions: how many have no category (`none` — the only ones saving the rule
 *  can fill), how many already have the rule's category (`same`), and how many
 *  are filed elsewhere (`other`). Without a chosen category, every categorised
 *  row counts as `other`. */
export function previewBreakdown(
  rows: { category_id?: number | null }[],
  categoryId: number | null,
): { none: number; same: number; other: number } {
  const out = { none: 0, same: 0, other: 0 };
  for (const r of rows) {
    if (r.category_id == null) out.none += 1;
    else if (categoryId != null && r.category_id === categoryId) out.same += 1;
    else out.other += 1;
  }
  return out;
}
