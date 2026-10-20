import type {
  AssistantImages,
  ImagesContext,
  ImageModel,
  Provider,
  ProviderImagesOptions,
} from "@earendil-works/pi-ai";
import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";

export type SeedreamImagesApi = "seedream-images";

export interface SeedreamImagesModelRecord {
  id: string;
  name: string;
  type: "image";
  provider: "seedream";
  api: SeedreamImagesApi;
  baseUrl: string;
  input: ("text" | "image")[];
  output: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const ARK_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export const SEEDREAM_IMAGE_MODELS: Record<string, SeedreamImagesModelRecord> = {
  "doubao-seedream-5-0-pro-260628": {
    id: "doubao-seedream-5-0-pro-260628",
    name: "Seedream 5.0 Pro",
    type: "image",
    provider: "seedream",
    api: "seedream-images",
    baseUrl: ARK_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "doubao-seedream-5-0-flash-260915": {
    id: "doubao-seedream-5-0-flash-260915",
    name: "Seedream 5.0 Flash",
    type: "image",
    provider: "seedream",
    api: "seedream-images",
    baseUrl: ARK_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "doubao-seedream-5-0-260128": {
    id: "doubao-seedream-5-0-260128",
    name: "Seedream 5.0 Lite",
    type: "image",
    provider: "seedream",
    api: "seedream-images",
    baseUrl: ARK_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "doubao-seedream-4-5-251128": {
    id: "doubao-seedream-4-5-251128",
    name: "Seedream 4.5",
    type: "image",
    provider: "seedream",
    api: "seedream-images",
    baseUrl: ARK_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "doubao-seedream-4-0-250828": {
    id: "doubao-seedream-4-0-250828",
    name: "Seedream 4.0",
    type: "image",
    provider: "seedream",
    api: "seedream-images",
    baseUrl: ARK_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

export function resolveSeedreamImageModel(modelId: string): ImageModel<SeedreamImagesApi> {
  const record = SEEDREAM_IMAGE_MODELS[modelId];
  if (!record) {
    throw new Error(`Unknown Seedream image model: ${modelId}`);
  }
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    api: record.api,
    provider: record.provider,
    baseUrl: record.baseUrl,
    input: record.input,
    output: record.output,
    cost: record.cost,
  };
}

type SeedreamImagesOptions = ProviderImagesOptions & {
  size?: string;
  quality?: string;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const MIME_BY_OUTPUT_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
};

function inferMimeTypeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "image/jpeg";
  } catch {
    return "image/jpeg";
  }
}

export async function generateImagesSeedream(
  model: ImageModel<SeedreamImagesApi>,
  context: ImagesContext,
  options?: SeedreamImagesOptions,
): Promise<AssistantImages> {
  const apiKey = options?.apiKey;
  const signal = options?.signal;
  const size = options?.size;
  const base: AssistantImages = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "stop",
    timestamp: Date.now(),
  };

  if (signal?.aborted) {
    return { ...base, stopReason: "aborted", errorMessage: "aborted" };
  }
  if (!apiKey) {
    return { ...base, stopReason: "error", errorMessage: "No Seedream api key provided" };
  }

  const promptText = context.input
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const endpoint = `${model.baseUrl}/images/generations`;
  const body: Record<string, unknown> = {
    model: model.id,
    prompt: promptText,
    response_format: "b64_json",
  };
  if (size) body.size = size;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.error?.message ?? `Seedream API error: ${res.status}`;
      return { ...base, stopReason: "error", errorMessage: msg };
    }

    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) {
      return { ...base, stopReason: "error", errorMessage: "Seedream API returned no image data" };
    }

    for (const item of items) {
      if (item?.error?.message) {
        return { ...base, stopReason: "error", errorMessage: item.error.message };
      }
      const mimeType =
        (typeof item.output_format === "string" && MIME_BY_OUTPUT_FORMAT[item.output_format]) ||
        "image/jpeg";
      if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
        base.output.push({
          type: "image",
          data: item.b64_json,
          mimeType,
        });
      } else if (typeof item.url === "string" && item.url.length > 0) {
        const imgRes = await fetch(item.url, ...(signal ? [{ signal }] : []));
        if (!imgRes.ok) {
          return { ...base, stopReason: "error", errorMessage: `Failed to fetch image: ${imgRes.status}` };
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const urlMime = imgRes.headers.get("content-type") ?? inferMimeTypeFromUrl(item.url);
        base.output.push({ type: "image", data: buf.toString("base64"), mimeType: urlMime });
      }
    }

    if (base.output.length === 0) {
      return { ...base, stopReason: "error", errorMessage: "Seedream API returned no usable image" };
    }

    return base;
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return { ...base, stopReason: "aborted", errorMessage: "aborted" };
    }
    return { ...base, stopReason: "error", errorMessage: err?.message ?? String(err) };
  }
}

export function createSeedreamImagesProvider(): Provider {
  return createProvider({
    id: "seedream",
    name: "Seedream",
    auth: { apiKey: envApiKeyAuth("Seedream API key", ["SPHERSE_IMAGE_API_KEY"]) },
    models: Object.values(SEEDREAM_IMAGE_MODELS).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      provider: m.provider,
      api: m.api,
      baseUrl: m.baseUrl,
      input: m.input,
      output: m.output,
      cost: m.cost,
    })),
    images: { "seedream-images": { generateImages: generateImagesSeedream } },
  });
}
