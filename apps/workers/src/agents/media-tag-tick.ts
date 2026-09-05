import {
  createServiceRoleClient,
  createTenantScopedClient,
  listUntaggedMediaAssets,
  updateMediaAssetTags,
} from "@pulso/db/worker";
import { loadConfig } from "@pulso/shared/config";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";
import { describeBankPhoto } from "@pulso/shared/image-describe";

const logger = createLogger({ agent: "media-tag-tick" });

/** Keeps one tick's worth of vision calls bounded; the tick runs often anyway. */
const BATCH_LIMIT = 5;
/** The vision endpoint shares the per-minute budget with everything else Gemini. */
const CALL_SPACING_MS = 2000;
/** After this many failed attempts a photo is left untagged for a human to tag by hand. */
const MAX_TAG_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Describes bank photos that don't have tags yet — once per photo, cached on
 * the row — so the Creative agent can pick a photo by theme instead of by
 * "longest unused" (see rankBankPhotos in creative-helpers.ts). Runs for
 * every tenant; a photo that fails non-retryably (bad file, refused) burns
 * all its attempts at once so the tick stops paying for it.
 *
 * Returns how many photos were attempted, so a CLI can loop until the bank
 * is fully tagged instead of waiting ~10 minutes per batch.
 */
export async function runMediaTagTick(): Promise<number> {
  const config = loadConfig();
  if (!config.GEMINI_API_KEY) return 0;

  const service = createServiceRoleClient();
  let assets;
  try {
    assets = await listUntaggedMediaAssets(service, BATCH_LIMIT);
  } catch (err) {
    // Migration 27 not applied yet (no tagged_at column): nothing to do
    // until it is, and no point failing the job every ten minutes.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "media tagging unavailable");
    return 0;
  }
  if (assets.length === 0) return 0;

  const tenantIds = [...new Set(assets.map((asset) => asset.tenant_id))];
  const { data: tenants } = await service.from("tenants").select("id, rubro").in("id", tenantIds);
  const rubroByTenant = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.rubro ?? "general"]));

  let tagged = 0;
  for (const [index, asset] of assets.entries()) {
    if (index > 0) await sleep(CALL_SPACING_MS);

    const result = await describeBankPhoto({
      imageUrl: asset.url,
      rubro: rubroByTenant.get(asset.tenant_id) ?? "general",
    });

    await createTenantScopedClient(asset.tenant_id, service).insertAgentCall({
      agent_id: null,
      agent_name: "gemini-vision",
      job_id: null,
      correlation_id: newCorrelationId(),
      status: result.ok ? "success" : "error",
      latency_ms: result.latencyMs,
      ...(result.ok ? {} : { error_message: result.error }),
    });

    if (result.ok) {
      await updateMediaAssetTags(service, asset.id, {
        description: result.value.description,
        tags: result.value.tags,
        has_people: result.value.hasPeople,
        orientation: result.value.orientation,
        tag_source: "gemini",
        tagged_at: new Date().toISOString(),
        tag_error: null,
      });
      tagged++;
    } else {
      await updateMediaAssetTags(service, asset.id, {
        tag_attempts: result.retryable ? asset.tag_attempts + 1 : MAX_TAG_ATTEMPTS,
        tag_error: result.error,
      });
      logger.warn(
        { assetId: asset.id, tenantId: asset.tenant_id, error: result.error, retryable: result.retryable },
        "bank photo tagging failed",
      );
    }
  }

  logger.info({ attempted: assets.length, tagged }, "media tag tick complete");
  return assets.length;
}
