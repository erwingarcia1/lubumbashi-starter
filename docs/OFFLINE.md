# Recensement hors ligne (M8)

## Ce qui fonctionne sans réseau

- **Recensement** (3 étapes) et **mise à jour de contact** (téléphone, adresse). Chaque enregistrement reçoit un UUID client sur le téléphone et entre dans la file locale (`lib/offline`, IndexedDB via Dexie, table `outbox`).
- Les pages de l'application agent déjà visitées, servies par le service worker (`app/sw.ts`, Serwist) : accueil et tournée, profils consultés, écran de recensement. Une page jamais chargée renvoie `/agent/hors-ligne`.
- Les photos prises hors ligne restent attachées à l'enregistrement et partent après lui ; un échec d'envoi de photo ne bloque jamais l'enregistrement.

## Ce qui ne fonctionne jamais sans réseau

- **Les encaissements** (CLAUDE.md, invariant 3). La file n'a pas de type « paiement » : `assertOutboxKind` refuse tout autre genre, l'écran Encaisser et `/api/v1/payments` sont exclus des caches (`NetworkOnly`), et l'application affiche « encaissements impossibles » dans le bandeau hors ligne.
- La connexion (PIN) et la vérification des doublons en direct (l'étape 1 indique « doublons non vérifiés »).

## Synchronisation

- Déclencheurs : retour du réseau (`online`), ouverture de l'application, bouton « Synchroniser maintenant », et toutes les 30 s tant que la file n'est pas vide.
- Envoi du plus ancien au plus récent. `POST /api/v1/census` est idempotent sur `clientUuid` : renvoyer le même enregistrement (coupure pendant la réponse, double tap) renvoie le même contribuable et le même identifiant, jamais un doublon.
- Résultats : réseau coupé → l'envoi s'arrête, on réessaiera ; `401` → session terminée, la file est conservée et l'agent doit se reconnecter ; `5xx` → nouvel essai plus tard ; autre `4xx` → l'enregistrement est **refusé** (motif affiché dans la file : commune inconnue, saisie invalide…), l'agent peut le renvoyer ou le supprimer.
- L'identifiant municipal (`LUB-KAM-…`) est attribué par le serveur au moment de l'envoi. Hors ligne l'écran final affiche « Identifiant attribué à la synchronisation » et pas de QR : l'autocollant se produit une fois l'enregistrement synchronisé (D25).

## Règles de conflit

| Situation | Règle |
| --- | --- |
| Même `clientUuid` envoyé deux fois | Le serveur renvoie l'enregistrement existant (`created: false`), la file le marque « synchronisé ». |
| Deux agents recensent le même ménage hors ligne (deux UUID) | Deux contribuables sont créés ; le rapprochement se fait au tableau de bord (fusion, D9/D29) car le serveur ne peut pas deviner. La vérification de doublons ne fonctionne qu'en ligne. |
| Mise à jour de contact hors ligne alors que le dashboard a modifié le même champ entre-temps | Dernier écrit gagne, les deux modifications sont dans `audit_log` (qui, quoi, quand, appareil). |
| Enregistrement refusé par le serveur (validation) | Jamais réessayé automatiquement ; l'agent décide (renvoyer ou supprimer). |
| Session expirée (12 h) pendant l'absence de réseau | La file reste sur le téléphone ; après reconnexion et nouvelle connexion PIN, la synchronisation reprend. Le verrouillage inactif est une décision ouverte (D31). |

## Données lues hors ligne

Les pages servies par le cache reflètent la **dernière synchronisation** ; le bandeau « Hors ligne · données de la dernière synchronisation » le rappelle. Aucun solde n'est modifié localement : seul le serveur connaît les paiements.

## Vérifier

- `pnpm test:unit` : `tests/unit/outbox.test.ts` (file, envoi, idempotence, refus, 401, invariant 3).
- `pnpm test:e2e tests/e2e/offline.spec.ts` : 30 recensements hors ligne (mode avion simulé par Playwright), reconnexion, exactement 30 contribuables sur le serveur.
- Sur un téléphone : `pnpm build && pnpm start` (le service worker n'existe qu'en production), installer l'application, mode avion, recenser, désactiver le mode avion, écran Sync.
