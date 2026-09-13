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

## Sauvegarde et restauration

À écrire en M10 (exercice de restauration documenté). Jusque-là : sauvegardes automatiques du projet Supabase hébergé.
