# Recette utilisateur (UAT) — serveur de démonstration

Serveur de démonstration : **https://13-244-143-138.sslip.io** (HTTPS valide, hébergé sur AWS Le Cap,
base Supabase Francfort). Données : les contribuables, agents, reçus et paiements du prototype
(`docs/prototype.html`). Les paiements passent par un **simulateur** : tout montant est confirmé
après 3 secondes, sauf les montants finissant par 999 (refusés « solde insuffisant »). Les SMS ne
sont pas envoyés : ils sont visibles dans les journaux du serveur. Rien ici n'est réel.

## Comptes

| Surface | Adresse | Identifiants |
| --- | --- | --- |
| Tableau de bord Mairie (ordinateur) | https://13-244-143-138.sslip.io/admin/login | `admin@lubumbashi.cd` (Administrateur), `maire@lubumbashi.cd`, `ngoy.k@lubumbashi.cd` (Finances), `ilunga.m@lubumbashi.cd` (Superviseur), `auditeur@lubumbashi.cd` — mot de passe `Lubumbashi2026!` |
| Application agent (téléphone / terminal Android, Chrome) | https://13-244-143-138.sslip.io/agent/login | matricule `AG-KAM-007`, PIN `123456` |
| Portail contribuable (téléphone) | bouton « Lien de démonstration » sur https://13-244-143-138.sslip.io | aucun mot de passe : le lien est l'accès (contribuable LUB-KAM-00000125, 10 000 FC dus) |

Sur le terminal Android : ouvrir l'adresse agent dans Chrome, se connecter, puis « Ajouter à
l'écran d'accueil ». Autoriser la caméra et la position quand Chrome le demande.

## Scénarios à dérouler (cocher, noter les écarts)

### A. Agent de terrain (terminal)
1. Connexion avec le matricule et le PIN ; l'accueil montre la tournée « Av. Kasaï » et « Synchronisé · 0 en attente ».
2. **Recenser** un nouveau ménage en 3 étapes : nom, téléphone, adresse → position GPS et catégorie (l'aperçu affiche 5 000 FC / mois) → identifiant `LUB-KAM-…` et QR code. Un doublon possible est signalé si le nom ressemble à un voisin.
3. **Scanner** : rechercher « Mwamba » ou scanner le QR d'un autocollant → fiche du contribuable : solde, biens, historique.
4. **Encaisser** le solde de Mwamba (10 000 FC) avec M-Pesa : l'écran d'attente reste bloqué jusqu'à la confirmation du simulateur (3 s), puis le reçu apparaît avec son numéro `RCP-…` et le lien de vérification. Essayer ensuite un montant finissant par 999 sur un autre contribuable : le refus est affiché et enregistré.
5. **Hors ligne** : activer le mode avion, recenser 2 ménages (écran « Enregistré hors ligne »), désactiver le mode avion : l'onglet Sync passe à « Synchronisé · 0 en attente » et les identifiants apparaissent. Vérifier que le bouton « Encaisser » est impossible hors ligne.

### B. Portail contribuable (téléphone)
1. Ouvrir le lien de démonstration : « Vous devez 10 000 FC », détail août (en retard) + septembre, deux reçus téléchargeables en PDF.
2. **Payer maintenant** → Airtel Money → confirmation après 3 s, QR du reçu ; retour au compte : « Vous êtes à jour ».
3. **Signaler un problème** → « Les déchets ne sont pas collectés » → la demande apparaît sous « Mes demandes ».
4. Ouvrir l'**avis d'imposition** (lien dans le détail) : « Avis authentique », montant, échéance, QR ; un lien modifié affiche « Avis inconnu ».
5. Depuis un autocollant (`/q/LUB-KAM-00000127`) : « Recevoir mon lien par SMS » ne montre jamais le solde.

### C. Tableau de bord Mairie (ordinateur)
1. `maire@` → **Vue d'ensemble** : recensés, émis, encaissé, taux, impayés, barres par jour et par canal, alertes.
2. **Recettes** : filtres par période, commune, taxe, canal, agent ; tableau des transactions.
3. **Carte** : points colorés sur Kampemba, clic → fiche.
4. **Contribuables** : recherche par nom, téléphone ou identifiant ; fiche avec obligations, paiements, journal ; `ilunga.m@` (Superviseur) corrige un contact ou une catégorie avec motif.
5. **Taxes & barèmes** : `ngoy.k@` (Finances) propose un nouveau montant à une date future → version « Brouillon » ; ne peut pas l'approuver elle-même ; `admin@` l'approuve → « À venir ». Les obligations déjà émises ne changent pas.
6. **Agents** : `ilunga.m@` (Superviseur) ou `admin@` crée un agent (« Nouvel agent » : nom, quartier, PIN à 6 chiffres) → le matricule `AG-KAM-0xx` est attribué ; l'agent se connecte avec ce matricule et ce PIN sur le terminal ; « Changer le PIN » remplace l'ancien code. Taux d'échec, recensements hors zone ; `admin@` révoque un appareil avec motif → l'agent est déconnecté au prochain écran.
7. **Rapprochement** : `ngoy.k@` → journée du jour → « Lancer le rapprochement » → trois types d'écart par canal (absent du relevé, doublon, hors plateforme) → Re-interroger / Demander l'annulation / Rattacher à un contribuable → « Clôturer la journée » → historique.
8. **Journal d'audit** : `auditeur@` retrouve chaque action ci-dessus (qui, quoi, quand, où, appareil) ; filtre par action ; export CSV.
9. **Rapports** : rapport mensuel (PDF et Excel), état des impayés, performance des agents, rapprochement du jour, liste des reçus.

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
