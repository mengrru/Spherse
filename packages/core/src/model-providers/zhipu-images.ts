import type {
  AssistantImages,
  ImagesApiProvider,
  ImagesContext,
  ImagesModel,
  ImagesOptions,
  ProviderImagesOptions,
} from "@earendil-works/pi-ai";
import { registerImagesApiProvider } from "@earendil-works/pi-ai";

export type ZhipuImagesApi = "zhipu-images";

export interface ZhipuImagesModelRecord {
  id: string;
  name: string;
  provider: "zhipu";
  api: ZhipuImagesApi;
  baseUrl: string;
  input: ("text" | "image")[];
  output: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export const ZHIPU_IMAGE_MODELS: Record<string, ZhipuImagesModelRecord> = {
  "glm-image": {
    id: "glm-image",
    name: "GLM Image",
    provider: "zhipu",
    api: "zhipu-images",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

export function resolveZhipuImageModel(modelId: string): ImagesModel<ZhipuImagesApi> {
  const record = ZHIPU_IMAGE_MODELS[modelId];
  if (!record) {
    throw new Error(`Unknown Zhipu image model: ${modelId}`);
  }
  return {
    id: record.id,
    name: record.name,
    api: record.api,
    provider: record.provider,
    baseUrl: record.baseUrl,
    input: record.input,
    output: record.output,
    cost: record.cost,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function inferMimeTypeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "image/png";
  } catch {
    return "image/png";
  }
}

export async function generateImagesZhipu(
  model: ImagesModel<ZhipuImagesApi>,
  context: ImagesContext,
  options?: ProviderImagesOptions,
): Promise<AssistantImages> {
  const apiKey = options?.apiKey;
  const signal = options?.signal;
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
    return { ...base, stopReason: "error", errorMessage: "No Zhipu api key provided" };
  }

  const promptText = context.input
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const endpoint = `${model.baseUrl}/images/generations`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        prompt: promptText,
        response_format: "b64_json",
      }),
      ...(signal ? { signal } : {}),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.error?.message ?? `Zhipu API error: ${res.status}`;
      return { ...base, stopReason: "error", errorMessage: msg };
    }

    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) {
      return { ...base, stopReason: "error", errorMessage: "Zhipu API returned no image data" };
    }

    for (const item of items) {
      if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
        base.output.push({
          type: "image",
          data: item.b64_json,
          mimeType: item.mime_type ?? "image/png",
        });
      } else if (typeof item.url === "string" && item.url.length > 0) {
        const imgRes = await fetch(item.url, ...(signal ? [{ signal }] : []));
        if (!imgRes.ok) {
          return { ...base, stopReason: "error", errorMessage: `Failed to fetch image: ${imgRes.status}` };
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mimeType = imgRes.headers.get("content-type") ?? inferMimeTypeFromUrl(item.url);
        base.output.push({ type: "image", data: buf.toString("base64"), mimeType });
      }
    }

    if (base.output.length === 0) {
      return { ...base, stopReason: "error", errorMessage: "Zhipu API returned no usable image" };
    }

    return base;
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return { ...base, stopReason: "aborted", errorMessage: "aborted" };
    }
    return { ...base, stopReason: "error", errorMessage: err?.message ?? String(err) };
  }
}

let registered = false;
function registerZhipuImages(): void {
  if (registered) return;
  const provider: ImagesApiProvider<ZhipuImagesApi, ImagesOptions> = {
    api: "zhipu-images",
    generateImages: generateImagesZhipu as any,
  };
  registerImagesApiProvider(provider, "spherse-zhipu");
  registered = true;
}

registerZhipuImages();
