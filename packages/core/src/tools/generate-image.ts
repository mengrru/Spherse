import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ProviderImagesOptions } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveProjectPath } from "../utils/path-safety.js";
import { getImagesModels } from "../model-providers/index.js";

type ImageGenOptions = ProviderImagesOptions & {
  size?: string;
  quality?: string;
};

const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Text description (prompt) of the image to generate" }),
  size: Type.Optional(
    Type.String({
      description:
        'Image size, e.g. "1024x1024", "1536x1024", "1024x1536", "auto". Varies by model; omit to use the model default.',
    }),
  ),
  quality: Type.Optional(
    Type.String({
      description:
        'Image quality: GPT image models use "low" | "medium" | "high" | "auto"; dall-e-3 uses "standard" | "hd". Omit to use the model default.',
    }),
  ),
});

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const GENERATED_DIR = ".spherse/generated-images";

export interface ImageCardDetails {
  type: "image";
  status: "generating" | "done" | "error";
  path?: string;
  prompt: string;
  model?: string;
  mimeType?: string;
  errorMessage?: string;
}

export interface ImageCardResultDetails extends ImageCardDetails {
  cardType: "image";
}

function readImageConfig(): { provider: string; modelId: string; apiKey: string } | null {
  const modelStr = process.env.SPHERSE_IMAGE_MODEL;
  const apiKey = process.env.SPHERSE_IMAGE_API_KEY;
  if (!modelStr || !apiKey) return null;
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx <= 0) return null;
  return {
    provider: modelStr.slice(0, slashIdx),
    modelId: modelStr.slice(slashIdx + 1),
    apiKey,
  };
}

function buildFilename(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType] ?? "png";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const hex = crypto.randomBytes(2).toString("hex");
  return `${ts}-${hex}.${ext}`;
}

export function createGenerateImageTool(projectRoot: string): AgentTool<typeof GenerateImageParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "generate_image",
    label: "Generate Image",
    description:
      `**AI image generation tool.** Generates a brand-new image from a text description (prompt) using an AI model, displayed as an image card in the chat. The generated image is saved automatically under ${GENERATED_DIR}; the user can export it to a project file via the button at the top-right of the card. **Note: a successfully generated image is shown to the user as a card automatically — do not call the render_card tool to render it.**`,
    parameters: GenerateImageParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      const prompt = params.prompt;
      const config = readImageConfig();
      if (!config) {
        return {
          content: [{ type: "text" as const, text: "图片生成未配置：缺少 provider/model/apiKey，请在设置中配置图片生成模型与 API Key。" }],
          details: { type: "image", status: "error", prompt, errorMessage: "not-configured" },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: "正在生成图片..." }],
        details: { type: "image", status: "generating", prompt },
      });

      const imagesModels = getImagesModels();
      const model = imagesModels.getModel(config.provider, config.modelId);
      if (!model) {
        return {
          content: [{ type: "text" as const, text: `图片生成失败：无法解析模型 ${config.provider}/${config.modelId}` }],
          details: { type: "image", status: "error", prompt, errorMessage: "model-not-found" },
        };
      }

      let result;
      try {
        const genOptions: ImageGenOptions = {
          apiKey: config.apiKey,
          ...(signal ? { signal } : {}),
          ...(params.size ? { size: params.size } : {}),
          ...(params.quality ? { quality: params.quality } : {}),
        };
        result = await imagesModels.generateImages(
          model,
          { input: [{ type: "text", text: prompt }] },
          genOptions,
        );
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        onUpdate?.({
          content: [{ type: "text" as const, text: `图片生成失败：${message}` }],
          details: { type: "image", status: "error", prompt, errorMessage: message },
        });
        return {
          content: [{ type: "text" as const, text: `图片生成失败：${message}` }],
          details: { type: "image", status: "error", prompt, errorMessage: message },
        };
      }

      if (result.stopReason === "error") {
        const message = result.errorMessage ?? "未知错误";
        onUpdate?.({
          content: [{ type: "text" as const, text: `图片生成失败：${message}` }],
          details: { type: "image", status: "error", prompt, errorMessage: message },
        });
        return {
          content: [{ type: "text" as const, text: `图片生成失败：${message}` }],
          details: { type: "image", status: "error", prompt, errorMessage: message },
        };
      }

      const imageContent = result.output.find((c: any) => c.type === "image") as
        | { type: "image"; data: string; mimeType: string }
        | undefined;
      if (!imageContent) {
        const message = "模型未返回图片内容";
        onUpdate?.({
          content: [{ type: "text" as const, text: `图片生成失败：${message}` }],
          details: { type: "image", status: "error", prompt, errorMessage: message },
        });
        return { content: [{ type: "text" as const, text: `图片生成失败：${message}` }], details: { type: "image", status: "error", prompt, errorMessage: message } };
      }

      const buf = Buffer.from(imageContent.data, "base64");
      let destRel: string;
      let abs: string;
      do {
        const filename = buildFilename(imageContent.mimeType);
        destRel = `${GENERATED_DIR}/${filename}`;
        abs = resolveProjectPath(root, destRel);
      } while (fsSync.existsSync(abs));

      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, buf);

      const modelLabel = `${config.provider}/${config.modelId}`;
      const details: ImageCardResultDetails = {
        type: "image",
        cardType: "image",
        status: "done",
        path: destRel,
        prompt,
        model: modelLabel,
        mimeType: imageContent.mimeType,
      };

      const successText = `已生成图片：${prompt}\n图片已保存至：${destRel}`;

      onUpdate?.({
        content: [{ type: "text" as const, text: successText }],
        details,
      });

      return {
        content: [{ type: "text" as const, text: successText }],
        details,
      };
    },
  };
}
