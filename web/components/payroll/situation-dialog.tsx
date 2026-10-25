"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePayrollMutations, usePayrollPacks, type PayrollPack, type PayrollParam, type PayrollSituation } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

type Values = Record<string, string | number | boolean | null>;

const defaults = (pack: PayrollPack | undefined): Values =>
  Object.fromEntries((pack?.params ?? []).map((p) => [p.key, p.default]));

/** « Votre situation »: France or Zurich, then the few settings that situation
 *  needs — the form is built from what the backend says each one takes
 *  (`GET /payroll/packs`), so a new situation needs no new screen. */
export function SituationDialog({ open, onOpenChange, current }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The situation being changed, if any. */
  current: PayrollSituation | null;
}) {
  const { data: packs = [] } = usePayrollPacks();
  const { saveSituation } = usePayrollMutations();
  const [packId, setPackId] = useState<string>("");
  const [values, setValues] = useState<Values>({});
  const [fromYear, setFromYear] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    if (!open || packs.length === 0) return;
    const start = current?.pack ?? packs[0].id;
    setPackId(start);
    setValues({ ...defaults(packs.find((p) => p.id === start)), ...(current?.pack === start ? current.params : {}) } as Values);
    setFromYear(String(current?.from_year ?? new Date().getFullYear()));
  }, [open, packs, current]);

  const pack = packs.find((p) => p.id === packId);
  const choose = (id: string) => {
    setPackId(id);
    setValues({ ...defaults(packs.find((p) => p.id === id)), ...(current?.pack === id ? current.params : {}) } as Values);
  };
  const shown = (p: PayrollParam) => !p.show_if || values[p.show_if.key] === p.show_if.value;

  const submit = () => {
    const year = Number(fromYear);
    if (!pack || !Number.isInteger(year)) return;
    saveSituation.mutate({ pack: pack.id, from_year: year, params: values }, {
      onSuccess: () => { toast.success("Situation enregistrée"); onOpenChange(false); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  };

  const field = (p: PayrollParam) => {
    const id = `situation-${p.key}`;
    const value = values[p.key];
    const set = (v: Values[string]) => setValues((old) => ({ ...old, [p.key]: v }));
    if (p.type === "bool") {
      return (
        <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <Label htmlFor={id}>{p.label}</Label>
            {p.help && <p className="text-xs text-muted-foreground">{p.help}</p>}
          </div>
          <Switch id={id} checked={Boolean(value)} onCheckedChange={set} />
        </div>
      );
    }
    return (
      <div key={p.key} className="space-y-1">
        <Label htmlFor={id}>{p.label}</Label>
        {p.type === "select" ? (
          <Select value={String(value ?? "")} onValueChange={set}>
            <SelectTrigger id={id}><SelectValue /></SelectTrigger>
            <SelectContent>
              {p.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input id={id} value={String(value ?? "")} inputMode={p.type === "int" ? "numeric" : undefined}
            onChange={(e) => set(p.type === "int" ? Number(e.target.value.replace(/\D/g, "") || 0) : e.target.value)} />
        )}
        {p.help && <p className="text-xs text-muted-foreground">{p.help}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Votre situation</DialogTitle>
          <DialogDescription>
            Où vous êtes payé·e et imposé·e : elle décide comment vos fiches de paie sont lues et ce que montre le tableau.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div role="radiogroup" aria-label="Pays" className="grid grid-cols-2 gap-2">
            {packs.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === packId} onClick={() => choose(p.id)}
                className={cn("rounded-xl border px-3 py-3 text-left text-sm transition-colors",
                  p.id === packId ? "border-brand bg-brand/10" : "border-border hover:border-brand/60")}>
                <span className="block font-medium">{p.label}</span>
                <span className="text-xs text-muted-foreground">Salaire en {p.currency}</span>
              </button>
            ))}
          </div>
          {pack?.params.filter(shown).map(field)}
          <div className="space-y-1">
            <Label htmlFor="situation-from">À partir de l&apos;année</Label>
            <Input id="situation-from" value={fromYear} inputMode="numeric" className="w-28"
              onChange={(e) => setFromYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            <p className="text-xs text-muted-foreground">
              Un déménagement se décrit par une nouvelle situation à partir de son année : les fiches d&apos;avant restent lues avec l&apos;ancienne.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={!pack || saveSituation.isPending || fromYear.length !== 4}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
