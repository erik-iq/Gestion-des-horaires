# Tempo — Gestion des horaires

Application web en français pour suivre les heures de travail, les vacances et la présence d’une équipe. Interface adaptée aux ordinateurs et aux téléphones, stockage SQLite persistant, serveur Node.js avec génération PDF intégrée.

## Nouveautés de la version 2.0

- **Thèmes clair et sombre** inspirés d’IQ Brain, logo IQ intégré, choix mémorisé et interface adaptée aux petits écrans.
- **Quatre vues des horaires** : mois, semaine, journée et liste, avec navigation et détail des journées.
- **Contrats et solde d’heures** : objectif par jour de la semaine, changements datés, ajustement du solde de départ, différence mensuelle et cumul. Dans **Utilisateurs → Contrat**, l’administrateur règle les horaires de chaque collaborateur.
- **Saisie rapide** : horaires favoris, semaines types, copie d’une semaine enregistrée et remplissage d’une période sur les jours sélectionnés. Les journées verrouillées et les vacances approuvées sont ignorées ; remplacer des saisies existantes exige de cocher cette option.
- **Planning hebdomadaire partagé** : horaires et vacances de toute l’équipe, sans notes privées ni données de contrat.
- **Validation mensuelle** : l’administrateur valide un mois terminé dans les rapports. Les totaux sont figés et les écritures concernant ce mois sont verrouillées. La réouverture exige un motif et figure dans l’historique.
- **Rapports PDF** : logo, collaborateur, journées détaillées, heures attendues et réalisées, congés crédités, écart, validation et zones de signature. Export personnel ou équipe complète ; CSV toujours disponible.
- **Historique des modifications** : saisies, contrats, soldes de vacances, demandes, validations et changements de comptes. Les collaborateurs voient leur propre historique ; l’administrateur consulte l’ensemble. Aucun mot de passe n’est journalisé.

Après une mise à jour, les contrats existants sont initialisés du lundi au vendredi à partir de l’ancien objectif quotidien. **Vérifiez leur date de départ et leurs horaires**, puis renseignez un ajustement si vous aviez déjà un solde d’heures. L’historique commence avec cette version : les anciennes modifications ne peuvent pas être reconstituées.

### Mettre à jour votre application existante

1. Dans l’ancienne application, cliquez sur **Quitter Tempo** et confirmez. Fermer seulement l’onglet du navigateur ne suffit pas.
2. Téléchargez le nouveau ZIP et extrayez-le. Remplacez votre ancien `Tempo.exe` par le nouveau, ou ouvrez-le depuis le nouveau dossier.
3. Double-cliquez sur `Tempo.exe`, puis reconnectez-vous avec vos identifiants habituels.

Le dossier **`%LOCALAPPDATA%\Tempo`** reste identique. Vos comptes, horaires et vacances sont conservés ; ne supprimez pas ce dossier. La mise à jour n’ajoute aucune donnée de démonstration à votre base.

## Tester l’application Windows sans installation

La version portable est destinée à **Windows 10/11 x64**.

1. [Téléchargez Tempo pour Windows](https://github.com/erik-iq/Gestion-des-horaires/raw/refs/heads/main/downloads/Tempo-Windows-x64.zip), puis utilisez **Extraire tout** dans Windows.
2. Ouvrez le dossier extrait et double-cliquez sur **Tempo.exe**. Il n’y a ni Node.js à installer, ni commande à exécuter. L’interface s’ouvre dans votre navigateur habituel ; l’application fonctionne sur votre ordinateur, même sans Internet.
3. Au premier lancement, créez votre compte administrateur avec un mot de passe d’au moins 10 caractères.
4. Saisissez une journée de 08:00 à 17:00 avec 60 minutes de pause : le temps net doit être **8h00**. Créez un utilisateur, demandez un jour ouvré de vacances puis approuvez-le comme administrateur : le solde par défaut passe de **25 à 24 jours**.
5. Testez les vues Jour/Semaine, le bouton de thème dans la barre supérieure, puis le rapport mensuel et ses exports PDF/CSV. Pour fermer complètement le programme, cliquez sur **Quitter Tempo** en haut de l’interface, puis confirmez. Fermer seulement l’onglet laisse le service local actif ; un nouveau double-clic sur l’exécutable rouvre la même application.
6. Rouvrez `Tempo.exe` et reconnectez-vous : les comptes, horaires et vacances sont conservés.

Les données sont stockées dans **`%LOCALAPPDATA%\Tempo`**, indépendamment du dossier de l’exécutable. Pour sauvegarder, quittez Tempo puis copiez tout ce dossier. Il ne faut pas lancer l’application depuis le ZIP : extrayez-le d’abord.

Cette version stocke ses données sur **un seul ordinateur et un seul compte Windows**. Plusieurs PC ne partagent pas automatiquement leurs comptes ou horaires ; l’hébergement web ci-dessous reste une option pour une équipe utilisant plusieurs ordinateurs.

Le fichier portable n’est pas signé par un certificat éditeur. Windows peut afficher un avertissement. Le fichier `SHA256SUMS.txt` fourni permet de vérifier son intégrité ; ne désactivez pas les protections Windows.

### Reconstruire la version Windows (développement seulement)

```sh
npm ci
npm run build:windows
```

La compilation s’effectue sous Linux avec Node.js 24 ou supérieur, `curl`, `unzip` et `zip`. Elle télécharge le moteur Windows officiel de **la même version de Node**, vérifie son SHA-256 publié sur nodejs.org, embarque le serveur et l’interface, puis crée `dist/Tempo.exe` et `dist/Tempo-Windows-x64.zip`. Le binaire, les ressources et les licences sont embarqués ; la base de travail n’est jamais incluse dans le ZIP.

Le script construit aussi un exécutable Linux de contrôle pour vérifier le bundle :

```sh
TEMPO_TEST_EXECUTABLE="$PWD/dist/build/Tempo-linux-test" node --test test/desktop.test.js
```

## Option : partager les données en ligne entre plusieurs ordinateurs

[**Mettre Tempo en ligne avec Render**](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Ferik-iq%2FGestion-des-horaires)

1. Cliquez sur le lien et connectez votre compte Render à GitHub. Si le dépôt est privé, autorisez Render à y accéder.
2. Indiquez votre e-mail dans `BOOTSTRAP_ADMIN_EMAIL` et choisissez un mot de passe d’au moins 10 caractères dans `BOOTSTRAP_ADMIN_PASSWORD`. Ces valeurs sont saisies chez l’hébergeur, jamais dans Git ou dans le chat.
3. Vérifiez le tarif du service Starter et de son disque, puis lancez le déploiement. Le modèle crée **un hébergement payant avec stockage persistant** ; il ne correspond pas à l’offre gratuite.
4. Quand Render indique que le service est en ligne, ouvrez l’adresse HTTPS affichée et connectez-vous avec l’e-mail et le mot de passe choisis. Vous pourrez ensuite créer les comptes de votre équipe.

L’application crée votre premier compte administrateur avant d’ouvrir le serveur. Un redéploiement ne remplace pas un compte déjà créé. Après la première connexion, vous pouvez retirer les variables `BOOTSTRAP_ADMIN_EMAIL` et `BOOTSTRAP_ADMIN_PASSWORD` chez Render : elles ne sont plus nécessaires. Les données restent sur le disque persistant ; chaque utilisateur ouvre simplement la même adresse dans son navigateur.

Le fichier `render.yaml` prépare le déploiement, le stockage SQLite et les cookies HTTPS. Les tests applicatifs et les paramètres de démarrage sont vérifiés localement ; le déploiement chez Render reste à lancer et à vérifier depuis un compte Render. Un push sur GitHub ne met pas à lui seul le site en ligne.

## Démarrer

Node.js **24 ou supérieur** est nécessaire (module natif `node:sqlite`).

```sh
cd /workspace/Gestion-des-horaires
npm ci
npm start
```

Le serveur écoute sur le port **3000**. Le premier écran permet de créer le compte administrateur ; aucun compte ni mot de passe par défaut n’est fourni. Créez ensuite les collaborateurs dans **Utilisateurs**. Chaque utilisateur peut modifier son mot de passe en cliquant sur ses initiales en haut à droite.

```sh
npm run dev  # Redémarrage automatique du serveur pendant le développement
npm test     # Tests HTTP, autorisations, congés et persistance
```

Les tests utilisent une base temporaire séparée et ne modifient pas les données de travail. `npm ci` installe les bibliothèques PDF et les outils de compilation. L’exécutable Windows embarque ces ressources et ne nécessite aucune installation sur le PC utilisateur.

## Fonctions

- **Tableau de bord** : heures de la semaine et du mois, graphique hebdomadaire, dernières saisies et solde annuel.
- **Horaires** : vues mois, semaine, journée et liste, saisie rapide, arrivée, départ, pause et note ; modification et suppression de ses propres journées ; export CSV.
- **Vacances** : demandes, annulation des demandes en attente, approbation ou refus par un administrateur. Le solde est automatiquement déduit lors de l’approbation.
- **Présence** : tableau partagé de l’équipe pour le jour courant, avec heures déclarées, vacances approuvées ou journée non renseignée.
- **Rapports mensuels** : synthèse et détail personnel ; sélection d’un collaborateur ou de toute l’équipe pour les administrateurs ; téléchargements PDF et CSV, validation et verrouillage administrateur.
- **Administration** : création des comptes, rôle, quota annuel, contrats hebdomadaires datés, consultation des soldes et réinitialisation des mots de passe.

Les collaborateurs modifient uniquement leurs propres heures et demandes. Le planning d’équipe partage les horaires et absences déclarés, sans notes privées. La liste de présence expose les noms et horaires du jour, pas les e-mails, les notes privées ou les quotas des autres membres. Les administrateurs peuvent consulter les horaires et congés de l’équipe.

## Règles de calcul

- Temps net = départ − arrivée − pause. Une saisie par personne et par date ; saisir à nouveau la même date la met à jour. La date ne peut pas être future et doit être hors des vacances approuvées.
- Les heures passant minuit doivent être réparties sur deux journées. Le solde d’heures correspond au travail net plus les heures de congés approuvés créditées au contrat, moins les heures contractuelles attendues, plus les ajustements datés. Aucun calcul de paie n’est effectué.
- L’objectif est calculé à partir du début du contrat jusqu’à aujourd’hui ou la fin du mois passé. Les jours ouvrés non renseignés créent un déficit **provisoire** et sont signalés dans les rapports. Le mois en cours inclut l’objectif complet de la journée courante. Les mois validés conservent leurs totaux figés.
- Les congés approuvés créditent les heures prévues au contrat pour chaque journée ; une journée déjà travaillée n’est pas créditée deux fois. Le décompte du **quota de vacances** reste distinct, en jours du lundi au vendredi.
- Le solde cumulé part du premier contrat et reprend les mois validés. Un changement de contrat affecte uniquement sa date d’effet et les dates suivantes ; un ajustement de départ ne s’applique qu’à partir de sa date. Les changements rétroactifs affectant un mois verrouillé sont refusés.
- Vacances : jours entiers du lundi au vendredi, **jours fériés inclus**. Le quota annuel est configurable, 25 jours par défaut. Les demandes en attente réservent le solde lors de nouvelles demandes. Les périodes qui se chevauchent sont refusées. Les demandes sur deux années doivent être séparées.
- Le quota est identique chaque année ; aucun report de jours d’une année à l’autre. Les congés approuvés futurs sont inclus dans le solde de leur année.
- La présence repose sur les déclarations du jour, **pas sur un pointage en temps réel**. Une journée sans déclaration ne constitue pas automatiquement une absence.
- Le jour courant est déterminé dans le fuseau **Europe/Zurich**. L’interface et les rapports utilisent le format français suisse.

## Données et exploitation

La base est créée dans `data/horaires.sqlite` (répertoire ignoré par Git). Les comptes de validation navigateur sont dans une base temporaire extérieure au dépôt, jamais dans la base de travail.

Variables facultatives :

| Variable        | Valeur par défaut                    | Usage                                                          |
| --------------- | ------------------------------------ | -------------------------------------------------------------- |
| `PORT`          | `3000`                               | Port HTTP                                                      |
| `HOST`          | `0.0.0.0`                            | Interface d’écoute                                             |
| `DB_PATH`       | `data/horaires.sqlite` dans le dépôt | Chemin de la base SQLite                                       |
| `COOKIE_SECURE` | désactivé                            | Utiliser `true` pour les cookies transmis uniquement par HTTPS |

Les variables facultatives `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` et `BOOTSTRAP_ADMIN_NAME` permettent de préparer le premier administrateur au démarrage sur une base vide. Elles ne modifient jamais les comptes existants.

Les mots de passe sont hachés avec scrypt et un sel aléatoire. Les sessions durent 24 heures et sont conservées en mémoire : un redémarrage demande une nouvelle connexion. Cookies HttpOnly et SameSite Strict ; contrôles d’autorisation côté serveur ; contrôle des origines pour les écritures ; limitation des tentatives de connexion ; exports protégés contre les formules de tableur.

Avant une utilisation avec une équipe réelle, hébergez derrière HTTPS, définissez `COOKIE_SECURE=true`, protégez le volume de données et planifiez les sauvegardes. Créez le premier administrateur avant d’ouvrir le service au public. Pour une sauvegarde simple, arrêtez le serveur puis copiez **tout le répertoire `data/`** dans un emplacement sécurisé. Pour restaurer, arrêtez le serveur et replacez le répertoire sauvegardé. L’application est prévue pour une seule instance serveur ; elle ne fournit pas d’envoi d’e-mails, de MFA. Un historique applicatif est conservé dans SQLite ; il n’est pas un registre externe inviolable.

## Environnement cloud

Utiliser le dépôt existant dans `/workspace/Gestion-des-horaires`. Les tâches cloud sont déjà isolées ; ne pas créer de worktree sauf demande explicite. Les fichiers et la base persistent sur le volume/snapshot ; le processus serveur doit être relancé dans une nouvelle tâche. L’enregistrement des instructions de démarrage ne publie pas l’environnement.

## Ressources et licences

Le logo IQ fourni a été adapté en ressource transparente pour l’interface et les rapports. Les PDF sont générés avec `pdf-lib` et `@pdf-lib/fontkit`. La police DejaVu Sans embarquée assure les accents ; sa licence est conservée dans `public/assets/FONT-LICENSE.txt`. Les licences du moteur Node.js et de la police sont incluses dans la distribution Windows.
