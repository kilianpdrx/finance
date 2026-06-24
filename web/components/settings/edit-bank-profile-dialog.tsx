"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankProfileMutations, type BankProfile } from "@/lib/api/hooks";

// Logical field → human label (mirrors the importer's column-mapping step).
const FIELDS: { key: string; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Libellé" },
  { key: "amount", label: "Montant (signé)" },
  { key: "debit", label: "Débit" },
  { key: "credit", label: "Crédit" },
  { key: "balance", label: "Solde" },
];

const DATE_FORMATS = ["%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y"];

export function EditBankProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: BankProfile | null;
}) {
  const { update } = useBankProfileMutations();
  const [name, setName] = useState("");
  const [delimiter, setDelimiter] = useState(";");
  const [encoding, setEncoding] = useState("utf-8");
  const [dateFormat, setDateFormat] = useState("%d/%m/%Y");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDelimiter(profile.delimiter ?? ";");
      setEncoding(profile.encoding ?? "utf-8");
      setDateFormat(profile.date_format ?? "%d/%m/%Y");
      setMapping({ ...(profile.column_mapping ?? {}) } as Record<string, string>);
    }
  }, [profile]);

  const submit = async () => {
    if (!profile) return;
    // Drop empty mappings before saving.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapping)) if (v?.trim()) cleaned[k] = v.trim();
    try {
      await update.mutateAsync({
        id: profile.id,
        body: { name: name.trim(), delimiter, encoding, date_format: dateFormat, column_mapping: cleaned },
      });
      toast.success("Profil mis à jour");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier le profil bancaire</DialogTitle>
          <DialogDescription>Associez chaque champ au nom exact de la colonne CSV.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Séparateur</Label>
              <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
                <option value=";">; (point-virgule)</option>
                <option value=",">, (virgule)</option>
                <option value={"\t"}>Tabulation</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Encodage</Label>
              <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
                <option value="utf-8">UTF-8</option>
                <option value="latin-1">Latin-1</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Format date</Label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
                {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Correspondance des colonnes</Label>
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-sm text-muted-foreground">{f.label}</span>
                <Input
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  placeholder="Colonne CSV…"
                  className="h-8 flex-1 text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={update.isPending || !name.trim()}>
            {update.isPending ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
