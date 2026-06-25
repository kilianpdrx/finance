"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColumnMappingStep } from "@/components/importer/column-mapping-step";
import { ReviewStep } from "@/components/importer/review-step";
import { HoldingsImportReview, type DuplicateAction } from "@/components/investments/holdings-import-review";
import {
  useAccounts, useCategories,
  holdingsImportPreview, holdingsImportConfirm,
  type HoldingsImportPreviewResponse, type HoldingsImportConfirmResponse,
} from "@/lib/api/hooks";
import { uploadApi, type DetectResponse, type ParsePreviewTransaction, type ConfirmResponse } from "@/lib/api/upload";
import { cn } from "@/lib/utils";

type Step = "drop" | "mapping" | "review" | "holdings-review" | "done";

export default function ImporterPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("drop");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [detected, setDetected] = useState<DetectResponse | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [dateFormat, setDateFormat] = useState("%d/%m/%Y");
  const [encoding, setEncoding] = useState("utf-8");
  const [delimiter, setDelimiter] = useState(";");
  const [previewTxns, setPreviewTxns] = useState<ParsePreviewTransaction[]>([]);
  const [holdingsPreview, setHoldingsPreview] = useState<HoldingsImportPreviewResponse | null>(null);
  const [holdingsActions, setHoldingsActions] = useState<Record<string, DuplicateAction>>({});
  const [holdingsResult, setHoldingsResult] = useState<HoldingsImportConfirmResponse | null>(null);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) setSelectedAccount(String(accounts[0].id));
  }, [accounts, selectedAccount]);

  const selectedAccObj = accounts.find((a) => String(a.id) === selectedAccount);
  const isInvestmentTarget = selectedAccObj?.account_type === "investissement";

  const goToReview = async (f: File, opts: Parameters<typeof uploadApi.parsePreview>[1]) => {
    setLoading(true); setError("");
    try {
      const res = await uploadApi.parsePreview(f, { ...opts, accountId: selectedAccount ? Number(selectedAccount) : undefined });
      setPreviewTxns(res.transactions);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de prévisualisation");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv") && f.type !== "text/csv") return setError("Veuillez sélectionner un fichier CSV.");
    setFile(f); setError(""); setLoading(true);

    // Investment accounts use the holdings (positions) pipeline, not the bank-CSV one.
    if (isInvestmentTarget && selectedAccObj) {
      try {
        const data = await holdingsImportPreview(f, selectedAccObj.id);
        const def: Record<string, DuplicateAction> = {};
        for (const h of data.holdings) if (h.is_duplicate) def[h.ticker] = "skip";
        setHoldingsPreview(data); setHoldingsActions(def); setStep("holdings-review");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Format de positions non reconnu (IBKR, Boursorama).");
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await uploadApi.detect(f);
      setDetected(res);
      if (res.detected && res.profile) await goToReview(f, { profileId: res.profile.id });
      else setStep("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de détection");
    } finally {
      setLoading(false);
    }
  };

  const handleHoldingsConfirm = async () => {
    if (!holdingsPreview || !selectedAccObj) return;
    setLoading(true); setError("");
    try {
      const items = holdingsPreview.holdings.map((h) => ({
        ticker: h.ticker, name: h.name, quantity: h.quantity, cost_basis_cents: h.cost_basis_cents,
        currency: h.currency, asset_type: h.asset_type, last_price_cents: h.last_price_cents, isin: h.isin,
        duplicate_action: h.is_duplicate ? (holdingsActions[h.ticker] ?? "skip") : ("skip" as DuplicateAction),
      }));
      const res = await holdingsImportConfirm({ account_id: selectedAccObj.id, holdings: items });
      setHoldingsResult(res); setStep("done");
      qc.invalidateQueries({ queryKey: ["investments"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'import");
    } finally {
      setLoading(false);
    }
  };

  const handleMappingConfirm = async (m: Record<string, string>, fmt: string, enc: string, delim: string, profName: string, save: boolean) => {
    if (!file) return;
    setMapping(m); setDateFormat(fmt); setEncoding(enc); setDelimiter(delim);
    if (save && profName.trim()) {
      try {
        await uploadApi.saveProfile({ name: profName.trim(), column_mapping: m, date_format: fmt, encoding: enc, delimiter: delim, detection_fingerprint: { columns: Object.values(m) } });
      } catch { /* non-blocking */ }
    }
    await goToReview(file, { columnMapping: m, dateFormat: fmt, encoding: enc, delimiter: delim });
  };

  const handleConfirm = async (overrides: Record<string, number | null>, force: string[]) => {
    if (!file || !selectedAccount) return setError("Sélectionnez un compte destination.");
    setLoading(true); setError("");
    try {
      const res = await uploadApi.confirm(file, Number(selectedAccount), {
        profileId: detected?.profile?.id,
        columnMapping: mapping ?? undefined,
        dateFormat: mapping ? dateFormat : undefined,
        encoding: mapping ? encoding : undefined,
        delimiter: mapping ? delimiter : undefined,
        categoryOverrides: overrides,
        forceImportHashes: force,
      });
      setResult(res);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'import");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("drop"); setFile(null); setInputKey((k) => k + 1); setDetected(null);
    setResult(null); setError(""); setMapping(null); setPreviewTxns([]);
    setHoldingsPreview(null); setHoldingsActions({}); setHoldingsResult(null);
  };

  if (step === "done" && holdingsResult) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto size-14 text-positive" />
        <h2 className="mt-4 text-2xl font-semibold">Positions importées</h2>
        <p className="mt-2 text-muted-foreground">{holdingsResult.created} créée(s) · {holdingsResult.updated} mise(s) à jour</p>
        <p className="text-sm text-muted-foreground">{holdingsResult.skipped} ignorée(s)</p>
        <Button className="mt-8" onClick={reset}>Importer un autre fichier</Button>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto size-14 text-positive" />
        <h2 className="mt-4 text-2xl font-semibold">Import terminé</h2>
        <p className="mt-2 text-muted-foreground">{result.imported} transaction(s) importée(s)</p>
        <p className="text-sm text-muted-foreground">{result.skipped} doublon(s) ignoré(s)</p>
        <Button className="mt-8" onClick={reset}>Importer un autre fichier</Button>
      </div>
    );
  }

  if (step === "holdings-review" && holdingsPreview) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h2 className="text-lg font-semibold">Positions — {selectedAccObj?.name}</h2>
        <HoldingsImportReview
          preview={holdingsPreview}
          actions={holdingsActions}
          onActionChange={(ticker, v) => setHoldingsActions((prev) => ({ ...prev, [ticker]: v }))}
        />
        {error && <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Annuler</Button>
          <Button onClick={handleHoldingsConfirm} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Confirmer l&apos;import
          </Button>
        </div>
      </div>
    );
  }

  if (step === "mapping" && detected && file) {
    return (
      <ColumnMappingStep
        rawHeaders={detected.raw_headers} rawPreview={detected.raw_preview} fileName={file.name}
        accounts={accounts} selectedAccount={selectedAccount} onSelectAccount={setSelectedAccount}
        onConfirm={handleMappingConfirm} onBack={reset} loading={loading} error={error}
      />
    );
  }

  if (step === "review" && file) {
    return (
      <ReviewStep
        transactions={previewTxns} categories={categories} accounts={accounts}
        selectedAccount={selectedAccount} onSelectAccount={setSelectedAccount}
        loading={loading} error={error} onConfirm={handleConfirm}
        onBack={() => { setError(""); detected && !detected.detected ? setStep("mapping") : reset(); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Compte destination</span>
        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Choisir un compte" /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}{a.account_type === "investissement" ? " · positions" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files); }}
        className={cn("rounded-2xl border-2 border-dashed p-16 text-center transition-colors",
          dragging ? "border-brand bg-brand/8" : "border-border hover:border-brand/60")}
      >
        <FolderOpen className="mx-auto size-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">
          {isInvestmentTarget ? "Glissez-déposez votre CSV de positions (IBKR, Boursorama)" : "Glissez-déposez votre relevé CSV ici"}
        </p>
        <p className="my-2 text-sm text-muted-foreground">ou</p>
        <label>
          <span className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand-strong">Sélectionner un fichier</span>
          <input key={inputKey} type="file" accept=".csv,text/csv,application/vnd.ms-excel" className="hidden" onChange={(e) => handleFile(e.target.files)} />
        </label>
        <p className="mt-4 text-xs text-muted-foreground">
          {isInvestmentTarget ? "Positions PEA / IBKR — détectées automatiquement" : "CSV de n'importe quelle banque — UBS, Crédit Mutuel, Revolut, BNP…"}
        </p>
      </div>

      {loading && <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Analyse du fichier…</div>}
      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</div>}
    </div>
  );
}
