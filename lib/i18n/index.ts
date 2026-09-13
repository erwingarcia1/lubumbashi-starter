import { fr } from "./fr";

export type Dictionary = typeof fr;

/** Active dictionary. Swahili (`sw.ts`) will later `satisfies Dictionary`. */
export const t: Dictionary = fr;
