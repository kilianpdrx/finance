"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/transactions/category-select";
import { useCategories, useRuleMutations, useCategoryMutations } from "@/lib/api/hooks";

/** Lightweight "create a categorization rule" dialog, pre-fillable from a
 *  recurring transaction. Lets the user trim the keyword before saving. */
export function CreateRuleDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill: { description: string; categoryId: number | null } | null;
}) {
  const { data: categories = [] } = useCategories();
  const { create } = useRuleMutations();
  const { rescan } = useCategoryMutations();
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  useEffect(() => {
    if (open && prefill) {
      setKeyword(prefill.description);
      setCategoryId(prefill.categoryId);
    }
  }, [open, prefill]);

  const submit = async () => {
    if (!categoryId || !keyword.trim()) return;
    try {
      await create.mutateAsync({
        categoryId,
        body: {
          conditions: [{ field: "description", operator: "contains", value: keyword.trim() }],
          category_id: categoryId, priority: 100, is_active: true, account_id: null, logic_operator: "AND",
        },
      });
      onOpenChange(false);
      toast.success("Règle créée", {
        action: {
          label: "Appliquer",
          onClick: () => rescan.mutate(undefined, {
            onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transaction(s) recatégorisée(s)`),
          }),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Créer une règle</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Les transactions dont le libellé contient ce texte seront classées dans la catégorie choisie.
            Raccourcissez le libellé pour couvrir toutes les variantes.
          </p>
          <div className="space-y-1">
            <Label>Le libellé contient</Label>
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ex : CARREFOUR" />
          </div>
          <div className="space-y-1">
            <Label>Catégorie</Label>
            <CategorySelect value={categoryId} onChange={setCategoryId} categories={categories} hideNone placeholder="Choisir…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={!categoryId || !keyword.trim() || create.isPending}>Créer la règle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
