# Tempo — Gestion des horaires

Application web en français pour suivre les heures de travail, les vacances et la présence d’une équipe. Interface adaptée aux ordinateurs et aux téléphones, stockage SQLite persistant, serveur Node.js sans dépendance externe.

## Démarrer

Node.js **24 ou supérieur** est nécessaire (module natif `node:sqlite`).

```sh
cd /workspace/Gestion-des-horaires
npm start
```

Le serveur écoute sur le port **3000**. Le premier écran permet de créer le compte administrateur ; aucun compte ni mot de passe par défaut n’est fourni. Créez ensuite les collaborateurs dans **Utilisateurs**. Chaque utilisateur peut modifier son mot de passe en cliquant sur ses initiales en haut à droite.

```sh
npm run dev  # Redémarrage automatique du serveur pendant le développement
npm test     # Tests HTTP, autorisations, congés et persistance
```

Les tests utilisent une base temporaire séparée et ne modifient pas les données de travail. Aucun `npm install` n’est nécessaire.

## Fonctions

- **Tableau de bord** : heures de la semaine et du mois, graphique hebdomadaire, dernières saisies et solde annuel.
- **Horaires** : arrivée, départ, pause et note ; modification et suppression de ses propres journées ; export CSV.
- **Vacances** : demandes, annulation des demandes en attente, approbation ou refus par un administrateur. Le solde est automatiquement déduit lors de l’approbation.
- **Présence** : tableau partagé de l’équipe pour le jour courant, avec heures déclarées, vacances approuvées ou journée non renseignée.
- **Rapports mensuels** : synthèse et détail personnel ; sélection d’un collaborateur ou de toute l’équipe pour les administrateurs ; téléchargement CSV compatible avec les tableurs.
- **Administration** : création des comptes, rôle, quota annuel, objectif quotidien, consultation des soldes et réinitialisation des mots de passe.

Les collaborateurs accèdent uniquement à leurs propres heures et demandes. La liste de présence expose les noms et horaires du jour, pas les e-mails, les notes privées ou les quotas des autres membres. Les administrateurs peuvent consulter les horaires et congés de l’équipe.

## Règles de calcul

- Temps net = départ − arrivée − pause. Une saisie par personne et par date ; saisir à nouveau la même date la met à jour. La date ne peut pas être future et doit être hors des vacances approuvées.
- Les heures passant minuit doivent être réparties sur deux journées. Les totaux mensuels correspondent aux saisies, sans calcul automatique d’heures supplémentaires ni calcul de paie.
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

Les mots de passe sont hachés avec scrypt et un sel aléatoire. Les sessions durent 24 heures et sont conservées en mémoire : un redémarrage demande une nouvelle connexion. Cookies HttpOnly et SameSite Strict ; contrôles d’autorisation côté serveur ; contrôle des origines pour les écritures ; limitation des tentatives de connexion ; exports protégés contre les formules de tableur.

Avant une utilisation avec une équipe réelle, hébergez derrière HTTPS, définissez `COOKIE_SECURE=true`, protégez le volume de données et planifiez les sauvegardes. Créez le premier administrateur avant d’ouvrir le service au public. Pour une sauvegarde simple, arrêtez le serveur puis copiez **tout le répertoire `data/`** dans un emplacement sécurisé. Pour restaurer, arrêtez le serveur et replacez le répertoire sauvegardé. L’application est prévue pour une seule instance serveur ; elle ne fournit pas d’envoi d’e-mails, de MFA ou de journal d’audit.

## Environnement cloud

Utiliser le dépôt existant dans `/workspace/Gestion-des-horaires`. Les tâches cloud sont déjà isolées ; ne pas créer de worktree sauf demande explicite. Les fichiers et la base persistent sur le volume/snapshot ; le processus serveur doit être relancé dans une nouvelle tâche. L’enregistrement des instructions de démarrage ne publie pas l’environnement.
