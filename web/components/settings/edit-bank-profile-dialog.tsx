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

const INVEST_FIELDS: { key: string; label: string }[] = [
  { key: "ticker", label: "Ticker / Symbole" },
  { key: "isin", label: "ISIN" },
  { key: "name", label: "Nom de la position" },
  { key: "quantity", label: "Quantité" },
  { key: "buyingPrice", label: "Prix de revient unitaire" },
  { key: "lastPrice", label: "Dernier cours (optionnel)" },
  { key: "currency", label: "Devise (optionnel)" },
];

const DATE_FORMATS = ["%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y"];

export function EditBankProfileDialog({
  open,
  onOpenChange,
  profile,
  isInvestment = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: any | null;
  isInvestment?: boolean;
}) {
  const { create, update } = useBankProfileMutations();
  const [name, setName] = useState("");
  const [delimiter, setDelimiter] = useState(";");
  const [encoding, setEncoding] = useState("utf-8");
  const [dateFormat, setDateFormat] = useState("%d/%m/%Y");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setDelimiter(profile.delimiter ?? ";");
      setEncoding(profile.encoding ?? "utf-8");
      setDateFormat(profile.date_format ?? "%d/%m/%Y");
      setMapping({ ...(profile.column_mapping ?? {}) } as Record<string, string>);
    } else {
      setName("");
      setDelimiter(";");
      setEncoding("utf-8");
      setDateFormat("%d/%m/%Y");
      setMapping({});
    }
  }, [profile]);

  const isProfileInvestment = isInvestment || (profile && profile.column_mapping && ("quantity" in profile.column_mapping || "buyingPrice" in profile.column_mapping || "ticker" in profile.column_mapping));
  const fields = isProfileInvestment ? INVEST_FIELDS : FIELDS;

  const submit = async () => {
    if (!profile) return;
    // Drop empty mappings before saving.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapping)) if (v?.trim()) cleaned[k] = v.trim();
    try {
      if (profile.id !== undefined && profile.id !== 0) {
        await update.mutateAsync({
          id: profile.id,
          body: { name: name.trim(), delimiter, encoding, date_format: dateFormat, column_mapping: cleaned },
        });
        toast.success("Profil mis à jour");
      } else {
        await create.mutateAsync({
          name: name.trim(),
          delimiter,
          encoding,
          date_format: dateFormat,
          column_mapping: cleaned,
          detection_fingerprint: { columns: Object.values(cleaned) },
        });
        toast.success("Profil créé");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const title = profile?.id === undefined || profile?.id === 0
    ? (isProfileInvestment ? "Créer un profil d'investissement" : "Créer un profil bancaire")
    : (isProfileInvestment ? "Modifier le profil d'investissement" : "Modifier le profil bancaire");

  const description = isProfileInvestment
    ? "Associez chaque champ de la position au nom exact de la colonne CSV."
    : "Associez chaque champ du relevé au nom exact de la colonne CSV.";

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nom du profil</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={isProfileInvestment ? "Ex: MyBroker CSV" : "Ex: Crédit Agricole Relevé"} />
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
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-sm text-muted-foreground">{f.label}</span>
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
          <Button onClick={submit} disabled={isPending || !name.trim()}>
            {isPending ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
