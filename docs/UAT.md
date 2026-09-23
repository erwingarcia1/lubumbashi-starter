# Recette utilisateur (UAT) — serveur de démonstration

Serveur de démonstration : **https://13-244-143-138.sslip.io** (HTTPS valide, hébergé sur AWS Le Cap,
base Supabase Francfort). Données : les contribuables, agents, reçus et paiements du prototype
(`docs/prototype.html`). Les paiements passent par un **simulateur** : tout montant est confirmé
après 3 secondes, sauf les montants finissant par 999 (refusés « solde insuffisant »). Les SMS ne
sont pas envoyés : ils sont visibles dans les journaux du serveur. Rien ici n'est réel.

## Comptes

| Surface | Adresse | Identifiants |
| --- | --- | --- |
| Tableau de bord Mairie (ordinateur, tablette ou téléphone : sur un écran étroit, le menu s'ouvre par le bouton ☰ en haut à gauche) | https://13-244-143-138.sslip.io/admin/login | `admin@lubumbashi.cd` (Administrateur), `maire@lubumbashi.cd`, `ngoy.k@lubumbashi.cd` (Finances), `ilunga.m@lubumbashi.cd` (Superviseur), `auditeur@lubumbashi.cd` — mot de passe `Lubumbashi2026!` |
| Application agent (téléphone / terminal Android, Chrome) | https://13-244-143-138.sslip.io/agent/login | matricule `AG-KAM-007`, PIN `123456` |
| Portail contribuable (téléphone) | bouton « Lien de démonstration » sur https://13-244-143-138.sslip.io | aucun mot de passe : le lien est l'accès (contribuable LUB-KAM-00000125, 10 000 FC dus) |

Sur le terminal Android : ouvrir l'adresse agent dans Chrome, se connecter, puis « Ajouter à
l'écran d'accueil ». Autoriser la caméra et la position quand Chrome le demande.

## Scénarios à dérouler (cocher, noter les écarts)

### A. Agent de terrain (terminal)
1. Connexion avec le matricule et le PIN ; l'accueil montre la tournée « Av. Kasaï » et « Synchronisé · 0 en attente ».
2. **Recenser** un nouveau ménage en 3 étapes : nom, téléphone, adresse → position GPS et catégorie (l'aperçu affiche 5 000 FC / mois) → identifiant `LUB-KAM-…` et QR code. Un doublon possible est signalé si le nom ressemble à un voisin. La position est obligatoire : autoriser la localisation quand le navigateur la demande. Si elle est refusée ou introuvable (ordinateur, intérieur), l'écran l'explique, propose « Réessayer la localisation » et, sur le serveur de démonstration uniquement, « Placer le point sur la carte » (point marqué « placé à la main » dans le journal d'audit ; décision D34). Seule la commune de Kampemba a des quartiers dans les données de démonstration : les autres communes sont grisées.
3. **Scanner** : rechercher « Mwamba » ou scanner le QR d'un autocollant → fiche du contribuable : solde, biens, historique.
4. **Encaisser** le solde de Mwamba (10 000 FC) avec M-Pesa : l'écran d'attente reste bloqué jusqu'à la confirmation du simulateur (3 s), puis le reçu apparaît avec son numéro `RCP-…` et le lien de vérification. Essayer ensuite un montant finissant par 999 sur un autre contribuable : le refus est affiché et enregistré.
5. **Hors ligne** : activer le mode avion, recenser 2 ménages (écran « Enregistré hors ligne »), désactiver le mode avion : l'onglet Sync passe à « Synchronisé · 0 en attente » et les identifiants apparaissent. Vérifier que le bouton « Encaisser » est impossible hors ligne.
6. **Zone d'encaissement (géorepérage)** : sur un ordinateur, Chrome → outils de développement → Sensors → position `-11.9, 27.9` (loin de Bel-Air) ; Scanner → « Ilunga » → Encaisser → M-Pesa → Envoyer : le message « Encaissement refusé : vous êtes hors de votre zone (Bel-Air), à … m de son centre … » s'affiche et aucune demande ne part. Remettre la position sur `-11.6642, 27.493` : la demande part normalement. Sur le terminal, la position est partagée toutes les 3 minutes, application ouverte, de 06:00 à 20:00 (décision D38) ; rien n'est relevé une fois déconnecté.
7. **Mes commissions** : sur l'accueil, la carte « Mes commissions » → l'écran montre pour le mois en cours le nombre d'encaissements, le montant encaissé, la commission (5 % des encaissements confirmés initiés par l'agent), les ménages recensés et la prime (500 FC par ménage), le total du mois, puis le détail par jour et les autres mois avec leur statut (Brouillon / Approuvé / Payé le … · Réf.). Les montants sont provisoires tant que la Mairie n'a pas approuvé le relevé ; après l'étape C.14 le mois apparaît « Payé le … · Réf. VIR-… » et ne bouge plus (barème et règles : décision D36 en attente).

### B. Portail contribuable (téléphone)
1. Ouvrir le lien de démonstration : « Vous devez 10 000 FC », détail août (en retard) + septembre, deux reçus téléchargeables en PDF.
2. **Payer maintenant** → Airtel Money → confirmation après 3 s, QR du reçu ; retour au compte : « Vous êtes à jour ».
3. **Signaler un problème** → « Les déchets ne sont pas collectés » → la demande apparaît sous « Mes demandes ».
4. Ouvrir l'**avis d'imposition** (lien dans le détail) : « Avis authentique », montant, échéance, QR ; un lien modifié affiche « Avis inconnu ».
5. Depuis un autocollant (`/q/LUB-KAM-00000127`) : « Recevoir mon lien par SMS » ne montre jamais le solde.

### C. Tableau de bord Mairie (ordinateur ; les mêmes écrans s'adaptent à la tablette et au téléphone)
1. `maire@` → **Vue d'ensemble** : recensés, émis, encaissé, taux, impayés, barres par jour et par canal, alertes.
2. **Recettes** : filtres par période, commune, taxe, canal, agent ; tableau des transactions.
3. **Carte** : points colorés sur Kampemba, clic → fiche. Changer la commune, le statut ou l'agent à la souris s'applique immédiatement ; au clavier, valider avec Entrée ou quitter le champ (ou « Rechercher »). Les données de démonstration ne couvrent que Kampemba (commune pilote) : une autre commune affiche la carte centrée sur cette commune avec « Aucun contribuable recensé pour ces filtres » ; « Toutes les communes » montre tous les points.
4. **Contribuables** : recherche par nom, téléphone ou identifiant ; fiche avec obligations, paiements, journal ; `ilunga.m@` (Superviseur) corrige un contact ou une catégorie avec motif ; `ngoy.k@` (Finances) annule un paiement confirmé avec motif → le solde redevient dû, le reçu passe « Annulé » (il reste visible et sa vérification publique l'indique), le journal enregistre l'annulation.
5. **Taxes & barèmes** : `ngoy.k@` (Finances) propose un nouveau montant à une date future → version « Brouillon » ; ne peut pas l'approuver elle-même ; `admin@` l'approuve → « À venir ». Les obligations déjà émises ne changent pas.
6. **Agents** : `ilunga.m@` (Superviseur) ou `admin@` crée un agent (« Nouvel agent » : nom, quartier, PIN à 6 chiffres) → le matricule `AG-KAM-0xx` est attribué ; l'agent se connecte avec ce matricule et ce PIN sur le terminal ; « Changer le PIN » remplace l'ancien code. Taux d'échec, recensements hors zone ; `admin@` révoque un appareil avec motif → l'agent est déconnecté au prochain écran.
7. **Rapprochement** : `ngoy.k@` → journée du jour → « Lancer le rapprochement » → trois types d'écart par canal (absent du relevé, doublon, hors plateforme) → Re-interroger / Demander l'annulation / Rattacher à un contribuable → « Clôturer la journée » → historique.
8. **Journal d'audit** : `auditeur@` retrouve chaque action ci-dessus (qui, quoi, quand, où, appareil) ; filtre par action ; export CSV.
9. **Rapports** : rapport mensuel (PDF et Excel), état des impayés, performance des agents, rapprochement du jour, liste des reçus.
10. **Réglages** (`admin@` seulement) : créer un utilisateur Mairie (adresse, nom, rôle) → le mot de passe temporaire s'affiche une fois ; se connecter avec ; changer un rôle ; désactiver puis réactiver un compte.
11. **Recettes** : « Regrouper par » semaine, mois ou année → tableau « Encaissé par période » ; bouton Excel → rapport mensuel.
12. **Activité des agents** : `ilunga.m@` (Superviseur), `admin@`, `maire@` ou `auditeur@` → Agents : chaque ligne indique « aujourd'hui : dernier signal HH:MM · x km · N acte(s) » et un lien « Activité » → carte avec le cercle de la zone autorisée (Bel-Air, 1 500 m), le trajet numéroté de la matinée, les recensements (vert), encaissements (bleu) et refus hors zone (rouge) ; tuiles premier/dernier signal, temps actif, distance, arrêts ≥ 30 min, signaux hors zone ; chronologie détaillée ; « Jour précédent » / champ Jour pour un autre jour. `ngoy.k@` (Finances) est renvoyée vers « Accès refusé ». Carte → « Agents : dernière position du jour » → pastille « 007 » avec sa fiche. Journal d'audit → Action `payment.refused` : le refus de l'étape A.6 avec sa position GPS.
13. **Note de perception** : `ngoy.k@` (Finances), `ilunga.m@` (Superviseur) ou `admin@` → Contribuables → LUB-KAM-00000125 → ligne « sept. 2026 » → « Note de perception » : un PDF A4 s'ouvre (en-tête Ville de Lubumbashi, numéro `AV-2609-…`, contribuable, bien, taxe, période, montant, pénalité, reste à payer, QR de vérification, mentions légales provisoires, bloc signature ; modèle « placeholder-1 » en attendant le modèle officiel, décision D35). De retour sur la fiche, « émise le <date> » apparaît sous le lien ; rouvrir la note ne change ni le numéro ni la date d'émission. Scanner le QR → « Avis authentique » → « Payer cet avis ». Rapports → « Notes de perception du mois » → une note par page pour toutes les obligations dues du mois. `maire@` et `auditeur@` voient la date d'émission mais pas le lien ; le journal d'audit contient `invoice.issued` (qui, quand, adresse IP).
14. **Commissions des agents** : `ngoy.k@` (Finances) ou `admin@` → Commissions → mois (par défaut le mois en cours) : une ligne par agent (encaissements, encaissé, commission 5 %, recensés, prime 500 FC, total, statut). « Recalculer les brouillons » recalcule à partir des paiements confirmés ; « Approuver » sur la ligne AG-KAM-007 fige le relevé (statut « Approuvé ») ; saisir une référence de virement puis « Marquer payé » → « Payé le … · VIR-… ». Un paiement annulé (C.4) est déduit le mois de l'annulation. « Exporter (Excel) » télécharge le rapport « Commissions des agents ». En bas, « Barème des commissions » : `admin@` seulement crée une nouvelle version (taux ou montant, date future) ; les relevés déjà approuvés ne changent pas. `auditeur@`, `maire@` et `ilunga.m@` voient tout en lecture seule. Journal d'audit → `commission_statement.approved`, `commission_statement.paid`, `commission_rule.created`. Sur le terminal, l'agent retrouve le mois « Payé le … » (A.7).

### D. Ce qui est volontairement impossible (à vérifier aussi)
- Un agent ne peut ni marquer un paiement comme reçu ni modifier un montant.
- Aucun paiement hors ligne.
- Le journal d'audit ne peut être ni modifié ni supprimé, même par l'Administrateur.
- Le simulateur refuse les montants en 999 ; il sera remplacé par les vrais opérateurs (D11/D14).

## Signaler un écart

Pour chaque anomalie : la surface (agent, portail, Mairie), le compte utilisé, l'heure (heure de
Lubumbashi), ce qui était attendu, ce qui s'est passé, une capture d'écran si possible. Le journal
d'audit et les journaux du serveur permettent de retrouver l'action.

## Remise à zéro

Les données de démonstration se consomment (un solde payé le reste). Pour repartir d'un état neuf,
l'équipe technique exécute `docker compose --profile ops run --rm migrate pnpm db:reset` sur le
serveur (environ 2 minutes) ; les comptes restent les mêmes.
