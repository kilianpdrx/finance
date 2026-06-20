"use client";

import { Wallet, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useAccounts } from "@/lib/api/hooks";
import { useSelectedAccountsStore } from "@/lib/stores";

export function AccountFilter() {
  const { data: accounts = [] } = useAccounts();
  const { selectedAccountIds, setSelectedAccountIds, toggleAccount } = useSelectedAccountsStore();
  const allIds = accounts.map((a) => a.id);

  const label =
    selectedAccountIds === null || selectedAccountIds.length === allIds.length
      ? "Tous les comptes"
      : selectedAccountIds.length === 1
        ? accounts.find((a) => a.id === selectedAccountIds[0])?.name ?? "1 compte"
        : `${selectedAccountIds.length} comptes`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel>Comptes</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setSelectedAccountIds(null)}>
          <span className="flex-1 font-medium">Tous les comptes</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {accounts.map((a) => {
          const checked = selectedAccountIds === null || selectedAccountIds.includes(a.id);
          return (
            <DropdownMenuCheckboxItem key={a.id} checked={checked} onSelect={() => toggleAccount(a.id, allIds)}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
              <span className="flex-1 truncate">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.currency}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
