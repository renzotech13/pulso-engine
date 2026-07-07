/**
 * Isolation suite: logs in as the two seeded demo owners and verifies that
 * tenant A can never read or write tenant B's rows, in any table, through
 * the exact same anon-key + JWT path the real dashboard uses. Also verifies
 * agent_runs/decision_log reject UPDATE/DELETE even for an owner.
 *
 * Requires the local stack running: `supabase start` + `pnpm db:seed`.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "@pulso/shared/config";
import { createServiceRoleClient } from "../src/worker.js";
import { createUserClient, type SupabaseServerClient } from "../src/server.js";
import { SEED_USERS } from "../src/seed.js";

let clientA: SupabaseServerClient;
let clientB: SupabaseServerClient;
let tenantAId: string;
let tenantBId: string;

async function signIn(email: string, password: string) {
  const config = loadConfig();
  const anonClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`seed login failed for ${email} — did you run \`pnpm db:seed\`? ${error?.message}`);
  }
  return { client: createUserClient(data.session.access_token), userId: data.user!.id };
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    signIn(SEED_USERS.tenantA.email, SEED_USERS.tenantA.password),
    signIn(SEED_USERS.tenantB.email, SEED_USERS.tenantB.password),
  ]);
  clientA = a.client;
  clientB = b.client;

  const service = createServiceRoleClient();
  const { data: tenantA } = await service.from("tenants").select("id").eq("slug", "spa-demo-a").single();
  const { data: tenantB } = await service.from("tenants").select("id").eq("slug", "spa-demo-b").single();
  tenantAId = tenantA!.id;
  tenantBId = tenantB!.id;
});

describe("tenant isolation", () => {
  it("A only sees its own tenant row, never B's", async () => {
    const { data } = await clientA.from("tenants").select("id");
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(tenantAId);
    expect(ids).not.toContain(tenantBId);
  });

  it("A cannot read B's memberships", async () => {
    const { data } = await clientA.from("memberships").select("*").eq("tenant_id", tenantBId);
    expect(data).toEqual([]);
  });

  it("A cannot read B's agent_runs even by correlation_id guess", async () => {
    const service = createServiceRoleClient();
    const correlationId = randomUUID();
    await service.from("agent_runs").insert({
      tenant_id: tenantBId,
      agent: "hello",
      trigger: "test",
      status: "succeeded",
      correlation_id: correlationId,
    });

    const { data } = await clientA.from("agent_runs").select("*").eq("correlation_id", correlationId);
    expect(data).toEqual([]);
  });

  it("A cannot update B's tenant row", async () => {
    const { error, data } = await clientA
      .from("tenants")
      .update({ name: "hijacked" })
      .eq("id", tenantBId)
      .select();
    expect(data ?? []).toEqual([]);
    void error;
  });

  it("A cannot insert a membership for itself as owner of B's tenant", async () => {
    const { error } = await clientA.from("memberships").insert({
      tenant_id: tenantBId,
      user_id: (await clientA.auth.getUser()).data.user!.id,
      role: "owner",
    });
    expect(error).not.toBeNull();
  });

  it("isolation holds symmetrically: B only sees its own tenant row, never A's", async () => {
    const { data } = await clientB.from("tenants").select("id");
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(tenantBId);
    expect(ids).not.toContain(tenantAId);
  });
});

describe("append-only audit tables", () => {
  it("rejects UPDATE on agent_runs even from the service role", async () => {
    const service = createServiceRoleClient();
    const correlationId = randomUUID();
    await service.from("agent_runs").insert({
      tenant_id: tenantAId,
      agent: "hello",
      trigger: "test",
      status: "running",
      correlation_id: correlationId,
    });

    const { error } = await service
      .from("agent_runs")
      // @ts-expect-error -- Update is `never`: this table is append-only by design.
      .update({ status: "succeeded" })
      .eq("correlation_id", correlationId);
    expect(error).not.toBeNull();
  });

  it("rejects DELETE on decision_log even from the service role", async () => {
    const service = createServiceRoleClient();
    const correlationId = randomUUID();
    await service.from("decision_log").insert({
      tenant_id: tenantAId,
      agent: "hello",
      correlation_id: correlationId,
    });

    const { error } = await service.from("decision_log").delete().eq("correlation_id", correlationId);
    expect(error).not.toBeNull();
  });
});
