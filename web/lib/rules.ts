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
  { value: "is_debit", label: "Débit ?" },
  { value: "currency", label: "Devise" },
  { value: "account_id", label: "Compte (ID)" },
  { value: "date", label: "Date" },
];

// Rules have no priority, so two rules that overlap are told apart by the rules
// themselves: "ne contient pas" excludes a longer brand ("amazon" but not "amazon
// prime"), "mot entier" keeps a short keyword from firing inside another word.
export function operatorsFor(field: string) {
  if (field === "amount") return [{ value: ">", label: ">" }, { value: ">=", label: "≥" }, { value: "<", label: "<" }, { value: "<=", label: "≤" }, { value: "equals", label: "=" }];
  if (field === "is_debit") return [{ value: "equals", label: "est (true/false)" }];
  return [
    { value: "contains", label: "contient" },
    { value: "not_contains", label: "ne contient pas" },
    { value: "word", label: "mot entier" },
    { value: "startswith", label: "commence par" },
    { value: "equals", label: "égal à" },
    { value: "regex", label: "regex" },
  ];
}

/** One-line, human-readable form of a rule's conditions. */
export function ruleSummary(rule: { conditions: RuleCondition[]; logic_operator?: string | null }): string {
  const one = (c: RuleCondition) => {
    const field = RULE_FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
    if (c.field === "is_debit") return `${field} = ${c.value}`;
    const op = operatorsFor(c.field).find((o) => o.value === c.operator)?.label ?? c.operator;
    return `${field} ${op} « ${c.value} »`;
  };
  return rule.conditions.map(one).join(rule.logic_operator === "OR" ? " OU " : " ET ");
}
