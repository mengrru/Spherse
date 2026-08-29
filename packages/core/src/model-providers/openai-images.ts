import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesProvider,
  ProviderImagesOptions,
} from "@earendil-works/pi-ai";
import { createImagesProvider, envApiKeyAuth } from "@earendil-works/pi-ai";

export type OpenaiImagesApi = "openai-images";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export interface OpenaiImagesModelRecord {
  id: string;
  name: string;
  provider: "openai";
  api: OpenaiImagesApi;
  baseUrl: string;
  input: ("text" | "image")[];
  output: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export const OPENAI_IMAGE_MODELS: Record<string, OpenaiImagesModelRecord> = {
  "gpt-image-2": {
    id: "gpt-image-2",
    name: "GPT Image 2",
    provider: "openai",
    api: "openai-images",
    baseUrl: OPENAI_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "gpt-image-1.5": {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    provider: "openai",
    api: "openai-images",
    baseUrl: OPENAI_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "gpt-image-1": {
    id: "gpt-image-1",
    name: "GPT Image 1",
    provider: "openai",
    api: "openai-images",
    baseUrl: OPENAI_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "gpt-image-1-mini": {
    id: "gpt-image-1-mini",
    name: "GPT Image 1 Mini",
    provider: "openai",
    api: "openai-images",
    baseUrl: OPENAI_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "dall-e-3": {
    id: "dall-e-3",
    name: "DALL·E 3",
    provider: "openai",
    api: "openai-images",
    baseUrl: OPENAI_API_BASE_URL,
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

export function resolveOpenaiImageModel(modelId: string): ImagesModel<OpenaiImagesApi> {
  const record = OPENAI_IMAGE_MODELS[modelId];
  if (!record) {
    throw new Error(`Unknown OpenAI image model: ${modelId}`);
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

type OpenaiImagesOptions = ProviderImagesOptions & {
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

function inferMimeTypeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "image/png";
  } catch {
    return "image/png";
  }
}

const DALLE_MODELS = new Set(["dall-e-2", "dall-e-3"]);

export async function generateImagesOpenai(
  model: ImagesModel<OpenaiImagesApi>,
  context: ImagesContext,
  options?: OpenaiImagesOptions,
): Promise<AssistantImages> {
  const apiKey = options?.apiKey;
  const signal = options?.signal;
  const size = options?.size;
  const quality = options?.quality;
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
    return { ...base, stopReason: "error", errorMessage: "No OpenAI api key provided" };
  }

  const promptText = context.input
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const body: Record<string, unknown> = {
    model: model.id,
    prompt: promptText,
    n: 1,
  };
  if (size) body.size = size;
  if (quality) body.quality = quality;
  if (DALLE_MODELS.has(model.id)) {
    body.response_format = "b64_json";
  }

  const endpoint = `${model.baseUrl}/images/generations`;
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
      const msg = (errBody as any)?.error?.message ?? `OpenAI API error: ${res.status}`;
      return { ...base, stopReason: "error", errorMessage: msg };
    }

    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) {
      return { ...base, stopReason: "error", errorMessage: "OpenAI API returned no image data" };
    }

    for (const item of items) {
      if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
        base.output.push({
          type: "image",
          data: item.b64_json,
          mimeType: "image/png",
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
      return { ...base, stopReason: "error", errorMessage: "OpenAI API returned no usable image" };
    }

    return base;
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return { ...base, stopReason: "aborted", errorMessage: "aborted" };
    }
    return { ...base, stopReason: "error", errorMessage: err?.message ?? String(err) };
  }
}

export function createOpenaiImagesProvider(): ImagesProvider {
  return createImagesProvider({
    id: "openai",
    name: "OpenAI",
    auth: { apiKey: envApiKeyAuth("OpenAI image API key", ["SPHERSE_IMAGE_API_KEY"]) },
    models: Object.values(OPENAI_IMAGE_MODELS).map((m) => ({
      id: m.id,
      name: m.name,
      provider: "openai",
      api: m.api,
      baseUrl: m.baseUrl,
      input: m.input,
      output: m.output,
      cost: m.cost,
    })),
    api: { generateImages: generateImagesOpenai as any },
  });
}
