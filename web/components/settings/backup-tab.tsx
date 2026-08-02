"use client";

import { useState } from "react";
import { Download, Upload, FileSpreadsheet, FileText, Database, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useSystemMutations } from "@/lib/api/hooks";
import { toast } from "sonner";

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function BackupTab() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [exporting, setExporting] = useState<null | "csv" | "xlsx" | "pdf">(null);
  const [dateFrom, setDateFrom] = useState(() => fmtDate(new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1)));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));
  const [includeInv, setIncludeInv] = useState(true);
  const systemMutations = useSystemMutations();

  // Download via fetch (not a plain <a>) so the active-profile header is sent.
  const download = async (fmt: "csv" | "xlsx" | "pdf") => {
    setExporting(fmt);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      let url: string;
      let filename: string;
      if (fmt === "csv") {
        url = `/api/transactions/export?${params}`;
        filename = `transactions-${dateTo}.csv`;
      } else {
        params.set("include_investments", String(includeInv));
        url = `/api/system/export/report.${fmt}?${params}`;
        filename = `rapport-${dateTo}.${fmt}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'export");
    } finally {
      setExporting(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.endsWith(".sqlite") && !file.name.endsWith(".db")) {
        toast.error("Veuillez sélectionner un fichier SQLite (.sqlite ou .db)");
        return;
      }
      setSelectedFile(file);
      setShowConfirmModal(true);
    }
  };

  const handleConfirmRestore = () => {
    if (!selectedFile) return;
    systemMutations.restore.mutate(selectedFile, {
      onSuccess: (data) => {
        toast.success(data.message || "Base de données restaurée avec succès !");
        setSelectedFile(null);
        setShowConfirmModal(false);
      },
      onError: (err) => {
        toast.error(err.message || "Échec de la restauration de la base de données");
        setShowConfirmModal(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Section 1: Sauvegarde ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Database className="size-5" />
            </div>
            <div>
              <CardTitle>Sauvegarde de la base de données</CardTitle>
              <CardDescription>
                Téléchargez une copie de sauvegarde intégrale au format SQLite (.sqlite) de vos comptes, transactions et budgets.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Le fichier contient toutes vos données financières et peut être conservé en lieu sûr ou transféré vers une autre instance.
          </div>
          <Button asChild className="shrink-0 gap-2">
            <a href="/api/system/backup" download>
              <Download className="size-4" />
              Télécharger la sauvegarde (.sqlite)
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* ── Section 2: Restauration ───────────────────────────────────────── */}
      <Card className="border-warning/40">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <Upload className="size-5" />
            </div>
            <div>
              <CardTitle>Restauration de la base de données</CardTitle>
              <CardDescription>
                Restaurez vos données à partir d'un fichier de sauvegarde `.sqlite` ou `.db` précédemment exporté.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-xs text-warning-foreground">
            <div className="flex items-start gap-2 font-medium">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <span>Attention : La restauration remplacera l'intégralité des données actuelles par le contenu du fichier sélectionné.</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="relative inline-flex cursor-pointer items-center justify-center rounded-xl bg-muted px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/80">
              <Upload className="mr-2 size-4" />
              Sélectionner un fichier de sauvegarde…
              <input
                type="file"
                accept=".sqlite,.db"
                className="sr-only"
                onChange={handleFileChange}
                disabled={systemMutations.restore.isPending}
              />
            </label>
            {systemMutations.restore.isPending && (
              <span className="text-xs text-muted-foreground animate-pulse">Restauration en cours…</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 3: Export des données & rapports ─────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-info/10 text-info">
              <FileText className="size-5" />
            </div>
            <div>
              <CardTitle>Exporter vos données</CardTitle>
              <CardDescription>
                Transactions au format CSV, ou un rapport complet (Excel / PDF) reprenant les analyses de l&apos;app, sur la période choisie.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>Du</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>Au</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
              <Checkbox checked={includeInv} onCheckedChange={(v) => setIncludeInv(!!v)} />
              Inclure les investissements
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Le CSV liste les transactions de la période (accents corrigés). Le rapport Excel/PDF reprend le patrimoine,
            les flux, les dépenses, le budget{includeInv ? " et les investissements" : ""} — avec graphiques dans le PDF.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" disabled={exporting !== null} onClick={() => download("csv")}>
              <FileSpreadsheet className="size-4" />
              {exporting === "csv" ? "Export…" : "Transactions (.csv)"}
            </Button>
            <Button variant="outline" className="gap-2" disabled={exporting !== null} onClick={() => download("xlsx")}>
              <FileSpreadsheet className="size-4" />
              {exporting === "xlsx" ? "Export…" : "Rapport Excel (.xlsx)"}
            </Button>
            <Button variant="outline" className="gap-2" disabled={exporting !== null} onClick={() => download("pdf")}>
              <FileText className="size-4" />
              {exporting === "pdf" ? "Génération…" : "Rapport PDF (.pdf)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Modal de Confirmation de Restauration ───────────────────────── */}
      {showConfirmModal && selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-card p-6 shadow-2xl border border-border">
            <div className="flex items-center gap-3 text-warning">
              <AlertTriangle className="size-6 shrink-0" />
              <h3 className="text-base font-semibold">Confirmer la restauration</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Êtes-vous sûr de vouloir restaurer la base de données à partir de <strong className="text-foreground">{selectedFile.name}</strong> ?
              Toutes les données actuellement enregistrées seront écrasées et remplacées.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowConfirmModal(false);
                  setSelectedFile(null);
                }}
                disabled={systemMutations.restore.isPending}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmRestore}
                disabled={systemMutations.restore.isPending}
              >
                {systemMutations.restore.isPending ? "Restauration…" : "Oui, remplacer les données"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
