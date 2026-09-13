# Comptes de test (environnement local et démo)

Serveur de démonstration en ligne (AWS Le Cap + Supabase Francfort) : **https://13-244-143-138.sslip.io** —
mêmes comptes que ci-dessous, remplacer `http://localhost:3000` par cette adresse. Guide de recette :
`docs/UAT.md`. Liens portail de démonstration : imprimés par le seed sur le serveur et sur la page d'accueil.

Tous ces comptes sont créés par `pnpm db:seed` (fichier `scripts/seed.ts`). Le mot de passe des
administrateurs est la variable `SEED_ADMIN_PASSWORD` de `.env.local` (valeur par défaut ci-dessous).
Jamais utilisés en production : le seed refuse de s'exécuter quand `APP_ENV=production`.

## Tableau de bord Mairie — http://localhost:3000/admin/login

| E-mail | Rôle | Mot de passe |
| --- | --- | --- |
| admin@lubumbashi.cd | Administrateur (tout voir, tout faire) | `Lubumbashi2026!` |
| maire@lubumbashi.cd | Maire (lecture) | `Lubumbashi2026!` |
| ngoy.k@lubumbashi.cd | Finances (barèmes, rapprochement, clôture) | `Lubumbashi2026!` |
| ilunga.m@lubumbashi.cd | Superviseur (contribuables, agents) | `Lubumbashi2026!` |
| auditeur@lubumbashi.cd | Auditeur (lecture, journal) | `Lubumbashi2026!` |

## Application agent — http://localhost:3000/agent/login

| Matricule | PIN | Zone |
| --- | --- | --- |
| AG-KAM-007 | `123456` | Kampemba · Bel-Air (tournée Av. Kasaï) |

## Portail contribuable — pas de mot de passe

Le lien reçu par SMS est l'accès. `pnpm db:seed` imprime un lien stable par contribuable de test ;
le premier est aussi sur la page d'accueil http://localhost:3000 (bouton « Lien de démonstration »).

| Contribuable | Situation |
| --- | --- |
| LUB-KAM-00000125 · Mwamba Kasongo Jean | 10 000 FC dus (août en retard + septembre), 2 reçus |
| LUB-KAM-00000126 · Ilunga Ngoy Patricia | à jour |
| LUB-KAM-00000127 · Banza Mutombo Eric | 5 000 FC dus |
| LUB-KAM-00000128 · Kyungu Mwila Sarah | 50 000 FC dus, un paiement échoué |

Paiement de test : le simulateur confirme tout montant après 3 secondes, sauf les montants finissant
par 999 (refusés « solde insuffisant »). Le SMS de reçu s'imprime dans la console du serveur.

Remise à zéro des données de démonstration : `pnpm db:reset`.
