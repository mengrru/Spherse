import { Type } from "@sinclair/typebox";
import { parseContract, schemas } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "@spherse/rpc/host";

const OSS_BUCKET_BASE_URL =
  "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse";

const MARKETPLACE_MANIFEST_URL = `${OSS_BUCKET_BASE_URL}/skills/manifest.json`;
const MANIFEST_CACHE_TTL_MS = 30_000;
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;

let manifestCache: { manifest: unknown; expiresAt: number } | null = null;
let manifestInFlight: Promise<unknown> | null = null;

async function fetchManifest(): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(MARKETPLACE_MANIFEST_URL, {
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (err) {
    throw new RpcAppError(
      502,
      `Marketplace manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new RpcAppError(502, `Marketplace manifest fetch failed: HTTP ${res.status}`);
  }
  const manifestLength = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(manifestLength) && manifestLength > MAX_MANIFEST_BYTES) {
    throw new RpcAppError(502, `Marketplace manifest exceeds size limit (${manifestLength} bytes)`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new RpcAppError(
      502,
      `Marketplace manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const manifest = parseContract(schemas.marketplaceManifestResponse, data);
    manifestCache = { manifest, expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS };
    return manifest;
  } catch (err) {
    throw new RpcAppError(
      502,
      `Marketplace manifest is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function getManifest(): Promise<unknown> {
  if (manifestCache && manifestCache.expiresAt > Date.now()) {
    return Promise.resolve(manifestCache.manifest);
  }
  if (manifestInFlight) return manifestInFlight;
  manifestInFlight = fetchManifest().finally(() => {
    manifestInFlight = null;
  });
  return manifestInFlight;
}

const create = defineRpcMethod(
  Type.Object(
    {
      projectId: Type.String(),
      name: Type.String(),
      description: Type.String(),
      instructions: Type.String(),
    },
    { additionalProperties: false },
  ),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const skill = await projectManager.createSkill(
      params.name,
      params.description,
      params.instructions,
    );
    return parseContract(schemas.skillDefinition, skill);
  },
);

const list = defineRpcMethod(
  Type.Object({ projectId: Type.String() }, { additionalProperties: false }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const skills = await projectManager.listSkills();
    return parseContract(
      schemas.skillListResponse,
      skills.map(({ instructions: _instructions, ...summary }) => summary),
    );
  },
);

const listMarketplace = defineRpcMethod(
  Type.Object({ projectId: Type.String() }),
  async () => {
    return parseContract(schemas.marketplaceManifestResponse, await getManifest());
  },
);

export const skillMethods: Record<string, RpcMethodEntry> = {
  "skills.create": create,
  "skills.list": list,
  "skills.listMarketplace": listMarketplace,
};
