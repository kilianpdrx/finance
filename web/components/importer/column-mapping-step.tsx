"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Landmark, Download, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountSelect } from "@/components/accounts/account-select";
import type { Account } from "@/lib/api/hooks";
import { toast } from "sonner";

interface BankPreset {
  name: string;
  column_mapping: Record<string, string>;
  date_format?: string;
  encoding?: string;
  delimiter?: string;
}

const FIELD_OPTIONS = [
  { value: "", label: "-- Choisir --" },
  { value: "date", label: "Date" },
  { value: "description", label: "Libellé" },
  { value: "amount", label: "Montant (signé)" },
  { value: "debit", label: "Débit" },
  { value: "credit", label: "Crédit" },
  { value: "balance", label: "Solde" },
  { value: "currency", label: "Devise d'origine (optionnel)" },
  { value: "original_amount", label: "Montant d'origine (optionnel)" },
  { value: "_ignore", label: "Ignorer" },
];

function buildLocalPreview(rawPreview: string[][], mapping: Record<number, string>) {
  const colOf: Record<string, number> = {};
  for (const [idx, field] of Object.entries(mapping)) if (field && field !== "_ignore") colOf[field] = Number(idx);
  return rawPreview.slice(0, 5).map((row) => {
    const date = colOf.date != null ? row[colOf.date] ?? "" : "";
    const description = colOf.description != null ? row[colOf.description] ?? "" : "";
    let amount = "";
    if (colOf.amount != null && row[colOf.amount]) amount = row[colOf.amount];
    else if (colOf.debit != null && row[colOf.debit]?.replace(/[^0-9.,]/g, "")) amount = `−${row[colOf.debit]}`;
    else if (colOf.credit != null && row[colOf.credit]?.replace(/[^0-9.,]/g, "")) amount = `+${row[colOf.credit]}`;
    return { date, description, amount };
  }).filter((r) => r.date || r.description);
}

export function ColumnMappingStep({
  rawHeaders, rawPreview, fileName, columnGuesses = {}, confidence = 0, accounts, selectedAccount, onSelectAccount, onConfirm, onBack, loading, error,
}: {
  rawHeaders: string[];
  rawPreview: string[][];
  fileName: string;
  columnGuesses?: Record<string, string>;
  confidence?: number;
  accounts: Account[];
  selectedAccount: string;
  onSelectAccount: (v: string) => void;
  onConfirm: (mapping: Record<string, string>, dateFormat: string, encoding: string, delimiter: string, profileName: string, saveProfile: boolean) => void;
  onBack: () => void;
  loading: boolean;
  error: string;
}) {
  // Pre-fill the mapping from the backend's best-effort column guesses.
  const [mapping, setMapping] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    rawHeaders.forEach((h, idx) => { if (columnGuesses[h]) m[idx] = columnGuesses[h]; });
    return m;
  });
  const [dateFormat, setDateFormat] = useState("%d/%m/%Y");
  const [encoding, setEncoding] = useState("utf-8");
  const [delimiter, setDelimiter] = useState(";");
  const [saveProfile, setSaveProfile] = useState(false);
  const [presets, setPresets] = useState<BankPreset[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Column mapping is where a non-technical user gets stuck. A preset (or a
  // mapping a friend already worked out) answers it in one click.
  useEffect(() => {
    fetch("/api/bank-profiles/presets")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  /** Apply a saved mapping by matching its column NAMES against this file's headers. */
  const applyMapping = (preset: BankPreset) => {
    const next: Record<number, string> = {};
    let hits = 0;
    for (const [role, header] of Object.entries(preset.column_mapping)) {
      const idx = rawHeaders.findIndex((h) => h.trim() === String(header).trim());
      if (idx >= 0) { next[idx] = role; hits++; }
    }
    if (hits === 0) {
      toast.error("Aucune colonne de ce modèle ne correspond à ce fichier.");
      return;
    }
    setMapping(next);
    setDateFormat(preset.date_format || "%d/%m/%Y");
    setEncoding(preset.encoding || "utf-8");
    setDelimiter(preset.delimiter || ";");
    const total = Object.keys(preset.column_mapping).length;
    toast.success(
      hits === total
        ? `Modèle « ${preset.name} » appliqué`
        : `Modèle « ${preset.name} » appliqué (${hits}/${total} colonnes trouvées)`,
    );
  };

  /** Download the current mapping so it can be sent to someone with the same bank. */
  const exportMapping = () => {
    const preset: BankPreset = {
      name: accounts.find((a) => String(a.id) === selectedAccount)?.bank_name || "Mon modèle",
      column_mapping: buildMapping(),
      date_format: dateFormat,
      encoding,
      delimiter,
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modele-${preset.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importMapping = async (file: File) => {
    try {
      const preset = JSON.parse(await file.text()) as BankPreset;
      if (!preset?.column_mapping) throw new Error("Fichier de modèle invalide");
      applyMapping(preset);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Modèle illisible");
    }
  };

  const localPreview = useMemo(() => buildLocalPreview(rawPreview, mapping), [rawPreview, mapping]);

  const mapped = Object.values(mapping).filter((v) => v && v !== "_ignore");
  const isValid = mapped.includes("date") && mapped.includes("description") &&
    (mapped.includes("amount") || (mapped.includes("debit") && mapped.includes("credit"))) && !!selectedAccount;

  const buildMapping = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [idx, field] of Object.entries(mapping)) if (field && field !== "_ignore") out[field] = rawHeaders[Number(idx)];
    return out;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Format inconnu — configurer la correspondance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fichier : <span className="font-mono text-brand">{fileName}</span> · associez chaque colonne au champ correspondant.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>← Recommencer</Button>
      </div>

      {/* Presets & sharing — the shortcut past the hardest step of the import. */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground">
          <Landmark className="size-4" /> Modèle
        </Label>
        <Select onValueChange={(v) => { const p = presets.find((x) => x.name === v); if (p) applyMapping(p); }}>
          <SelectTrigger className="h-9 sm:w-64">
            <SelectValue placeholder={presets.length ? "Choisir une banque connue…" : "Aucun modèle disponible"} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Importer un modèle
          </Button>
          <Button variant="outline" size="sm" onClick={exportMapping} disabled={!mapped.length}>
            <Download className="size-4" /> Exporter
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importMapping(f); e.target.value = ""; }}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
          <Label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground">
            <Wallet className="size-4" /> Compte destination
          </Label>
          <AccountSelect accounts={accounts} value={selectedAccount} onChange={onSelectAccount} className="flex-1"
            placeholder="Créez d'abord un compte" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Séparateur</Label>
            <Select value={delimiter} onValueChange={setDelimiter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value=";">Point-virgule (;)</SelectItem>
                <SelectItem value=",">Virgule (,)</SelectItem>
                <SelectItem value={"\t"}>Tabulation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Encodage</Label>
            <Select value={encoding} onValueChange={setEncoding}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="utf-8">UTF-8 (+ BOM)</SelectItem>
                <SelectItem value="latin-1">Latin-1 / ISO-8859-1</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Format date</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="%d/%m/%Y">JJ/MM/AAAA</SelectItem>
                <SelectItem value="%Y-%m-%d">AAAA-MM-JJ</SelectItem>
                <SelectItem value="%m/%d/%Y">MM/JJ/AAAA</SelectItem>
                <SelectItem value="%d-%m-%Y">JJ-MM-AAAA</SelectItem>
                <SelectItem value="%d.%m.%Y">JJ.MM.AAAA</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {Object.keys(columnGuesses).length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          <span className="inline-flex items-center rounded bg-info/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase">auto</span>
          {confidence >= 1
            ? "Correspondance pré-remplie automatiquement — vérifiez-la avant de continuer."
            : "Correspondance partiellement devinée — complétez les champs manquants ci-dessous."}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Colonnes détectées ({rawHeaders.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-48 px-4 py-2 text-left text-xs text-muted-foreground">Colonne CSV</th>
                <th className="w-44 px-4 py-2 text-left text-xs text-muted-foreground">Correspond à</th>
                {rawPreview.slice(0, 3).map((_, i) => <th key={i} className="px-4 py-2 text-left text-xs text-muted-foreground">Ex. {i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {rawHeaders.map((header, colIdx) => (
                <tr key={colIdx} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{header}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <Select value={mapping[colIdx] || "__none__"}
                        onValueChange={(v) => setMapping((p) => ({ ...p, [colIdx]: v === "__none__" ? "" : v }))}>
                        <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FIELD_OPTIONS.map((o) => (
                            <SelectItem key={o.value || "__none__"} value={o.value || "__none__"} className="text-xs">{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {columnGuesses[header] && mapping[colIdx] === columnGuesses[header] && (
                        <span className="shrink-0 rounded bg-info/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-info" title="Deviné automatiquement">auto</span>
                      )}
                    </div>
                  </td>
                  {rawPreview.slice(0, 3).map((row, i) => <td key={i} className="max-w-xs truncate px-4 py-2 text-xs text-muted-foreground">{row[colIdx] ?? ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {localPreview.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Aperçu de la correspondance</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="px-4 py-2 text-left text-xs text-muted-foreground">Date</th><th className="px-4 py-2 text-left text-xs text-muted-foreground">Libellé</th><th className="px-4 py-2 text-right text-xs text-muted-foreground">Montant</th></tr></thead>
            <tbody>
              {localPreview.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.date}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs">{row.description}</td>
                  <td className={`px-4 py-2 text-right text-xs font-medium ${row.amount.startsWith("−") ? "text-negative" : "text-positive"}`}>{row.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={saveProfile} onCheckedChange={(v) => setSaveProfile(!!v)} />
        <span className="text-sm">Sauvegarder ce format pour les prochains imports</span>
      </label>

      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</div>}

      <div className="flex justify-end">
        <Button
          disabled={!isValid || loading}
          onClick={() => {
            const acc = accounts.find((a) => String(a.id) === selectedAccount);
            onConfirm(buildMapping(), dateFormat, encoding, delimiter, acc?.bank_name ?? "Banque", saveProfile);
          }}
        >
          {loading ? "Chargement…" : "Continuer vers la prévisualisation →"}
        </Button>
      </div>
    </div>
  );
}
