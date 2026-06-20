"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { Account } from "@/lib/api/hooks";

const FIELD_OPTIONS = [
  { value: "", label: "-- Choisir --" },
  { value: "date", label: "Date" },
  { value: "description", label: "Libellé" },
  { value: "amount", label: "Montant (signé)" },
  { value: "debit", label: "Débit" },
  { value: "credit", label: "Crédit" },
  { value: "balance", label: "Solde" },
  { value: "_ignore", label: "Ignorer" },
];

const SELECT_CLS =
  "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

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
  rawHeaders, rawPreview, fileName, accounts, selectedAccount, onSelectAccount, onConfirm, onBack, loading, error,
}: {
  rawHeaders: string[];
  rawPreview: string[][];
  fileName: string;
  accounts: Account[];
  selectedAccount: string;
  onSelectAccount: (v: string) => void;
  onConfirm: (mapping: Record<string, string>, dateFormat: string, encoding: string, delimiter: string, profileName: string, saveProfile: boolean) => void;
  onBack: () => void;
  loading: boolean;
  error: string;
}) {
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [dateFormat, setDateFormat] = useState("%d/%m/%Y");
  const [encoding, setEncoding] = useState("utf-8");
  const [delimiter, setDelimiter] = useState(";");
  const [saveProfile, setSaveProfile] = useState(false);

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

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Label className="whitespace-nowrap">Compte destination</Label>
          <select value={selectedAccount} onChange={(e) => onSelectAccount(e.target.value)} className={`${SELECT_CLS} flex-1`}>
            {accounts.length === 0 ? <option value="">Aucun compte — créez-en un d&apos;abord</option>
              : accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.bank_name})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Séparateur</Label>
            <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)} className={`${SELECT_CLS} w-full`}>
              <option value=";">Point-virgule (;)</option><option value=",">Virgule (,)</option><option value={"\t"}>Tabulation</option>
            </select>
          </div>
          <div className="space-y-1"><Label>Encodage</Label>
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className={`${SELECT_CLS} w-full`}>
              <option value="utf-8">UTF-8 (+ BOM)</option><option value="latin-1">Latin-1 / ISO-8859-1</option>
            </select>
          </div>
          <div className="space-y-1"><Label>Format date</Label>
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} className={`${SELECT_CLS} w-full`}>
              <option value="%d/%m/%Y">JJ/MM/AAAA</option><option value="%Y-%m-%d">AAAA-MM-JJ</option>
              <option value="%m/%d/%Y">MM/JJ/AAAA</option><option value="%d-%m-%Y">JJ-MM-AAAA</option><option value="%d.%m.%Y">JJ.MM.AAAA</option>
            </select>
          </div>
        </div>
      </Card>

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
                    <select value={mapping[colIdx] || ""} onChange={(e) => setMapping((p) => ({ ...p, [colIdx]: e.target.value }))} className={`${SELECT_CLS} w-full text-xs`}>
                      {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
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
