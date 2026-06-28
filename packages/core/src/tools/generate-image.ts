import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveProjectPath } from "../utils/path-safety.js";
import { getImagesModels } from "../model-providers/index.js";

const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "图片描述（prompt），用于生成图片" }),
});

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const GENERATED_DIR = ".spherse/generated-images";

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
      `这是一个**图片生成（AI 绘图）工具**，根据文本描述（prompt）调用 AI 模型从零生成一张全新图片，并在聊天中以 image card 展示。生成后图片自动保存到 ${GENERATED_DIR} 目录下，用户可通过卡片右上角按钮导出到项目文件。`,
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
        result = await imagesModels.generateImages(
          model,
          { input: [{ type: "text", text: prompt }] },
          { apiKey: config.apiKey, ...(signal ? { signal } : {}) },
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
      const details = {
        type: "image" as const,
        cardType: "image" as const,
        status: "done" as const,
        path: destRel,
        prompt,
        model: modelLabel,
        mimeType: imageContent.mimeType,
      };

      onUpdate?.({
        content: [{ type: "text" as const, text: `已生成图片：${prompt}` }],
        details,
      });

      return {
        content: [{ type: "text" as const, text: `已生成图片：${prompt}` }],
        details,
      };
    },
  };
}
