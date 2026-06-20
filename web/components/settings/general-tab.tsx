"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, useSettingMutation } from "@/lib/api/hooks";
import { CURRENCIES } from "@/lib/format";

export function GeneralTab() {
  const { data: settings } = useSettings();
  const mutation = useSettingMutation();
  const baseCurrency = settings?.base_currency ?? "CHF";

  const onCurrencyChange = (value: string) => {
    mutation.mutate(
      { key: "base_currency", value },
      { onSuccess: () => toast.success("Devise de base mise à jour") },
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Devise de base</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tous les montants dans les analyses et le tableau de bord seront convertis dans cette devise.
          </p>
          <div className="max-w-xs space-y-1">
            <Label>Devise</Label>
            <Select value={baseCurrency} onValueChange={onCurrencyChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.symbol} — {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
