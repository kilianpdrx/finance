// Multipart upload endpoints — kept as raw fetch (openapi-fetch is awkward with FormData).
// Requests go through the Next rewrite to the FastAPI backend.

export interface DetectResponse {
  profile: { id: number; name: string } | null;
  filename: string;
  raw_headers: string[];
  raw_preview: string[][];
  detected: boolean;
  /** Best-effort {header_name: role} guesses for the manual-mapping UI. */
  column_guesses: Record<string, string>;
  /** 0..1 confidence that the guesses cover the essential fields. */
  confidence: number;
}

export interface ParsePreviewTransaction {
  date: string;
  description: string;
  amount_cents: number;
  is_debit: boolean;
  balance_after_cents: number | null;
  import_hash: string;
  category_id: number | null;
  category_name: string | null;
  is_duplicate: boolean;
  categorization_source: "rule" | "ml" | null;
  category_conflict: boolean;
}

/** Rows the parser had to drop, per reason, with a few raw examples each.
 *  Surfaced so a short import is explained rather than silently losing rows. */
export interface SkippedReport {
  total: number;
  malformed: number;
  bad_date: number;
  bad_amount: number;
  zero_amount: number;
  missing_fields: number;
  samples: Record<string, string[]>;
}

export interface ParsePreviewResponse {
  transactions: ParsePreviewTransaction[];
  total: number;
  duplicates: number;
  skipped: SkippedReport;
}

export interface ConfirmResponse {
  imported: number;
  skipped: number;
  total: number;
  categorized: number;
  unparsed: SkippedReport;
}

async function post<T>(url: string, form: FormData): Promise<T> {
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) {
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.detail || text);
    } catch {
      throw new Error(text || `Erreur ${r.status}`);
    }
  }
  return r.json() as Promise<T>;
}

export const uploadApi = {
  detect(file: File) {
    const form = new FormData();
    form.append("file", file);
    return post<DetectResponse>("/api/upload/detect", form);
  },
  parsePreview(file: File, opts: { profileId?: number; accountId?: number; columnMapping?: Record<string, string>; dateFormat?: string; encoding?: string; delimiter?: string }) {
    const form = new FormData();
    form.append("file", file);
    if (opts.profileId !== undefined) form.append("profile_id", String(opts.profileId));
    if (opts.accountId !== undefined) form.append("account_id", String(opts.accountId));
    if (opts.columnMapping) form.append("column_mapping", JSON.stringify(opts.columnMapping));
    if (opts.dateFormat) form.append("date_format", opts.dateFormat);
    if (opts.encoding) form.append("encoding", opts.encoding);
    if (opts.delimiter) form.append("delimiter", opts.delimiter);
    return post<ParsePreviewResponse>("/api/upload/parse-preview", form);
  },
  confirm(file: File, accountId: number, opts: {
    profileId?: number; columnMapping?: Record<string, string>; dateFormat?: string; encoding?: string; delimiter?: string;
    categoryOverrides?: Record<string, number | null>; forceImportHashes?: string[];
  }) {
    const form = new FormData();
    form.append("file", file);
    form.append("account_id", String(accountId));
    if (opts.profileId !== undefined) form.append("profile_id", String(opts.profileId));
    if (opts.columnMapping) form.append("column_mapping", JSON.stringify(opts.columnMapping));
    if (opts.dateFormat) form.append("date_format", opts.dateFormat);
    if (opts.encoding) form.append("encoding", opts.encoding);
    if (opts.delimiter) form.append("delimiter", opts.delimiter);
    if (opts.categoryOverrides) form.append("category_overrides", JSON.stringify(opts.categoryOverrides));
    if (opts.forceImportHashes?.length) form.append("force_import_hashes", JSON.stringify(opts.forceImportHashes));
    return post<ConfirmResponse>("/api/upload/confirm", form);
  },
  saveProfile(body: { name: string; column_mapping: Record<string, string>; date_format: string; encoding: string; delimiter: string; detection_fingerprint?: Record<string, unknown> }) {
    return fetch("/api/upload/save-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => {
      if (!r.ok) throw new Error("Échec de sauvegarde du profil");
      return r.json();
    });
  },
};
