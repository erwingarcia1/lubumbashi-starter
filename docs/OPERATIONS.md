# Opérations — mise en ligne, sauvegarde, exploitation

## Démo en ligne sur un vrai terminal (le plus vite possible)

Les API caméra et GPS d'Android Chrome n'existent que sur une origine HTTPS : l'application doit être servie en `https://`.

### Option A — tunnel depuis le poste de développement (10 minutes, pour tester sur l'appareil)

```bash
brew install cloudflared
pnpm dev                                  # dans un terminal
cloudflared tunnel --url http://localhost:3000   # dans un autre : imprime https://xxxx.trycloudflare.com
```

Ouvrir `https://xxxx.trycloudflare.com/agent` sur le terminal (matricule `AG-KAM-007`, PIN `123456`) et `…/admin` sur un poste (comptes de `README.md`). Mettre `NEXT_PUBLIC_APP_URL` à cette URL dans `.env.local` puis relancer `pnpm dev` pour que les QR codes pointent vers elle. Le tunnel dépend du poste allumé et de la base Supabase locale.

### Option B — serveur (VM) avec Docker Compose et Supabase hébergé (D23)

Prérequis : une VM Linux avec Docker (2 vCPU, 4 Go), un nom de domaine pointant vers la VM (A record), un projet Supabase hébergé (Postgres + Auth + Storage), les ports 80/443 ouverts.

1. Sur Supabase : créer le projet, relever `NEXT_PUBLIC_SUPABASE_URL`, la clé *publishable*, la clé *secret*, et l'URL de connexion **directe** à Postgres (rôle `postgres`).
2. Sur la VM : `git clone …`, `cp .env.example .env.production`, remplir : `APP_ENV=demo`, `NEXT_PUBLIC_APP_URL=https://<domaine>`, les valeurs Supabase, `DATABASE_URL_MIGRATIONS=<URL directe postgres>`, `APP_DB_PASSWORD=<fort>`, `DATABASE_URL=postgresql://app_login:<APP_DB_PASSWORD>@<hôte>:5432/postgres`, `AGENT_SESSION_SECRET=<64 hex>`, `SEED_ADMIN_PASSWORD=<fort>`, `APP_DOMAIN=<domaine>`.
3. `docker compose --profile ops run --rm migrate` — migrations, création du rôle `app_login`, puis `SEED_ON_DEPLOY=1` dans l'environnement pour charger les données de démonstration (jamais en `APP_ENV=production`).
4. `docker compose up -d --build web caddy` — Caddy obtient le certificat Let's Encrypt automatiquement.
5. Vérifier `https://<domaine>/agent/login` sur le terminal et `https://<domaine>/admin/login` sur un poste.

Mise à jour : `git pull && docker compose --profile ops run --rm migrate && docker compose up -d --build web`.

Notes : sur Supabase hébergé, le rôle `app_login` se connecte par l'URL directe (ou via le pooler sous le nom `app_login.<ref>`) ; les clés *secret* et `APP_DB_PASSWORD` ne quittent jamais `.env.production`. Le service `worker` (pg-boss) est activé à partir de M5/M9 (`--profile worker`).

## Notifications (SMS)

Les SMS partent d'une file (`app.notifications`). Le fournisseur est choisi par `SMS_PROVIDER` (`console` imprime le message dans les logs ; les vrais fournisseurs attendent D11). Trois façons de vider la file, à combiner librement :

1. Après chaque confirmation de paiement ou recensement, l'application envoie ce qui est en attente juste après la réponse HTTP (`lib/notify/flush.ts`). Suffisant pour la démo.
2. Un worker permanent : `pnpm notify:worker` en local, ou `docker compose --profile worker up -d worker` sur la VM (toutes les 5 s, `NOTIFY_INTERVAL_MS`).
3. Un cron externe qui appelle l'API avec le secret `CRON_SECRET` :

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://$APP_DOMAIN/api/cron/notifications
```

Liens portail : le SMS de bienvenue contient `https://<domaine>/t/<jeton>` (valable 30 jours, ouvre une session de 12 h). `pnpm db:seed` imprime un lien de démonstration stable par contribuable de test. Depuis l'autocollant de porte (`/q/<identifiant>`), « Recevoir mon lien par SMS » renvoie un nouveau lien au numéro enregistré (un par 10 minutes).

## Espace disque du poste de développement

Colima fait tourner Docker dans une VM dont le disque (20 Gio) est un fichier creux sur le Mac : si le Mac est plein, la VM subit des erreurs d'entrée/sortie et Supabase s'arrête. Garder au moins 10 Gio libres ; `docker builder prune -af` puis `colima ssh -- sudo fstrim -av` rendent l'espace au Mac.

## Sauvegarde et restauration

À écrire en M10 (exercice de restauration documenté). Jusque-là : sauvegardes automatiques du projet Supabase hébergé.
