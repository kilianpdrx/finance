# Finance — mode d'emploi

Une application de finances personnelles qui tourne **entièrement sur votre ordinateur**.
Pas de compte, pas d'inscription, aucune donnée envoyée sur internet.

---

## Installation (une seule fois, ~5 minutes)

### 1. Installez Docker Desktop
C'est le moteur qui fait tourner l'application. Gratuit.

- **Mac / Windows** : https://www.docker.com/products/docker-desktop/
- Installez-le, puis **ouvrez-le une fois** pour qu'il démarre.

Vous saurez qu'il est prêt quand son icône indique « running ».

### 2. Lancez l'application

- **Mac** : double-cliquez sur **Finance**
- **Windows** : double-cliquez sur **Finance.bat**

La première fois, le téléchargement prend une minute ou deux. Ensuite, votre navigateur
s'ouvre tout seul sur l'application.

> **Mac — « fichier non autorisé »** : faites un clic droit sur *Finance* → **Ouvrir**,
> puis confirmez. C'est à faire une seule fois.

---

## Utilisation au quotidien

| Pour… | Faites… |
|---|---|
| Ouvrir l'application | Double-clic sur **Finance** |
| Fermer l'application | Double-clic sur **Arreter** |
| Mettre à jour | Rien de spécial : **relancez Finance**, la dernière version est installée automatiquement |

Inutile d'ouvrir Docker Desktop avant : **Finance le démarre tout seul** s'il n'est pas
déjà lancé (comptez une minute de plus dans ce cas).

L'adresse est toujours **http://127.0.0.1:3000** — vous pouvez la mettre en favori.

---

## Premiers pas

1. **Créez un compte** (onglet *Comptes*) : un nom, votre banque, la devise. La devise de
   ce premier compte devient celle de vos tableaux de bord (modifiable dans *Paramètres*).
2. **Récupérez un relevé au format CSV.** Un CSV est un simple fichier texte qui liste vos
   opérations, une par ligne. La plupart des banques le proposent sur leur site : dans
   l'historique de votre compte, cherchez un bouton *Exporter* ou *Télécharger* et
   choisissez le format **CSV** (parfois présenté comme « tableur » ou « Excel »).
3. **Importez-le** (onglet *Importer*) : choisissez le compte, glissez le fichier, vérifiez
   les colonnes proposées, puis confirmez.

Vos dépenses sont classées automatiquement par des règles. Celles qui restent « sans
catégorie » se classent depuis l'onglet *Transactions*, et vous pouvez créer vos propres
règles pour que les suivantes le soient toutes seules.

Le fichier CSV ne sert qu'à l'import : une fois importé, l'application n'en a plus besoin.

---

## Vos données

- Tout est dans le dossier **`data`**, juste à côté de ce fichier. C'est le seul dossier
  qui compte.
- **Une sauvegarde est créée automatiquement à chaque lancement**, avant toute mise à
  jour, dans `data/backups` (les 5 dernières sont conservées). C'est votre filet de
  sécurité si une mise à jour se passe mal.
- **Sauvegarde** : dans l'application, allez dans **Paramètres → Sauvegarde & Données** et
  cliquez sur *Télécharger la sauvegarde*. Rangez le fichier `.sqlite` en lieu sûr.
- **Restauration** : même écran, bouton *Restaurer*. Une copie de sécurité de vos données
  actuelles est conservée automatiquement avant le remplacement.

> ⚠️ **Faites une sauvegarde avant chaque mise à jour.** Une mise à jour modifie la
> structure de la base et **ne peut pas être annulée** — la sauvegarde est le seul retour
> en arrière possible.

---

## Bon à savoir

- **C'est privé.** L'application n'écoute que sur votre propre machine : les autres
  appareils de votre wifi ne peuvent pas y accéder. Il n'y a pas de mot de passe *parce
  que* personne d'autre ne peut s'y connecter — ne modifiez donc pas les adresses
  `127.0.0.1` dans `docker-compose.yml`, et ne l'exposez pas sur internet.
- **Chacun sa copie.** Pour partager avec quelqu'un, donnez-lui ce dossier (sans le
  dossier `data`, qui contient vos comptes !). Vous pouvez vous échanger des données via
  le fichier de sauvegarde.
- **Premier démarrage** : l'application arrive avec des catégories et des règles de
  classement automatique déjà prêtes — voir [Premiers pas](#premiers-pas).

---

## En cas de problème

| Symptôme | Solution |
|---|---|
| « Docker n'est pas installé » | Installez Docker Desktop (étape 1), puis relancez |
| « Docker ne répond pas » | Ouvrez Docker Desktop, attendez « running », relancez |
| Le port 3000 est occupé | Fermez l'autre programme qui l'utilise, ou redémarrez l'ordinateur |
| Bandeau rouge « Serveur inaccessible » | Vos données sont intactes. Double-cliquez sur **Arreter**, puis sur **Finance** |
| Autre | Paramètres → **Sauvegarde & Données** → *Rapport de diagnostic*, et envoyez le fichier |
