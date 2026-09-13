/**
 * Every user-facing string lives here (CLAUDE.md invariant 8).
 * Data labels (categories, taxes, communes, quartiers, complaint types) are rows in the
 * database with a `label_fr` column, not entries in this file.
 */
export const fr = {
  app: {
    title: "Plateforme de recouvrement — Ville de Lubumbashi",
    tagline: "Mairie de Lubumbashi · Recensement, taxes, paiements, reçus",
    description:
      "Recensement des contribuables, taxes municipales, paiements mobile money et reçus vérifiables.",
  },
  surfaces: {
    agent: "Application agent (mobile)",
    admin: "Tableau de bord Mairie (web)",
    portal: "Portail contribuable (mobile)",
  },
  common: {
    start: "Commencer",
    comingSoon: "Disponible dans une prochaine étape",
  },
} as const;
