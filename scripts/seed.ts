/**
 * Seed: the prototype's zones, categories, tax rules, agents, taxpayers, obligations, payments
 * and receipts (docs/prototype.html), loaded idempotently through the runtime role.
 *
 * Invariant 1: every confirmed payment is written together with its provider_confirmations row
 * (provider `mock`, raw payload marked seeded). The seed therefore refuses production.
 *
 * Where the prototype contradicts itself, the portal/profile view wins:
 * - taxpayer 125 is registered on 2 June 2026 so that its two receipts (June, July paid in July
 *   and August) and its balance (August late + September due = 10 000 FC) are all true;
 * - the assainissement/étalage rules are effective 2026-06-01 (prototype: 01/07) for the same reason;
 * - receipt numbers come from the gapless counter, so they differ from the prototype's samples;
 * - DECISION-PENDING: D27 — no back-dated obligations; registration dates move earlier instead.
 */
import { loadEnvConfig } from "@next/env";
import { hash } from "@node-rs/argon2";
import { createClient } from "@supabase/supabase-js";
import { and, eq, getTableName, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import { writeAudit } from "@/lib/audit/write";
import { createDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { allocateReceiptNo } from "@/lib/identity/ids";
import { DEFAULT_APPROVAL_POLICY } from "@/lib/identity/roles";
import { RULE_VERSION_APPROVAL_KEY } from "@/lib/admin/settings";
import { businessClock, monthPeriodOf, yymm } from "@/lib/time";

/** The demo date used by the prototype ("Sam. 13 sept. 2026"). */
const AS_OF = { year: 2026, month: 9 };
const DEMO_PIN = "123456";

const communes = [
  // DECISION-PENDING: D24 — codes to confirm with the Mairie.
  ["KAM", "Kampemba"],
  ["LUB", "Lubumbashi"],
  ["KEN", "Kenya"],
  ["KAT", "Katuba"],
  ["KAL", "Kamalondo"],
  ["RUA", "Ruashi"],
  ["ANN", "Annexe"],
] as const;

const quartiers = [
  ["bel-air", "Bel-Air"],
  ["kigoma", "Kigoma"],
  ["kampemba-centre", "Kampemba-Centre"],
  ["bel-air-sud", "Bel-Air (sud)"],
  ["marche-kenya", "Marché Kenya"],
] as const;

const categoryRows = [
  ["menage", "Ménage"],
  ["commerce", "Commerce"],
  ["industrie", "Industrie"],
  ["etal_marche", "Étal de marché"],
  ["propriete", "Propriété"],
] as const;

type RuleSeed = {
  code: string;
  taxCode: string;
  labelFr: string;
  category: string;
  effectiveFrom: string;
  status: "approved" | "draft";
  calcKind: "fixed" | "percent_of_base";
  amountFc?: number;
  rateBp?: number;
  frequency: "monthly" | "annual";
  penaltyKind: "none" | "once_percent" | "monthly_percent";
  penaltyRateBp?: number;
};

// DECISION-PENDING: D2 — amounts, frequencies and penalties are placeholders from the prototype.
const ruleRows: RuleSeed[] = [
  {
    code: "assainissement_menage",
    taxCode: "assainissement",
    labelFr: "Taxe d’assainissement",
    category: "menage",
    effectiveFrom: "2026-06-01",
    status: "approved",
    calcKind: "fixed",
    amountFc: 5000,
    frequency: "monthly",
    penaltyKind: "once_percent",
    penaltyRateBp: 1000,
  },
  {
    code: "assainissement_commerce",
    taxCode: "assainissement",
    labelFr: "Taxe d’assainissement",
    category: "commerce",
    effectiveFrom: "2026-06-01",
    status: "approved",
    calcKind: "fixed",
    amountFc: 25000,
    frequency: "monthly",
    penaltyKind: "once_percent",
    penaltyRateBp: 1000,
  },
  {
    code: "assainissement_industrie",
    taxCode: "assainissement",
    labelFr: "Taxe d’assainissement",
    category: "industrie",
    effectiveFrom: "2026-06-01",
    status: "approved",
    calcKind: "fixed",
    amountFc: 150000,
    frequency: "monthly",
    penaltyKind: "once_percent",
    penaltyRateBp: 1000,
  },
  {
    code: "etalage",
    taxCode: "etalage",
    labelFr: "Taxe d’étalage",
    category: "etal_marche",
    effectiveFrom: "2026-06-01",
    status: "approved",
    calcKind: "fixed",
    amountFc: 15000,
    frequency: "monthly",
    penaltyKind: "none",
  },
  {
    code: "patente",
    taxCode: "patente",
    labelFr: "Patente",
    category: "commerce",
    effectiveFrom: "2026-01-01",
    status: "approved",
    calcKind: "fixed",
    amountFc: 50000,
    frequency: "annual",
    penaltyKind: "monthly_percent",
    penaltyRateBp: 500,
  },
  {
    code: "immobiliere",
    taxCode: "immobiliere",
    labelFr: "Taxe immobilière",
    category: "propriete",
    effectiveFrom: "2027-01-01",
    status: "draft",
    calcKind: "percent_of_base",
    rateBp: 50,
    frequency: "annual",
    penaltyKind: "none",
  },
];

const adminRows = [
  ["ngoy.k@lubumbashi.cd", "Ngoy K.", "finances"],
  ["ilunga.m@lubumbashi.cd", "Ilunga M.", "superviseur"],
  ["admin@lubumbashi.cd", "Administrateur", "administrateur"],
  ["maire@lubumbashi.cd", "Le Maire", "maire"],
  ["auditeur@lubumbashi.cd", "Auditeur", "auditeur"],
] as const;

const agentRows = [
  ["AG-KAM-007", "Kalenga Mbuyi", "bel-air"],
  ["AG-KAM-003", "Kasongo Ilunga", "marche-kenya"],
  ["AG-KAM-011", "Mwenze Tshite", "kigoma"],
  ["AG-KAM-014", "Ngoy Kabwe", "kampemba-centre"],
  ["AG-KAM-019", "Mutombo Banza", "bel-air-sud"],
] as const;

type TaxpayerSeed = {
  no: string;
  name: string;
  kind: "person" | "company";
  phone: string;
  quartier: string;
  address: string;
  registeredAt: string;
  entity: {
    name: string;
    kind: "property" | "business" | "activity";
    category: string;
    lng: number;
    lat: number;
  };
  overrides?: Array<{ rule: string; kind: "include" | "exclude"; reason: string }>;
};

const taxpayerRows: TaxpayerSeed[] = [
  {
    no: "LUB-KAM-00000125",
    name: "Mwamba Kasongo Jean",
    kind: "person",
    phone: "+243994128830",
    quartier: "bel-air",
    address: "Av. Kasaï 214",
    registeredAt: "2026-06-02T10:22:00+02:00",
    entity: {
      name: "Résidence Av. Kasaï 214",
      kind: "property",
      category: "menage",
      lng: 27.493,
      lat: -11.6642,
    },
  },
  {
    no: "LUB-KAM-00000126",
    name: "Ilunga Ngoy Patricia",
    kind: "person",
    phone: "+243817762019",
    quartier: "bel-air",
    address: "Marché Kenya, étal 41",
    registeredAt: "2026-07-02T11:05:00+02:00",
    entity: {
      name: "Boutique Ilunga — étal 41",
      kind: "activity",
      category: "commerce",
      lng: 27.4948,
      lat: -11.6651,
    },
    overrides: [
      { rule: "etalage", kind: "include", reason: "Étal de marché (recensement)" },
      { rule: "patente", kind: "exclude", reason: "Étal sans patente (recensement)" },
    ],
  },
  {
    no: "LUB-KAM-00000127",
    name: "Banza Mutombo Eric",
    kind: "person",
    phone: "+243972045561",
    quartier: "kigoma",
    address: "Av. Lumumba 87",
    registeredAt: "2026-09-03T09:40:00+02:00",
    entity: {
      name: "Résidence Av. Lumumba 87",
      kind: "property",
      category: "menage",
      lng: 27.4901,
      lat: -11.6688,
    },
  },
  {
    no: "LUB-KAM-00000128",
    name: "Kyungu Mwila Sarah",
    kind: "person",
    phone: "+243853309047",
    quartier: "kigoma",
    address: "Av. Lumumba 102",
    registeredAt: "2026-07-03T14:10:00+02:00",
    entity: {
      name: "Restaurant Chez Sarah",
      kind: "activity",
      category: "commerce",
      lng: 27.4912,
      lat: -11.669,
    },
  },
  {
    no: "LUB-KAM-00000129",
    name: "Tshibangu Kalala Moïse",
    kind: "person",
    phone: "+243990187742",
    quartier: "bel-air",
    address: "Av. Kasaï 220",
    registeredAt: "2026-09-04T08:50:00+02:00",
    entity: {
      name: "Résidence Av. Kasaï 220",
      kind: "property",
      category: "menage",
      lng: 27.4935,
      lat: -11.6644,
    },
  },
  {
    no: "LUB-KAM-00000131",
    name: "Kabeya Mutombo G.",
    kind: "person",
    phone: "+243995614410",
    quartier: "bel-air",
    address: "Av. Kasaï 226",
    registeredAt: "2026-09-12T15:30:00+02:00",
    entity: {
      name: "Résidence Av. Kasaï 226",
      kind: "property",
      category: "menage",
      lng: 27.4933,
      lat: -11.6645,
    },
  },
];

type PaymentSeed = {
  taxpayer: string;
  at: string;
  amountFc: number;
  channel: "mpesa" | "airtel" | "orange";
  origin: "agent" | "portal";
  agent?: string;
  outcome: "ok" | "fail";
  providerRef: string;
  failureReason?: string;
  allocations: Array<{ rule: string; periodStart: string; amountFc: number }>;
};

const paymentRows: PaymentSeed[] = [
  {
    taxpayer: "LUB-KAM-00000125",
    at: "2026-07-08T10:15:00+02:00",
    amountFc: 5000,
    channel: "airtel",
    origin: "agent",
    agent: "AG-KAM-007",
    outcome: "ok",
    providerRef: "AM260708K3Q9",
    allocations: [{ rule: "assainissement_menage", periodStart: "2026-06-01", amountFc: 5000 }],
  },
  {
    taxpayer: "LUB-KAM-00000126",
    at: "2026-08-01T09:05:00+02:00",
    amountFc: 40000,
    channel: "mpesa",
    origin: "portal",
    outcome: "ok",
    providerRef: "MP260801A7Q2",
    allocations: [
      { rule: "assainissement_commerce", periodStart: "2026-07-01", amountFc: 25000 },
      { rule: "etalage", periodStart: "2026-07-01", amountFc: 15000 },
    ],
  },
  {
    taxpayer: "LUB-KAM-00000125",
    at: "2026-08-05T18:20:00+02:00",
    amountFc: 5000,
    channel: "mpesa",
    origin: "portal",
    outcome: "ok",
    providerRef: "MP260805X9R4",
    allocations: [{ rule: "assainissement_menage", periodStart: "2026-07-01", amountFc: 5000 }],
  },
  {
    taxpayer: "LUB-KAM-00000128",
    at: "2026-08-12T13:55:00+02:00",
    amountFc: 25000,
    channel: "orange",
    origin: "portal",
    outcome: "fail",
    providerRef: "OM260812F001",
    failureReason: "Solde insuffisant",
    allocations: [],
  },
  {
    taxpayer: "LUB-KAM-00000128",
    at: "2026-08-12T14:02:00+02:00",
    amountFc: 25000,
    channel: "orange",
    origin: "portal",
    outcome: "ok",
    providerRef: "OM260812B5T7",
    allocations: [{ rule: "assainissement_commerce", periodStart: "2026-07-01", amountFc: 25000 }],
  },
  {
    taxpayer: "LUB-KAM-00000126",
    at: "2026-09-03T11:40:00+02:00",
    amountFc: 40000,
    channel: "airtel",
    origin: "portal",
    outcome: "ok",
    providerRef: "AM260903H2M8",
    allocations: [
      { rule: "assainissement_commerce", periodStart: "2026-08-01", amountFc: 25000 },
      { rule: "etalage", periodStart: "2026-08-01", amountFc: 15000 },
    ],
  },
  {
    taxpayer: "LUB-KAM-00000129",
    at: "2026-09-04T16:30:00+02:00",
    amountFc: 5000,
    channel: "mpesa",
    origin: "agent",
    agent: "AG-KAM-007",
    outcome: "ok",
    providerRef: "MP260904W1C3",
    allocations: [{ rule: "assainissement_menage", periodStart: "2026-09-01", amountFc: 5000 }],
  },
];

const complaintCategoryRows = [
  ["montant_incorrect", "Montant incorrect"],
  ["paye_non_reconnu", "Payé mais non reconnu"],
  ["agent_suspect", "Agent suspect"],
  ["adresse_erronee", "Adresse erronée"],
  ["dechets_non_collectes", "Les déchets ne sont pas collectés"],
  ["autre", "Autre"],
] as const;

const SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** TX-YYMM-DD-HHMM-XXXX in business time; the suffix is deterministic here so the seed is idempotent. */
function txReference(at: Date, key: string): string {
  const c = businessClock(at);
  const digest = createHash("sha256").update(key).digest();
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += SUFFIX_ALPHABET[digest[i]! % SUFFIX_ALPHABET.length];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `TX-${yymm(at)}-${pad(c.day)}-${pad(c.hour)}${pad(c.minute)}-${suffix}`;
}

export interface SeedSummary {
  zones: number;
  categories: number;
  rules: number;
  admins: number;
  agents: number;
  taxpayers: number;
  entities: number;
  obligations: number;
  payments: number;
  receipts: number;
  auditRows: number;
  created: string[];
}

/**
 * Creates the admin logins in Supabase Auth (local or hosted) with SEED_ADMIN_PASSWORD and links
 * `admin_users.auth_user_id`. Skipped with a warning when the secret key is not configured.
 */
async function seedAuthUsers(db: Db): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!url || !secret || !password) {
    console.warn(
      "seed: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or SEED_ADMIN_PASSWORD missing; admin logins not created",
    );
    return [];
  }
  const created: string[] = [];
  const auth = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: existing, error } = await auth.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`seed: cannot list auth users: ${error.message}`);
  const rows = await db
    .select({ id: s.admins.id, email: s.admins.email, authUserId: s.admins.authUserId })
    .from(s.admins);
  for (const row of rows) {
    let user = existing.users.find((u) => u.email?.toLowerCase() === row.email);
    if (!user) {
      const { data, error: createError } = await auth.auth.admin.createUser({
        email: row.email,
        password,
        email_confirm: true,
      });
      if (createError || !data.user)
        throw new Error(`seed: cannot create auth user ${row.email}: ${createError?.message}`);
      user = data.user;
      created.push(`auth user ${row.email}`);
    }
    if (row.authUserId !== user.id) {
      await db
        .update(s.admins)
        .set({ authUserId: user.id, updatedAt: new Date() })
        .where(eq(s.admins.id, row.id));
    }
  }
  return created;
}

export async function runSeed(db: Db): Promise<SeedSummary> {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error(
      "seed: refusing to run in production (invariant 1: seeded confirmations only exist through the mock provider)",
    );
  }
  const created: string[] = [];
  const pinHash = await hash(DEMO_PIN);

  await db.transaction(async (tx) => {
    // --- zones -------------------------------------------------------------------------------
    const communeId = new Map<string, string>();
    for (const [code, name] of communes) {
      const [row] = await tx
        .select({ id: s.zones.id })
        .from(s.zones)
        .where(and(eq(s.zones.level, "commune"), eq(s.zones.code, code)));
      if (row) communeId.set(code, row.id);
      else {
        const [ins] = await tx
          .insert(s.zones)
          .values({ level: "commune", code, name })
          .returning({ id: s.zones.id });
        communeId.set(code, ins!.id);
        created.push(`zone ${code}`);
      }
    }
    const kam = communeId.get("KAM")!;
    const quartierId = new Map<string, string>();
    for (const [code, name] of quartiers) {
      const [row] = await tx
        .select({ id: s.zones.id })
        .from(s.zones)
        .where(
          and(eq(s.zones.level, "quartier"), eq(s.zones.parentId, kam), eq(s.zones.code, code)),
        );
      if (row) quartierId.set(code, row.id);
      else {
        const [ins] = await tx
          .insert(s.zones)
          .values({ level: "quartier", code, name, parentId: kam })
          .returning({ id: s.zones.id });
        quartierId.set(code, ins!.id);
        created.push(`quartier ${code}`);
      }
    }
    await tx.execute(
      sql`insert into app.id_counters (commune_code, last) values ('KAM', 131) on conflict (commune_code) do update set last = greatest(app.id_counters.last, 131)`,
    );

    // --- categories, rules, versions ---------------------------------------------------------
    const categoryId = new Map<string, string>();
    for (const [i, [code, labelFr]] of categoryRows.entries()) {
      const [row] = await tx
        .select({ id: s.categories.id })
        .from(s.categories)
        .where(eq(s.categories.code, code));
      if (row) categoryId.set(code, row.id);
      else {
        const [ins] = await tx
          .insert(s.categories)
          .values({ code, labelFr, sortOrder: i })
          .returning({ id: s.categories.id });
        categoryId.set(code, ins!.id);
        created.push(`category ${code}`);
      }
    }
    const rule = new Map<
      string,
      {
        id: string;
        categoryId: string;
        versionId: string;
        amountFc: number;
        frequency: string;
        effectiveFrom: string;
        labelFr: string;
        taxCode: string;
      }
    >();
    for (const r of ruleRows) {
      let [row] = await tx
        .select({ id: s.taxRules.id })
        .from(s.taxRules)
        .where(eq(s.taxRules.code, r.code));
      if (!row) {
        [row] = await tx
          .insert(s.taxRules)
          .values({
            code: r.code,
            taxCode: r.taxCode,
            labelFr: r.labelFr,
            categoryId: categoryId.get(r.category)!,
            issuingAuthority: "Ville de Lubumbashi",
          })
          .returning({ id: s.taxRules.id });
        created.push(`rule ${r.code}`);
      }
      let [v] = await tx
        .select({ id: s.taxRuleVersions.id })
        .from(s.taxRuleVersions)
        .where(and(eq(s.taxRuleVersions.taxRuleId, row!.id), eq(s.taxRuleVersions.version, 1)));
      if (!v) {
        [v] = await tx
          .insert(s.taxRuleVersions)
          .values({
            taxRuleId: row!.id,
            version: 1,
            status: r.status,
            effectiveFrom: r.effectiveFrom,
            calcKind: r.calcKind,
            amountFc: r.amountFc ?? null,
            rateBp: r.rateBp ?? null,
            frequency: r.frequency,
            penaltyKind: r.penaltyKind,
            penaltyRateBp: r.penaltyRateBp ?? null,
            graceDays: 30,
            penaltyCapBp: 10000, // DECISION-PENDING: D22
            approvedAt:
              r.status === "approved" ? new Date(`${r.effectiveFrom}T00:00:00+02:00`) : null,
          })
          .returning({ id: s.taxRuleVersions.id });
      }
      rule.set(r.code, {
        id: row!.id,
        categoryId: categoryId.get(r.category)!,
        versionId: v!.id,
        amountFc: r.amountFc ?? 0,
        frequency: r.frequency,
        effectiveFrom: r.effectiveFrom,
        labelFr: r.labelFr,
        taxCode: r.taxCode,
      });
    }

    // --- admins, agents, devices -------------------------------------------------------------
    const adminId = new Map<string, string>();
    for (const [email, fullName, role] of adminRows) {
      const [row] = await tx
        .select({ id: s.admins.id })
        .from(s.admins)
        .where(eq(s.admins.email, email));
      if (row) adminId.set(role, row.id);
      else {
        const [ins] = await tx
          .insert(s.admins)
          .values({ email, fullName, role })
          .returning({ id: s.admins.id });
        adminId.set(role, ins!.id);
        created.push(`admin ${email}`);
      }
    }
    const agentId = new Map<string, string>();
    for (const [matricule, fullName, zone] of agentRows) {
      const [row] = await tx
        .select({ id: s.agents.id })
        .from(s.agents)
        .where(eq(s.agents.matricule, matricule));
      if (row) agentId.set(matricule, row.id);
      else {
        const [ins] = await tx
          .insert(s.agents)
          .values({ matricule, fullName, pinHash, zoneId: quartierId.get(zone)!, communeId: kam })
          .returning({ id: s.agents.id });
        agentId.set(matricule, ins!.id);
        created.push(`agent ${matricule}`);
      }
    }
    const deviceId = new Map<string, string>();
    for (const d of [
      { code: "DEV-3F9A", agent: "AG-KAM-007", label: "Samsung A15", status: "active" as const },
      { code: "DEV-9C21", agent: "AG-KAM-011", label: "Tecno Spark", status: "revoked" as const },
    ]) {
      const [row] = await tx
        .select({ id: s.devices.id })
        .from(s.devices)
        .where(eq(s.devices.deviceCode, d.code));
      if (row) deviceId.set(d.code, row.id);
      else {
        const revoked = d.status === "revoked";
        const [ins] = await tx
          .insert(s.devices)
          .values({
            deviceCode: d.code,
            agentId: agentId.get(d.agent)!,
            label: d.label,
            status: d.status,
            registeredAt: new Date("2026-06-01T08:00:00+02:00"),
            revokedAt: revoked ? new Date("2026-09-04T15:10:55+02:00") : null,
            revokedReason: revoked ? "Perte déclarée" : null,
            revokedByAdminId: revoked ? adminId.get("administrateur") : null,
          })
          .returning({ id: s.devices.id });
        deviceId.set(d.code, ins!.id);
        created.push(`device ${d.code}`);
        if (revoked) {
          await writeAudit(tx, {
            actor: {
              type: "admin",
              id: adminId.get("administrateur")!,
              role: "administrateur",
              label: "Admin",
            },
            action: "device.revoked",
            object: { type: "device", id: d.code },
            details: { agent: d.agent, reason: "Perte déclarée" },
            where: { ip: "41.243.0.10" },
            device: { userAgent: "Chrome / Windows" },
          });
        }
      }
    }
    const ag007 = agentId.get("AG-KAM-007")!;
    const dev3f9a = deviceId.get("DEV-3F9A")!;

    // --- taxpayers, entities, overrides, obligations -----------------------------------------
    const taxpayerId = new Map<string, string>();
    const entityId = new Map<string, string>();
    for (const t of taxpayerRows) {
      const registeredAt = new Date(t.registeredAt);
      let [row] = await tx
        .select({ id: s.taxpayers.id })
        .from(s.taxpayers)
        .where(eq(s.taxpayers.taxpayerNo, t.no));
      const isNew = !row;
      if (!row) {
        [row] = await tx
          .insert(s.taxpayers)
          .values({
            taxpayerNo: t.no,
            kind: t.kind,
            fullName: t.name,
            phone: t.phone,
            communeId: kam,
            quartierId: quartierId.get(t.quartier)!,
            address: t.address,
            registeredAt,
            registeredByAgentId: ag007,
            registeredDeviceId: dev3f9a,
          })
          .returning({ id: s.taxpayers.id });
        created.push(`taxpayer ${t.no}`);
      }
      taxpayerId.set(t.no, row!.id);
      let [ent] = await tx
        .select({ id: s.entities.id })
        .from(s.entities)
        .where(and(eq(s.entities.taxpayerId, row!.id), eq(s.entities.name, t.entity.name)));
      if (!ent) {
        [ent] = await tx
          .insert(s.entities)
          .values({
            taxpayerId: row!.id,
            kind: t.entity.kind,
            categoryId: categoryId.get(t.entity.category)!,
            name: t.entity.name,
            address: t.address,
            communeId: kam,
            quartierId: quartierId.get(t.quartier)!,
            location: { x: t.entity.lng, y: t.entity.lat },
            gpsAccuracyM: 6,
            registeredAt,
            registeredByAgentId: ag007,
          })
          .returning({ id: s.entities.id });
      }
      entityId.set(t.no, ent!.id);
      for (const o of t.overrides ?? []) {
        await tx
          .insert(s.entityRuleOverrides)
          .values({
            entityId: ent!.id,
            taxRuleId: rule.get(o.rule)!.id,
            kind: o.kind,
            reason: o.reason,
            createdByAdminId: adminId.get("superviseur"),
          })
          .onConflictDoNothing();
      }
      if (isNew) {
        await writeAudit(tx, {
          actor: { type: "agent", id: ag007, role: "agent", label: "AG-KAM-007" },
          action: "taxpayer.registered",
          object: { type: "taxpayer", id: t.no },
          details: { entity: t.entity.name, category: t.entity.category, gpsAccuracyM: 6 },
          where: { gps: { lng: t.entity.lng, lat: t.entity.lat } },
          device: { id: dev3f9a },
        });
      }
      // Obligations: category rules ± overrides, from the registration period to AS_OF (M2 replaces this).
      const applicable = new Set(
        [...rule.entries()]
          .filter(([, r]) => r.categoryId === categoryId.get(t.entity.category))
          .map(([code]) => code),
      );
      for (const o of t.overrides ?? []) {
        if (o.kind === "include") applicable.add(o.rule);
        else applicable.delete(o.rule);
      }
      const reg = businessClock(registeredAt);
      for (const code of applicable) {
        const r = rule.get(code)!;
        const periods: Array<{ start: string; end: string; due: string }> = [];
        if (r.frequency === "monthly") {
          for (
            let y = reg.year, m = reg.month;
            y < AS_OF.year || (y === AS_OF.year && m <= AS_OF.month);
            m === 12 ? ((y += 1), (m = 1)) : (m += 1)
          ) {
            const p = monthPeriodOf(y, m);
            if (p.start >= r.effectiveFrom)
              periods.push({ start: p.start, end: p.end, due: p.dueDate });
          }
        } else {
          const p = {
            start: `${reg.year}-01-01`,
            end: `${reg.year}-12-31`,
            due: `${reg.year}-12-31`,
          };
          if (p.start >= r.effectiveFrom) periods.push(p);
        }
        for (const p of periods) {
          await tx
            .insert(s.obligations)
            .values({
              entityId: ent!.id,
              taxpayerId: row!.id,
              taxRuleId: r.id,
              taxRuleVersionId: r.versionId,
              periodStart: p.start,
              periodEnd: p.end,
              dueDate: p.due,
              amountFc: r.amountFc,
            })
            .onConflictDoNothing();
        }
      }
    }

    // --- payments, confirmations, allocations, receipts (chronological, gapless numbering) ---
    for (const p of [...paymentRows].sort((a, b) => a.at.localeCompare(b.at))) {
      const at = new Date(p.at);
      const reference = txReference(at, p.providerRef);
      const [existing] = await tx
        .select({ id: s.payments.id })
        .from(s.payments)
        .where(eq(s.payments.reference, reference));
      if (existing) continue;
      const tpId = taxpayerId.get(p.taxpayer)!;
      const seedTp = taxpayerRows.find((t) => t.no === p.taxpayer)!;
      const ok = p.outcome === "ok";
      const agent = p.agent ? agentId.get(p.agent)! : null;
      const [pay] = await tx
        .insert(s.payments)
        .values({
          reference,
          taxpayerId: tpId,
          entityId: entityId.get(p.taxpayer)!,
          amountFc: p.amountFc,
          channel: p.channel,
          origin: p.origin,
          payerPhone: seedTp.phone,
          status: ok ? "confirmed" : "failed",
          initiatedByAgentId: agent,
          initiatedDeviceId: agent ? dev3f9a : null,
          createdAt: at,
          pendingAt: at,
          confirmedAt: ok ? new Date(at.getTime() + 45_000) : null,
          failedAt: ok ? null : new Date(at.getTime() + 30_000),
          failureReason: ok ? null : (p.failureReason ?? null),
        })
        .returning({ id: s.payments.id });
      created.push(`payment ${reference}`);
      await writeAudit(tx, {
        actor: agent
          ? { type: "agent", id: agent, role: "agent", label: p.agent! }
          : { type: "taxpayer", id: tpId, label: p.taxpayer },
        action: "payment.initiated",
        object: { type: "payment", id: reference },
        details: { amountFc: p.amountFc, channel: p.channel, origin: p.origin },
        where: agent
          ? { gps: { lng: seedTp.entity.lng, lat: seedTp.entity.lat } }
          : { ip: "41.243.12.34" },
        device: agent ? { id: dev3f9a } : { userAgent: "Chrome / Android" },
      });
      if (!ok) {
        await writeAudit(tx, {
          actor: { type: "system" },
          action: "payment.failed",
          object: { type: "payment", id: reference },
          details: { reason: p.failureReason, provider: p.channel },
        });
        continue;
      }
      // Invariant 1: the confirmation row (provider `mock`, marked seeded) is written in the same transaction.
      await tx.insert(s.providerConfirmations).values({
        paymentId: pay!.id,
        provider: "mock",
        providerReference: p.providerRef,
        amountFc: p.amountFc,
        payerPhone: seedTp.phone,
        rawPayload: {
          seeded: true,
          channel: p.channel,
          reference,
          providerReference: p.providerRef,
        },
        receivedAt: new Date(at.getTime() + 45_000),
        createdAt: new Date(at.getTime() + 45_000),
      });
      const snapshotAllocations: Array<{
        taxCode: string;
        labelFr: string;
        periodStart: string;
        periodEnd: string;
        amountFc: number;
      }> = [];
      for (const a of p.allocations) {
        const r = rule.get(a.rule)!;
        const [ob] = await tx
          .select({
            id: s.obligations.id,
            amountFc: s.obligations.amountFc,
            penaltyFc: s.obligations.penaltyFc,
            paidFc: s.obligations.paidFc,
            periodEnd: s.obligations.periodEnd,
          })
          .from(s.obligations)
          .where(
            and(
              eq(s.obligations.entityId, entityId.get(p.taxpayer)!),
              eq(s.obligations.taxRuleId, r.id),
              eq(s.obligations.periodStart, a.periodStart),
            ),
          );
        if (!ob)
          throw new Error(`seed: no obligation ${a.rule} ${a.periodStart} for ${p.taxpayer}`);
        await tx.insert(s.paymentAllocations).values({
          paymentId: pay!.id,
          obligationId: ob.id,
          kind: "principal",
          amountFc: a.amountFc,
        });
        const paidFc = ob.paidFc + a.amountFc;
        await tx
          .update(s.obligations)
          .set({
            paidFc,
            status: paidFc >= ob.amountFc + ob.penaltyFc ? "paid" : "partially_paid",
            updatedAt: new Date(),
          })
          .where(eq(s.obligations.id, ob.id));
        snapshotAllocations.push({
          taxCode: r.taxCode,
          labelFr: r.labelFr,
          periodStart: a.periodStart,
          periodEnd: ob.periodEnd,
          amountFc: a.amountFc,
        });
      }
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "payment.confirmed",
        object: { type: "payment", id: reference },
        details: { provider: "mock", providerReference: p.providerRef, amountFc: p.amountFc },
      });
      const receiptNo = await allocateReceiptNo(tx, at);
      await tx.insert(s.receipts).values({
        receiptNo,
        paymentId: pay!.id,
        taxpayerId: tpId,
        amountFc: p.amountFc,
        verifyToken: randomBytes(16).toString("hex"),
        issuedAt: new Date(at.getTime() + 46_000),
        createdAt: new Date(at.getTime() + 46_000),
        snapshot: {
          receiptNo,
          taxpayerNo: p.taxpayer,
          taxpayerName: seedTp.name,
          amountFc: p.amountFc,
          channel: p.channel,
          providerReference: p.providerRef,
          issuedAt: new Date(at.getTime() + 46_000).toISOString(),
          agent: p.agent ?? null,
          allocations: snapshotAllocations,
        },
      });
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "receipt.issued",
        object: { type: "receipt", id: receiptNo },
        details: { payment: reference, amountFc: p.amountFc },
      });
      created.push(`receipt ${receiptNo}`);
    }

    // --- route, complaint categories, one resolved complaint --------------------------------
    let [route] = await tx
      .select({ id: s.agentRoutes.id })
      .from(s.agentRoutes)
      .where(
        and(
          eq(s.agentRoutes.name, "Av. Kasaï"),
          eq(s.agentRoutes.zoneId, quartierId.get("bel-air")!),
        ),
      );
    if (!route) {
      [route] = await tx
        .insert(s.agentRoutes)
        .values({
          name: "Av. Kasaï",
          zoneId: quartierId.get("bel-air")!,
          createdByAdminId: adminId.get("superviseur"),
        })
        .returning({ id: s.agentRoutes.id });
      created.push("route Av. Kasaï");
    }
    for (const [i, no] of [
      "LUB-KAM-00000125",
      "LUB-KAM-00000126",
      "LUB-KAM-00000129",
      "LUB-KAM-00000131",
    ].entries()) {
      await tx
        .insert(s.routeEntities)
        .values({ routeId: route!.id, entityId: entityId.get(no)!, position: i + 1 })
        .onConflictDoNothing();
    }
    await tx
      .insert(s.routeAssignments)
      .values({
        routeId: route!.id,
        agentId: ag007,
        assignedOn: "2026-09-13",
        assignedByAdminId: adminId.get("superviseur"),
      })
      .onConflictDoNothing();
    const complaintCatId = new Map<string, string>();
    for (const [i, [code, labelFr]] of complaintCategoryRows.entries()) {
      const [row] = await tx
        .select({ id: s.complaintCategories.id })
        .from(s.complaintCategories)
        .where(eq(s.complaintCategories.code, code));
      if (row) complaintCatId.set(code, row.id);
      else {
        const [ins] = await tx
          .insert(s.complaintCategories)
          .values({ code, labelFr, sortOrder: i })
          .returning({ id: s.complaintCategories.id });
        complaintCatId.set(code, ins!.id);
      }
    }
    const [complaint] = await tx
      .select({ id: s.complaints.id })
      .from(s.complaints)
      .where(
        and(
          eq(s.complaints.taxpayerId, taxpayerId.get("LUB-KAM-00000125")!),
          eq(s.complaints.categoryId, complaintCatId.get("adresse_erronee")!),
        ),
      );
    if (!complaint) {
      await tx.insert(s.complaints).values({
        taxpayerId: taxpayerId.get("LUB-KAM-00000125")!,
        categoryId: complaintCatId.get("adresse_erronee")!,
        description: "Le numéro de l’avenue est 214, pas 241.",
        contactPhone: "+243994128830",
        status: "resolved",
        resolution: "Adresse corrigée.",
        handledByAdminId: adminId.get("superviseur"),
        resolvedAt: new Date("2026-09-05T10:00:00+02:00"),
        createdAt: new Date("2026-09-02T17:12:00+02:00"),
      });
      created.push("complaint LUB-KAM-00000125");
    }

    // --- settings: who may approve a tax rule version (D29 placeholder) --------------------
    await tx
      .insert(s.settings)
      .values({ key: RULE_VERSION_APPROVAL_KEY, value: DEFAULT_APPROVAL_POLICY })
      .onConflictDoNothing();
  });

  // --- Supabase Auth users for the admins (identity only; roles live in admin_users) ------
  created.push(...(await seedAuthUsers(db)));

  const count = async (table: Parameters<typeof getTableName>[0]) => {
    const r = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from app.${sql.identifier(getTableName(table))}`,
    );
    return Number(r.rows[0]?.n ?? 0);
  };
  return {
    zones: await count(s.zones),
    categories: await count(s.categories),
    rules: await count(s.taxRules),
    admins: await count(s.admins),
    agents: await count(s.agents),
    taxpayers: await count(s.taxpayers),
    entities: await count(s.entities),
    obligations: await count(s.obligations),
    payments: await count(s.payments),
    receipts: await count(s.receipts),
    auditRows: await count(s.auditLog),
    created,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("seed: DATABASE_URL is not set; see .env.example");
    process.exit(1);
  }
  const db = createDb(url);
  runSeed(db)
    .then(({ created, ...counts }) => {
      console.log(`seed: ${created.length} new rows this run`);
      console.table(counts);
    })
    .catch((err) => {
      console.error(String(err));
      process.exitCode = 1;
    })
    .finally(() => db.$client.end());
}
