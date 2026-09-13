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

Notes : sur Supabase hébergé, utiliser le **Session pooler** (IPv4) : le rôle `app_login` s'y connecte sous le nom `app_login.<ref>` ; le worker pg-boss tourne avec `createSchema: false` (le schéma `pgboss` vient de la migration 0009) ; procédure complète dans `docs/DEPLOY-AWS.en.md` ; les clés *secret* et `APP_DB_PASSWORD` ne quittent jamais `.env.production`. Le service `worker` (pg-boss) est activé à partir de M5/M9 (`--profile worker`).

## Notifications (SMS)

Les SMS partent d'une file (`app.notifications`). Le fournisseur est choisi par `SMS_PROVIDER` (`console` imprime le message dans les logs ; les vrais fournisseurs attendent D11). Trois façons de vider la file, à combiner librement :

1. Après chaque confirmation de paiement ou recensement, l'application envoie ce qui est en attente juste après la réponse HTTP (`lib/notify/flush.ts`). Suffisant pour la démo.
2. Un worker permanent : `pnpm notify:worker` en local, ou `docker compose --profile worker up -d worker` sur la VM (toutes les 5 s, `NOTIFY_INTERVAL_MS`).
3. Un cron externe qui appelle l'API avec le secret `CRON_SECRET` :

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://$APP_DOMAIN/api/cron/notifications
```

Liens portail : le SMS de bienvenue contient `https://<domaine>/t/<jeton>` (valable 30 jours, ouvre une session de 12 h). `pnpm db:seed` imprime un lien de démonstration stable par contribuable de test. Depuis l'autocollant de porte (`/q/<identifiant>`), « Recevoir mon lien par SMS » renvoie un nouveau lien au numéro enregistré (un par 10 minutes).

## Sécurité (M10)

- Limitation de débit en mémoire (`lib/security/rate-limit.ts`) : connexion agent 20 échecs / 15 min par IP (en plus du verrouillage du compte après 5 échecs), connexion Mairie 10 échecs / 15 min par IP (une connexion réussie remet le compteur à zéro), demandes de paiement 30 / min par agent, portail 10 paiements / min et 5 liens / 10 min par IP. Réponse `429 too_many_requests`. Un seul conteneur `web` (D23) : un stockage partagé remplacera la mémoire si une seconde instance apparaît.
- Sessions : agent 12 h (cookie signé HMAC, appareil re-vérifié à chaque requête, révocation immédiate), Mairie via Supabase Auth (jeton d'accès 1 h renouvelé par `proxy.ts`), portail 12 h à partir d'un lien signé valable 30 jours et révocable.
- Journal d'audit en ajout seul, y compris pour le rôle propriétaire (déclencheur base de données) ; chaque export de rapport est lui-même journalisé.

## Tâches planifiées (rapprochement, pénalités, SMS)

Un seul processus, `pnpm worker` (`scripts/worker.ts`, pg-boss, schéma `pgboss` créé par la migration 0009), planifie en heure de Lubumbashi :

| Tâche | Heure | Ce qu'elle fait |
| --- | --- | --- |
| `reconcile-daily` | 23:30 | relevé de chaque canal pour la journée écoulée, rapprochement, écarts |
| `penalties-daily` | 00:10 | inscrit les pénalités de retard calculées par le moteur sur les obligations ouvertes |
| `notify-flush` | chaque minute | envoie les SMS en file |

Sur la VM : `docker compose --profile worker up -d worker`. Sans worker, un cron externe peut appeler les mêmes traitements :

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://$APP_DOMAIN/api/cron/reconcile?day=2026-09-12"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://$APP_DOMAIN/api/cron/penalties"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://$APP_DOMAIN/api/cron/notifications"
```

La clôture de la journée se fait à la main par Finances dans Rapprochement, une fois tous les écarts traités.

## Espace disque du poste de développement

Colima fait tourner Docker dans une VM dont le disque (20 Gio) est un fichier creux sur le Mac : si le Mac est plein, la VM subit des erreurs d'entrée/sortie et Supabase s'arrête. Garder au moins 10 Gio libres ; `docker builder prune -af` puis `colima ssh -- sudo fstrim -av` rendent l'espace au Mac.

## Régression sur le serveur de démonstration

Les parcours Playwright qui n'ont pas besoin d'accéder directement à la base tournent contre le
serveur (les parcours `portal` et `offline` restent locaux : ils plantent un lien ou comptent des
lignes en base) :

```bash
PLAYWRIGHT_BASE_URL=https://13-244-143-138.sslip.io pnpm test:e2e:remote
```

Ils créent des ménages, encaissent, révoquent un appareil et clôturent la journée : remettre
ensuite les données de démonstration à zéro sur le serveur :

```bash
ssh -i ~/Downloads/lubumbashi-tax.pem ubuntu@13.244.143.138 'cd ~/lubumbashi-tax && docker compose --profile ops run --rm migrate pnpm db:reset'
```

## Sauvegarde et restauration

Deux niveaux : les sauvegardes automatiques du projet Supabase (quotidiennes, PITR en option) et une
sauvegarde logique nocturne faite par la VM, hors du compte Supabase, vers S3 : `deploy/backup.sh`
(`pg_dump --format=custom` des schémas `app`, `util`, `pgboss`). Cron sur la VM :

```
15 1 * * * cd /opt/lubumbashi-tax && DATABASE_URL_MIGRATIONS=... BACKUP_BUCKET=s3://... ./deploy/backup.sh >> /var/log/lubumbashi-backup.log 2>&1
```

Exercice de restauration (fait le 2026-09-13 sur la base locale, 24 Mo : 40 contribuables,
22 paiements, 19 reçus, 175 lignes d'audit ; dump + restauration en moins de 2 secondes) :

```bash
aws s3 cp s3://<bucket>/lubumbashi-<date>.dump /tmp/restore.dump
createdb -h <hôte> -U postgres restore_drill
psql -h <hôte> -U postgres -d restore_drill -c "create schema if not exists extensions; create extension if not exists postgis schema extensions; create extension if not exists pg_trgm schema extensions;"
pg_restore -h <hôte> -U postgres --dbname=restore_drill --no-owner --no-privileges /tmp/restore.dump
psql -h <hôte> -U postgres -d restore_drill -c "select count(*) from app.taxpayers; select count(*) from app.receipts; select max(created_at) from app.audit_log;"
```

Les compteurs (`id_counters`, `receipt_counters`, `invoice_counters`) font partie du dump : les
numéros continuent sans trou après restauration. Pour restaurer en production : arrêter `web` et
`worker`, restaurer dans une base neuve, pointer `DATABASE_URL` dessus, relancer `pnpm db:migrate`
(recrée les rôles et grants), redémarrer. Les utilisateurs Auth (schéma `auth`) sont restaurés par
Supabase, pas par ce dump ; les photos sont dans le bucket Storage (sauvegardé par Supabase).

À refaire à chaque trimestre et avant toute migration importante ; noter la date et la durée ici.
