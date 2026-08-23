"use client";

import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import type { Account } from "@/lib/api/hooks";

/** Sentinel value for the "Global (all accounts)" option. */
export const GLOBAL_ACCOUNT = "__global__";

/** A coloured tile with the account's initial, matching the Comptes page cards. */
export function AccountTile({ account, className = "" }: { account: Account; className?: string }) {
  return (
    <span
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white", className)}
      style={{ backgroundColor: account.color }}
    >
      {account.name[0]?.toUpperCase()}
    </span>
  );
}

function GlobalTile() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Globe className="size-3.5" />
    </span>
  );
}

/** Styled account picker: coloured tile + name + "bank · type", used wherever the
 *  user chooses a destination account. When `includeGlobal` is set, a neutral
 *  "Global (tous les comptes)" option (value `GLOBAL_ACCOUNT`) is offered first. */
export function AccountSelect({
  accounts,
  value,
  onChange,
  className,
  placeholder = "Sélectionner un compte…",
  includeGlobal = false,
  globalLabel = "Global (tous les comptes)",
}: {
  accounts: Account[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  includeGlobal?: boolean;
  globalLabel?: string;
}) {
  const selected = accounts.find((a) => String(a.id) === value);
  const isGlobal = value === GLOBAL_ACCOUNT;
  return (
    <Select value={value} onValueChange={onChange} disabled={accounts.length === 0 && !includeGlobal}>
      <SelectTrigger className={cn("h-11", className)}>
        {isGlobal ? (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <GlobalTile />
            <span className="truncate font-medium text-foreground">{globalLabel}</span>
          </span>
        ) : selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <AccountTile account={selected} />
            <span className="shrink-0 font-medium text-foreground">{selected.name}</span>
            <span className="truncate text-xs text-muted-foreground">· {selected.bank_name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{accounts.length === 0 ? "Aucun compte disponible" : placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {includeGlobal && (
          <SelectItem value={GLOBAL_ACCOUNT} className="py-2">
            <span className="flex items-center gap-2.5">
              <GlobalTile />
              <span className="font-medium">{globalLabel}</span>
            </span>
          </SelectItem>
        )}
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)} className="py-2">
            <span className="flex items-center gap-2.5">
              <AccountTile account={a} />
              <span className="flex flex-col items-start leading-tight">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">
                  {a.bank_name}{a.account_type ? ` · ${ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type}` : ""}
                </span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
