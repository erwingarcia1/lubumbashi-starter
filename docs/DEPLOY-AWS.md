# Déploiement sur AWS (proposition)

Version anglaise détaillée (clé de déploiement GitHub, pooler Supabase IPv4, serveur de démo vs production) : `docs/DEPLOY-AWS.en.md`.

Cible retenue (D23) : une VM avec Docker Compose pour l'application (`web` + `worker` + Caddy) et
Supabase hébergé pour Postgres, Auth et Storage. Ci-dessous la liste d'achats et la mise en route,
pensée pour un pilote de ~2 500 ménages à Kampemba puis la montée en charge.

## À acheter / créer

| Poste | Choix | Pourquoi | Coût indicatif |
| --- | --- | --- | --- |
| Serveur | **EC2 `t3.medium`** (2 vCPU, 4 Go, Ubuntu 24.04 LTS, 30 Go gp3) en **`af-south-1` (Le Cap)** | région AWS la plus proche de Lubumbashi (≈ 50–80 ms aller-retour via la fibre Zambie–Johannesburg, contre ≈ 190–230 ms vers Francfort ou Londres) ; 4 Go suffisent pour Next.js + worker + Caddy | ≈ 40 $/mois (réservable 1 an ≈ 25 $/mois) |
| Adresse fixe | Elastic IP attachée à l'instance | le DNS et les terminaux pointent toujours au même endroit | ≈ 3,65 $/mois (AWS facture toute adresse IPv4 publique 0,005 $/h depuis février 2024) |
| Base de données | **Supabase Pro** (projet en `eu-central-1` Francfort ou `eu-west-2` Londres — pas de région Afrique chez Supabase) | Postgres + PostGIS, Auth (comptes Mairie), Storage (photos de recensement), sauvegardes quotidiennes, PITR en option | 25 $/mois + usage |
| Domaine | `recouvrement.lubumbashi.cd` chez un registrar accrédité .cd (registre SCPT ; EuroDNS, Africa Registry, Instra, INWX — Route 53 ne vend pas de .cd), DNS chez le registrar ou zone hébergée Route 53 ; ou un `.com` de transition via Route 53 (16 $/an) | HTTPS obligatoire (caméra, GPS, PWA) : Caddy obtient le certificat Let's Encrypt automatiquement | .cd ≈ 50–150 $/an ; .com 16 $/an |
| Sauvegardes hors site | Bucket **S3** (même région) avec versioning + cycle de vie 90 jours | `pg_dump` nocturne depuis la VM en plus des sauvegardes Supabase (voir « Sauvegarde et restauration ») | < 1 $/mois |
| Supervision | CloudWatch (métriques EC2 de base) + alerte e-mail sur CPU > 80 % et disque > 80 % ; UptimeRobot ou équivalent sur `https://…/` | savoir avant les agents que le serveur est tombé | gratuit / ≈ 0 $ |
| SMS (plus tard, D11) | Africa's Talking (compte RDC) | fournisseur des SMS de reçu et de rappel | à l'usage |

Budget de pilote : **≈ 70–75 $/mois** (EC2 ≈ 40 $, IPv4 ≈ 3,65 $, Supabase Pro 25 $, S3 < 1 $) plus le domaine. Alternative plus simple si la latence n'est pas critique :
**Lightsail 4 Go** en `eu-west-3` (Paris), 24 $/mois, même Docker Compose (Lightsail n'existe pas au Cap).

À trancher avec la Mairie : D17 (hébergement des données en RDC ?). Tout est conteneurisé et
Supabase est auto-hébergeable, donc un rapatriement sur un serveur local reste possible.

## Mise en route (≈ 2 heures)

1. **Supabase** : créer le projet ; bouton **Connect** en haut du tableau de bord pour `Project URL`,
   la clé *publishable* et la chaîne Postgres du **Session pooler** (port 5432, utilisateur
   `postgres.<ref>`, hôte `aws-<n>-<région>.pooler.supabase.com`, joignable en IPv4 ; la connexion
   « directe » est IPv6 seulement) ; *Project Settings → API Keys* pour la clé *secret*.
   *Database → Settings* : Default Pool Size ≥ 30. Dans *Database → Extensions*, activer `postgis`
   et `pg_trgm` (schéma `extensions`). Dans *Authentication*, désactiver les inscriptions publiques
   (les comptes sont créés par l'Administrateur).
2. **EC2** : lancer `t3.medium` Ubuntu 24.04, groupe de sécurité entrant **22** (votre IP seulement),
   **80** et **443** (partout) ; attacher l'Elastic IP ; créer l'enregistrement DNS `A` du domaine
   vers cette IP.
3. Sur la VM :
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 docker-buildx git
   sudo usermod -aG docker ubuntu   # puis se déconnecter et se reconnecter
   git clone https://github.com/erwingarcia1/lubumbashi-starter.git lubumbashi-tax && cd lubumbashi-tax
   cp .env.example .env.production
   ln -sf .env.production .env   # Compose lit les ${VARIABLES} de docker-compose.yml dans .env
   ```
   Remplir `.env.production` : `APP_ENV=production`, `NEXT_PUBLIC_APP_URL=https://<domaine>`,
   `APP_DOMAIN=<domaine>`, les trois valeurs Supabase, `DATABASE_URL` (rôle `app_login`, mot de
   passe choisi dans `APP_DB_PASSWORD`), `DATABASE_URL_MIGRATIONS` (utilisateur `postgres` du
   projet), `AGENT_SESSION_SECRET` et `CRON_SECRET` (32+ caractères aléatoires : `openssl rand -base64 32`),
   `PAYMENT_PROVIDERS=` vide tant qu'aucun vrai fournisseur n'existe (le simulateur est refusé en
   production, invariant 1), `SMS_PROVIDER=console` jusqu'à D11.
4. Migrations, rôles, image et démarrage :
   ```bash
   docker compose --profile ops run --rm migrate
   docker compose build web
   docker compose up -d web caddy
   docker compose --profile worker up -d worker
   ```
   Caddy obtient le certificat au premier accès ; vérifier `https://<domaine>/` puis `/admin/login`.
5. **Premier administrateur** :
   ```bash
   docker compose --profile ops run --rm migrate pnpm admin:create --email admin@lubumbashi.cd --name "Nom Prénom" --role administrateur
   ```
   Le mot de passe temporaire s'affiche une fois ; les autres comptes se créent de la même façon
   (`--role maire|finances|superviseur|auditeur`). Ne jamais lancer `pnpm db:seed` en production.
6. **Sauvegarde** : AWS CLI v2 par `sudo snap install aws-cli --classic` (pas de paquet apt sur
   Ubuntu 24.04), rôle IAM attaché à l'instance (jamais de clés d'accès sur la VM), cron quotidien
   `deploy/backup.sh` (`pg_dump` vers S3, variables `DATABASE_URL_MIGRATIONS` et `BACKUP_BUCKET`) et
   l'exercice de restauration de `docs/OPERATIONS.md` avant la mise en service.
7. **Terminaux Android** : ouvrir `https://<domaine>/agent/login` dans Chrome, « Ajouter à l'écran
   d'accueil » ; le service worker met l'application en cache pour le hors ligne.

## Ce qui reste manuel aujourd'hui

- Création des comptes Mairie (écran Réglages prévu en M10).
- Rotation de `AGENT_SESSION_SECRET` (déconnecte tous les agents) et des clés Supabase.
- Mises à jour : `git pull && docker compose --profile ops run --build --rm migrate && docker compose build web && docker compose up -d web caddy && docker compose --profile worker up -d --build worker`
  (une action GitHub de déploiement peut l'automatiser plus tard).
