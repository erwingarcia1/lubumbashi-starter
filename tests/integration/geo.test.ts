import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { categories, entities, taxpayers, zones } from "@/lib/db/schema";

import { appDb, rolledBack } from "./db";

describe("PostGIS: entity locations and the 30 m duplicate rule", () => {
  it("finds a neighbour within 30 m and not one 40 m away (rolled back)", async () => {
    await rolledBack(appDb(), async (tx) => {
      const [commune] = await tx
        .insert(zones)
        .values({ level: "commune", code: "TSG", name: "Test" })
        .returning({ id: zones.id });
      const [cat] = await tx
        .insert(categories)
        .values({ code: "test_geo", labelFr: "Test" })
        .returning({ id: categories.id });
      const [tp] = await tx
        .insert(taxpayers)
        .values({
          taxpayerNo: "LUB-TSG-00000001",
          kind: "person",
          fullName: "Test Géo",
          phone: "+243990000000",
          communeId: commune!.id,
          address: "Av. Test 1",
          registeredAt: new Date(),
        })
        .returning({ id: taxpayers.id });
      const base = { lng: 27.493, lat: -11.6642 };
      const mk = (name: string, dLat: number) => ({
        taxpayerId: tp!.id,
        kind: "property" as const,
        categoryId: cat!.id,
        name,
        address: name,
        communeId: commune!.id,
        location: { x: base.lng, y: base.lat + dLat },
        registeredAt: new Date(),
      });
      // 1 degree of latitude ≈ 111 320 m
      await tx
        .insert(entities)
        .values([mk("origin", 0), mk("near-25m", 25 / 111_320), mk("far-40m", 40 / 111_320)]);
      const near = await tx.execute<{ name: string }>(sql`
        select name from app.entities
        where taxpayer_id = ${tp!.id} and extensions.ST_DWithin(extensions.ST_SetSRID(location, 4326)::extensions.geography, extensions.ST_SetSRID(extensions.ST_MakePoint(${base.lng}, ${base.lat}), 4326)::extensions.geography, 30)
        order by name
      `);
      expect(near.rows.map((r) => r.name)).toEqual(["near-25m", "origin"]);
      const idx = await tx.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where schemaname = 'app' and tablename = 'entities' and indexname = 'entities_location_gist'`,
      );
      expect(idx.rows[0]?.indexdef).toContain("gist");
    });
  });
});
