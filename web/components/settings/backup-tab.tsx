"use client";

import { useState } from "react";
import { Download, Upload, FileSpreadsheet, FileText, Database, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSystemMutations } from "@/lib/api/hooks";
import { toast } from "sonner";

export function BackupTab() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [exporting, setExporting] = useState<null | "xlsx" | "pdf">(null);
  const systemMutations = useSystemMutations();

  // Download via fetch (not a plain <a>) so the active-profile header is sent.
  const downloadReport = async (fmt: "xlsx" | "pdf") => {
    setExporting(fmt);
    try {
      const res = await fetch(`/api/system/export/report.${fmt}`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-${new Date().toISOString().slice(0, 10)}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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

      {/* ── Section 3: Export CSV ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-positive/10 text-positive">
              <FileSpreadsheet className="size-5" />
            </div>
            <div>
              <CardTitle>Exportation des transactions (CSV / Excel)</CardTitle>
              <CardDescription>
                Exporte l'ensemble des transactions du profil actif dans un fichier CSV compatible Excel et Google Sheets.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Le fichier CSV inclut la date, le compte, la catégorie, la description, le montant et le type de transaction.
          </div>
          <Button variant="outline" asChild className="shrink-0 gap-2">
            <a href="/api/system/export/transactions.csv" download>
              <FileSpreadsheet className="size-4" />
              Exporter les transactions (.csv)
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* ── Section 4: Rapport financier (Excel / PDF) ───────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-info/10 text-info">
              <FileText className="size-5" />
            </div>
            <div>
              <CardTitle>Rapport financier (Excel / PDF)</CardTitle>
              <CardDescription>
                Génère un rapport du profil actif : résumé (patrimoine, flux) et tableau de budget sur 12 mois.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Le classeur Excel contient une feuille Résumé et une feuille Budget ; le PDF est prêt à imprimer.
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" className="gap-2" disabled={exporting !== null} onClick={() => downloadReport("xlsx")}>
              <FileSpreadsheet className="size-4" />
              {exporting === "xlsx" ? "Export…" : "Excel (.xlsx)"}
            </Button>
            <Button variant="outline" className="gap-2" disabled={exporting !== null} onClick={() => downloadReport("pdf")}>
              <FileText className="size-4" />
              {exporting === "pdf" ? "Export…" : "PDF (.pdf)"}
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
