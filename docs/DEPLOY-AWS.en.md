# Deploying to AWS (English runbook)

French summary: `docs/DEPLOY-AWS.md`. Target architecture (decision D23): one Linux VM running
Docker Compose for the application (`web` + `worker` + Caddy for HTTPS) and a hosted Supabase
project for Postgres, Auth and Storage. Sized for a pilot of about 2 500 households in Kampemba,
with room to grow. Every command below was checked against the repository on 2026-09-13.

## 1. What to buy or create

| Item | Choice | Why | Indicative cost |
| --- | --- | --- | --- |
| Server | **EC2 `t3.medium`** (2 vCPU, 4 GB RAM, Ubuntu 24.04 LTS, 30 GB gp3 disk) in **`af-south-1` (Cape Town)** | closest AWS region to Lubumbashi (roughly 50–80 ms round trip through the Zambia fibre corridor and Johannesburg, versus roughly 190–230 ms to Frankfurt or London); 4 GB is enough for Next.js + the jobs worker + Caddy | about 40 $/month on demand (about 25 $/month with a 1-year reservation) |
| Fixed address | Elastic IP attached to the instance | DNS and the field terminals always point at the same address | about 3.65 $/month (AWS charges every public IPv4 address 0.005 $/h since February 2024; the auto-assigned public IP costs the same, so the Elastic IP adds nothing on top) |
| Database, logins, photos | **Supabase Pro** project (region `eu-central-1` Frankfurt or `eu-west-2` London; Supabase has no African region) | Postgres + PostGIS, Auth (Mairie accounts), Storage (census photos), daily backups kept 7 days | 25 $/month plus usage (includes 10 $ of compute credit = one Micro instance, 1 GB RAM). Point-in-time recovery is a 100 $/month add-on: not planned for the pilot, the nightly `pg_dump` to S3 covers it |
| Domain | `recouvrement.lubumbashi.cd`, bought from a .cd-accredited registrar (SCPT registry; for example EuroDNS, Africa Registry, Instra, INWX; **Route 53 cannot register .cd**). DNS hosted at that registrar, or in a Route 53 public hosted zone (0.50 $/month) by pointing the .cd name servers at Route 53. Or a transitional `.com` bought through Route 53 (16 $/year) | HTTPS is mandatory (camera, GPS, PWA); Caddy obtains the Let's Encrypt certificate automatically | .cd about 50–150 $/year depending on the registrar; .com 16 $/year |
| Off-site backups | one **S3** bucket (same region) with versioning and a 90-day lifecycle rule | nightly `pg_dump` from the VM, in addition to Supabase's own backups (see "Backup and restore" in `docs/OPERATIONS.md`) | under 1 $/month |
| Monitoring | CloudWatch: a CPU alarm from the built-in EC2 metrics; for disk > 80 % and memory, install the CloudWatch agent (`sudo snap install amazon-cloudwatch-agent --classic`, config with `disk_used_percent` and `mem_used_percent`) and attach `CloudWatchAgentServerPolicy` to the instance role; UptimeRobot or similar on `https://…/` | know the server is down before the agents do | 10 alarms and 10 custom metrics free, then cents per month |
| SMS (later, decision D11) | Africa's Talking (DRC account) | sends the receipt and reminder SMS | pay per message |

Pilot budget: **about 70–75 $/month** (EC2 ≈ 40 $, public IPv4 ≈ 3.65 $, Supabase Pro 25 $, S3 < 1 $)
plus the domain. Simpler alternative if latency is not critical: **Lightsail 4 GB** in `eu-west-3`
(Paris), 24 $/month, same Docker Compose files (Lightsail does not exist in Cape Town).

To settle with the Mairie: D17 (must the data be hosted in DRC?). Everything is containerised and
Supabase can be self-hosted, so moving to a local server later stays possible.

## 2. Demo server or production server?

The same files serve both; one variable decides:

| | Demo server (what you need now to show the POS terminals) | Production pilot |
| --- | --- | --- |
| `APP_ENV` | `demo` | `production` |
| Payments | `PAYMENT_PROVIDERS=mock`: the simulator confirms any amount after 3 s (amounts ending in 999 fail) | `PAYMENT_PROVIDERS=` empty until a real provider exists (decisions D11/D14); the simulator is refused by the app (invariant 1) |
| Data | `SEED_ON_DEPLOY=1` loads the prototype's taxpayers, agents and receipts; test accounts from `docs/TEST-ACCOUNTS.md` | no seed, ever; the first administrator is created with `pnpm admin:create` |
| SMS | `SMS_PROVIDER=console` (messages appear in `docker compose logs web worker`) | same until D11 |

## 3. Set-up (about 2 hours)

### 3.1 Supabase

1. Create the project (Pro plan, region Frankfurt or London). Click **Connect** at the top of the
   dashboard and write down the `Project URL` (this is `NEXT_PUBLIC_SUPABASE_URL`) and the
   **publishable** key (`sb_publishable_…`); then open *Project Settings → API Keys* and copy the
   **secret** key (`sb_secret_…`). Ignore the legacy `anon` / `service_role` JWT keys shown on the
   same page (deprecated at the end of 2026); the app does not use them.
2. In the same **Connect** dialog, copy the **Session pooler** connection string: port 5432, user
   `postgres.<project-ref>`, host `aws-<n>-<region>.pooler.supabase.com` where `<n>` is a pooler
   cluster index (0 or 1 depending on the project, not part of the region name; copy it exactly as
   shown). Use the pooler, not the "direct" string: the direct host `db.<project-ref>.supabase.co`
   is IPv6-only unless you buy the IPv4 add-on (4 $/month), and an EC2 instance has no IPv6 by
   default; the shared pooler is reachable over IPv4 on every plan.
3. *Database → Settings*: set **Default Pool Size** to at least **30**. In session mode every client
   connection holds one Postgres connection: `web` opens up to 10, `worker` up to 20 (its own pool
   plus pg-boss's). A Micro instance allows 60 direct connections, so 30 is safe.
4. *Authentication → Sign In / Providers*: in the *User Signups* block at the top, turn **off**
   "Allow new users to sign up" (accounts are created by the Administrator, never by
   self-registration). Further down, under *Auth Providers*, keep **Email** enabled with password
   sign-in.
5. *Storage → New bucket*: create a **private** bucket named `photos` (census photos; the demo seed
   creates it itself, production does not run the seed).
6. Optional: *Database → Extensions* lists `postgis` and `pg_trgm`. Migration 0001 creates them
   itself in schema `extensions` (both are on Supabase's privileged-extensions list, so the
   `postgres` role may create them); nothing to click.

### 3.2 GitHub access for the server

The repository is private, so the VM needs a read-only deploy key:

```bash
# on your Mac
ssh-keygen -t ed25519 -N "" -f ~/.ssh/lubumbashi-deploy -C "lubumbashi-vm"
cat ~/.ssh/lubumbashi-deploy.pub
```

GitHub → repository → *Settings → Deploy keys → Add deploy key*: paste the public key, leave
"Allow write access" unchecked. Copy the private key to the VM later (`~/.ssh/id_ed25519`).

### 3.3 EC2

1. *EC2 → Launch instance*: name `lubumbashi-tax`, Ubuntu Server 24.04 LTS (64-bit x86), type
   `t3.medium`, a new key pair (download the `.pem`), storage 30 GB gp3. Under *Advanced details*
   set **Metadata version** to `V2 only (token required)`.
2. Security group, inbound rules: **22** (SSH) from *your IP only*, **80** and **443** from anywhere
   (0.0.0.0/0). Nothing else. If your IP changes later, edit the rule in the console or use
   *EC2 → Connect → EC2 Instance Connect* as a fallback.
3. *Elastic IPs → Allocate → Associate* with the instance.
4. DNS: in the registrar's DNS panel (or in a Route 53 public hosted zone whose four name servers
   you set at the registrar) create an `A` record for your domain (for example
   `recouvrement.lubumbashi.cd`) pointing at the Elastic IP. Wait until
   `dig +short recouvrement.lubumbashi.cd` returns the IP.

### 3.4 On the VM

```bash
chmod 400 lubumbashi.pem
ssh -i lubumbashi.pem ubuntu@<elastic-ip>

# Docker, Compose v2, BuildKit plugin, git, and a 2 GB swap file (headroom for the image build on 4 GB)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 docker-buildx git
sudo usermod -aG docker ubuntu     # applies to new logins only: log out and back in after the swap lines
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
exit
```

Log back in (`ssh -i lubumbashi.pem ubuntu@<elastic-ip>`; `id -nG` must now list `docker`), then:

```bash
# deploy key (paste the private key generated in 3.2)
nano ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -t ed25519 github.com | tee -a ~/.ssh/known_hosts | ssh-keygen -lf -
# must print SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU (GitHub's published Ed25519 fingerprint)

git clone git@github.com:erwingarcia1/lubumbashi-starter.git lubumbashi-tax && cd lubumbashi-tax
cp .env.example .env.production
ln -sf .env.production .env   # REQUIRED: Compose reads the ${VARIABLES} of docker-compose.yml from .env;
                              # without this link every `docker compose` command stops with "APP_ENV is unset"
nano .env.production
```

Fill in `.env.production` (every line matters):

| Variable | Value |
| --- | --- |
| `APP_ENV` | `demo` for the demo server, `production` for the pilot (see section 2) |
| `NEXT_PUBLIC_APP_URL` | `https://recouvrement.lubumbashi.cd` (your domain; it is baked into QR codes and SMS links) |
| `APP_DOMAIN` | `recouvrement.lubumbashi.cd` (Caddy requests the certificate for it) |
| `NEXT_PUBLIC_SUPABASE_URL` | the Project URL, `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `SUPABASE_SECRET_KEY` | the secret key |
| `DATABASE_URL_MIGRATIONS` | the Session pooler string with the `postgres.<project-ref>` user and the database password you chose at project creation |
| `APP_DB_PASSWORD` | a new strong password for the application's own database role: `openssl rand -hex 24` (hex only, so it can be pasted into a URL unchanged) |
| `DATABASE_URL` | the same pooler host and port, user `app_login.<project-ref>`, password = `APP_DB_PASSWORD`, database `postgres` |
| `AGENT_SESSION_SECRET` | `openssl rand -hex 32` (rotating it logs every agent out) |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `SEED_ADMIN_PASSWORD` | demo only: the password of the seeded Mairie accounts |
| `PAYMENT_PROVIDERS` | `mock` (demo) or empty (production) |
| `PAYMENT_CHANNELS` | `mpesa,airtel,orange` |
| `PAYMENT_EXPIRY_HOURS` | `24` |
| `SMS_PROVIDER` | `console` until decision D11 |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `NEXT_PUBLIC_MAPTILER_KEY` | optional; without it the map uses OpenStreetMap tiles |

Two traps with passwords: a password that contains `/`, `#`, `%`, `?` or `@` must be URL-encoded
inside a connection string (`/` → `%2F`, `#` → `%23`, `%` → `%25`, `?` → `%3F`, `@` → `%40`); this
applies to the Supabase password in `DATABASE_URL_MIGRATIONS`. And a value containing `$` must be
written `$$` (or single-quoted) because Compose expands `$VAR` inside `.env.production`.

### 3.5 Build, migrate, start

```bash
# 1. database: migrations, the app_login role, and (demo only) the seed data
#    (builds the small `ops` image first: tsx + scripts, no Next.js build)
docker compose --profile ops run --rm migrate                    # production
SEED_ON_DEPLOY=1 docker compose --profile ops run --rm migrate   # demo

# 2. the web image (about 5 minutes the first time) and the HTTPS front
docker compose build web
docker compose up -d web caddy

# 3. the jobs worker (nightly reconciliation 23:30, penalties 00:10, SMS every minute)
docker compose --profile worker up -d worker

# 4. check
docker compose ps
docker compose logs -f caddy          # Caddy requests the certificate at startup: wait for
                                      # "certificate obtained successfully" before the curl below
curl -I https://recouvrement.lubumbashi.cd/
docker compose logs worker            # must end with "worker: reconcile-daily, penalties-daily, notify-flush scheduled"
```

Then open `https://<domain>/admin/login` on a computer and `https://<domain>/agent/login` on a
terminal. On the demo server the seed printed the portal demo links in the `migrate` output; they
are also on the home page.

### 3.6 First administrator (production only)

```bash
docker compose --profile ops run --rm migrate pnpm admin:create --email admin@lubumbashi.cd --name "First Last" --role administrateur
```

The temporary password is printed once. Other accounts are created the same way with
`--role maire|finances|superviseur|auditeur`. Never run `pnpm db:seed` in production (the script
refuses anyway when `APP_ENV=production`).

### 3.7 Backups

Install the AWS CLI v2 on the VM (Ubuntu 24.04 ships no `awscli` apt package):

```bash
sudo snap install aws-cli --classic
aws --version   # aws-cli/2.x
```

Give the VM permission to write to the bucket with an IAM role (never access keys on the VM):

1. *IAM → Roles → Create role* → trusted entity **AWS service**, use case **EC2**. Skip the managed
   policies; name it `lubumbashi-backup-role`.
2. On the role, *Add permissions → Create inline policy → JSON* and paste (replace the bucket name):
   ```json
   {"Version":"2012-10-17","Statement":[
     {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::<bucket>"},
     {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::<bucket>/lubumbashi/*"}
   ]}
   ```
3. *EC2 → Instances → select `lubumbashi-tax` → Actions → Security → Modify IAM role* → choose
   `lubumbashi-backup-role` → **Update IAM role**. The CLI on the VM picks the role up by itself:
   `aws sts get-caller-identity` must show the role.
4. Add the cron entry (`crontab -e`):
   ```
   15 1 * * * cd /home/ubuntu/lubumbashi-tax && DATABASE_URL_MIGRATIONS='<pooler string>' BACKUP_BUCKET=s3://<bucket>/lubumbashi ./deploy/backup.sh >> /var/log/lubumbashi-backup.log 2>&1
   ```
   (`pg_dump` comes with `sudo apt-get install -y postgresql-client-16`; a `$` in the password must
   be escaped in crontab too.)

Run the restore drill from `docs/OPERATIONS.md` ("Sauvegarde et restauration") once before go-live.

### 3.8 Android terminals

Open `https://<domain>/agent/login` in Chrome, log in, then *Add to Home screen*. The service
worker caches the application so census keeps working without network; payments stay online-only.

## 4. Updating the server after a `git push`

```bash
cd ~/lubumbashi-tax && git pull
docker compose --profile ops run --build --rm migrate   # rebuilds the ops image, then applies new migrations, if any
docker compose build web                                 # one Next.js build at a time on 4 GB
docker compose up -d web caddy
docker compose --profile worker up -d --build worker
```

A GitHub Actions workflow that runs these commands over SSH on every push to `main` can be added
later; today the update is this manual minute.

## 5. Still manual today

- Creating Mairie accounts (`pnpm admin:create`; a settings screen is planned).
- Rotating `AGENT_SESSION_SECRET` (logs every agent out) and the Supabase keys.
- Real payment providers and SMS (decisions D11, D12, D14): until then the demo runs on the
  simulator and the console SMS.

## 6. What to know when something fails on the first deploy

- Migration 0001 creates the `postgis` / `pg_trgm` extensions and the `app_rw` role; migration 0003
  grants usage on the `extensions` schema. On Supabase these run as the `postgres` role, which is
  not a superuser but has CREATEROLE and CREATEDB, owns the `postgres` database and the `extensions`
  schema, and may create both extensions. The SQL editor runs as the same `postgres` role, so it is
  not a fallback with more rights: if a statement is refused, the error is real and must be read.
- The `app_login` role is created by the `migrate` container with `APP_DB_PASSWORD`; through the
  pooler its user name is `app_login.<project-ref>`. If `web` logs `Invalid URL`, a password in a
  connection string contains a character that must be URL-encoded (section 3.4).
- The worker connects as `app_login`, which may create tables in schema `pgboss` (migration 0009)
  but has no CREATE privilege on the database; pg-boss therefore runs with `createSchema: false`.
  If `docker compose logs worker` shows `permission denied for database postgres`, that option is
  missing from `scripts/worker.ts`.
- Every `docker compose` command fails with `APP_ENV is unset` when the `.env` symlink of
  section 3.4 is missing; that is deliberate (a production server must never fall back to `demo`).
- The VM's own disk holds only Docker images and logs; the data lives in Supabase.
