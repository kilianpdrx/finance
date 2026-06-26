"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CategoriesTab } from "@/components/settings/categories-tab";
import { RulesTab } from "@/components/settings/rules-tab";
import { MlTab } from "@/components/settings/ml-tab";
import { ProfilesTab } from "@/components/settings/profiles-tab";
import { GeneralTab } from "@/components/settings/general-tab";
import { IbkrTab } from "@/components/settings/ibkr-tab";
import { useAccounts } from "@/lib/api/hooks";

export default function ParametresPage() {
  const { data: accounts = [] } = useAccounts();
  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">Général</TabsTrigger>
        <TabsTrigger value="categories">Catégories</TabsTrigger>
        <TabsTrigger value="rules">Règles</TabsTrigger>
        <TabsTrigger value="ml">Modèle ML</TabsTrigger>
        <TabsTrigger value="profiles">Profils bancaires</TabsTrigger>
        <TabsTrigger value="ibkr">IBKR</TabsTrigger>
      </TabsList>
      <TabsContent value="general"><GeneralTab /></TabsContent>
      <TabsContent value="categories"><CategoriesTab /></TabsContent>
      <TabsContent value="rules"><RulesTab accounts={accounts} /></TabsContent>
      <TabsContent value="ml"><MlTab /></TabsContent>
      <TabsContent value="profiles"><ProfilesTab /></TabsContent>
      <TabsContent value="ibkr"><IbkrTab /></TabsContent>
    </Tabs>
  );
}
