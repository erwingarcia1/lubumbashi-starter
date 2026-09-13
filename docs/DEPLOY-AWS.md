# Déploiement sur AWS (proposition)

Cible retenue (D23) : une VM avec Docker Compose pour l'application (`web` + `worker` + Caddy) et
Supabase hébergé pour Postgres, Auth et Storage. Ci-dessous la liste d'achats et la mise en route,
pensée pour un pilote de ~2 500 ménages à Kampemba puis la montée en charge.

## À acheter / créer

| Poste | Choix | Pourquoi | Coût indicatif |
| --- | --- | --- | --- |
| Serveur | **EC2 `t3.medium`** (2 vCPU, 4 Go, Ubuntu 24.04 LTS, 30 Go gp3) en **`af-south-1` (Le Cap)** | région AWS la plus proche de Lubumbashi (latence ~40 ms vs ~150 ms depuis l'Europe) ; 4 Go suffisent pour Next.js + worker + Caddy | ≈ 40 $/mois (réservable 1 an ≈ 25 $/mois) |
| Adresse fixe | Elastic IP attachée à l'instance | le DNS et les terminaux pointent toujours au même endroit | gratuit tant qu'elle est attachée |
| Base de données | **Supabase Pro** (projet en `eu-central-1` Francfort ou `eu-west-2` Londres — pas de région Afrique chez Supabase) | Postgres + PostGIS, Auth (comptes Mairie), Storage (photos de recensement), sauvegardes quotidiennes, PITR en option | 25 $/mois + usage |
| Domaine | `recouvrement.lubumbashi.cd` (registre .cd) ou un `.com` de transition via Route 53 | HTTPS obligatoire (caméra, GPS, PWA) : Caddy obtient le certificat Let's Encrypt automatiquement | ≈ 12–40 $/an |
| Sauvegardes hors site | Bucket **S3** (même région) avec versioning + cycle de vie 90 jours | `pg_dump` nocturne depuis la VM en plus des sauvegardes Supabase (voir « Sauvegarde et restauration ») | < 1 $/mois |
| Supervision | CloudWatch (métriques EC2 de base) + alerte e-mail sur CPU > 80 % et disque > 80 % ; UptimeRobot ou équivalent sur `https://…/` | savoir avant les agents que le serveur est tombé | gratuit / ≈ 0 $ |
| SMS (plus tard, D11) | Africa's Talking (compte RDC) | fournisseur des SMS de reçu et de rappel | à l'usage |

Budget de pilote : **≈ 70 $/mois**. Alternative plus simple si la latence n'est pas critique :
**Lightsail 4 Go** en `eu-west-3` (Paris), 24 $/mois, même Docker Compose (Lightsail n'existe pas au Cap).

À trancher avec la Mairie : D17 (hébergement des données en RDC ?). Tout est conteneurisé et
Supabase est auto-hébergeable, donc un rapatriement sur un serveur local reste possible.

## Mise en route (≈ 2 heures)

1. **Supabase** : créer le projet, noter `Project URL`, `publishable key`, `secret key`, et la chaîne
   Postgres du pooler en mode *session* (port 5432). Dans *Database → Extensions*, activer `postgis`
   et `pg_trgm` (schéma `extensions`). Dans *Authentication*, désactiver les inscriptions publiques
   (les comptes sont créés par l'Administrateur).
2. **EC2** : lancer `t3.medium` Ubuntu 24.04, groupe de sécurité entrant **22** (votre IP seulement),
   **80** et **443** (partout) ; attacher l'Elastic IP ; créer l'enregistrement DNS `A` du domaine
   vers cette IP.
3. Sur la VM :
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker ubuntu && newgrp docker
   git clone https://github.com/erwingarcia1/lubumbashi-starter.git lubumbashi-tax && cd lubumbashi-tax
   cp .env.example .env.production
   ```
   Remplir `.env.production` : `APP_ENV=production`, `NEXT_PUBLIC_APP_URL=https://<domaine>`,
   `APP_DOMAIN=<domaine>`, les trois valeurs Supabase, `DATABASE_URL` (rôle `app_login`, mot de
   passe choisi dans `APP_DB_PASSWORD`), `DATABASE_URL_MIGRATIONS` (utilisateur `postgres` du
   projet), `AGENT_SESSION_SECRET` et `CRON_SECRET` (32+ caractères aléatoires : `openssl rand -base64 32`),
   `PAYMENT_PROVIDERS=` vide tant qu'aucun vrai fournisseur n'existe (le simulateur est refusé en
   production, invariant 1), `SMS_PROVIDER=console` jusqu'à D11.
4. Migrations, rôles, image et démarrage :
   ```bash
   docker compose --profile migrate run --rm migrate
   docker compose build web
   docker compose up -d web caddy
   docker compose --profile worker up -d worker
   ```
   Caddy obtient le certificat au premier accès ; vérifier `https://<domaine>/` puis `/admin/login`.
5. **Premier administrateur** : `docker compose run --rm migrate pnpm tsx scripts/create-admin.ts`
   (à écrire en M10 ; en attendant, créer l'utilisateur dans Supabase *Authentication* et la ligne
   `app.admin_users` avec le rôle `administrateur`). Ne jamais lancer `pnpm db:seed` en production.
6. **Sauvegarde** : cron quotidien `pg_dump` vers S3 (commande dans `docs/OPERATIONS.md`) et un
   exercice de restauration avant la mise en service.
7. **Terminaux Android** : ouvrir `https://<domaine>/agent/login` dans Chrome, « Ajouter à l'écran
   d'accueil » ; le service worker met l'application en cache pour le hors ligne.

## Ce qui reste manuel aujourd'hui

- Création des comptes Mairie (écran Réglages prévu en M10).
- Rotation de `AGENT_SESSION_SECRET` (déconnecte tous les agents) et des clés Supabase.
- Mises à jour : `git pull && docker compose build web && docker compose up -d web worker`
  (une action GitHub de déploiement peut l'automatiser plus tard).
