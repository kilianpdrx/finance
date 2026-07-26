"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CategoriesTab } from "@/components/settings/categories-tab";
import { RulesTab } from "@/components/settings/rules-tab";
import { ProfilesTab } from "@/components/settings/profiles-tab";
import { GeneralTab } from "@/components/settings/general-tab";
import { IbkrTab } from "@/components/settings/ibkr-tab";
import { BackupTab } from "@/components/settings/backup-tab";
import { useAccounts, useActiveProfile } from "@/lib/api/hooks";
import { DEFAULT_MODULES } from "@/lib/nav";

export default function ParametresPage() {
  const { data: accounts = [] } = useAccounts();
  const activeProfile = useActiveProfile();
  const enabledModules = activeProfile?.enabled_modules ?? DEFAULT_MODULES;
  const hasInvestments = enabledModules.includes("investments");

  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">Général</TabsTrigger>
        <TabsTrigger value="categories">Catégories</TabsTrigger>
        <TabsTrigger value="rules">Règles</TabsTrigger>
        <TabsTrigger value="profiles">Profils bancaires</TabsTrigger>
        {hasInvestments && <TabsTrigger value="ibkr">IBKR</TabsTrigger>}
        <TabsTrigger value="backup">Sauvegarde & Données</TabsTrigger>
      </TabsList>
      <TabsContent value="general"><GeneralTab /></TabsContent>
      <TabsContent value="categories"><CategoriesTab /></TabsContent>
      <TabsContent value="rules"><RulesTab accounts={accounts} /></TabsContent>
      <TabsContent value="profiles"><ProfilesTab /></TabsContent>
      {hasInvestments && <TabsContent value="ibkr"><IbkrTab /></TabsContent>}
      <TabsContent value="backup"><BackupTab /></TabsContent>
    </Tabs>
  );
}



