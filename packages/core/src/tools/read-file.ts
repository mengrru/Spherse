import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicyProvider } from "../access/access-policy.js";
import type { FsPort } from "../store/fs-port.js";
import { resolveProjectPath } from "../utils/path-safety.js";
import { isBinaryBuffer } from "../utils/binary-detect.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"]);

function isImageExt(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ReadFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
});

export function createReadFileTool(
  projectRoot: string,
  fsPort: FsPort,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof ReadFileParams> {
  const root = path.resolve(projectRoot);
  const utf8Decoder = new TextDecoder();

  return {
    name: "read_file",
    label: "Read File",
    description:
      "Read the content of a text file in the project. Returns the file content as text. Binary files (images, fonts, databases, etc.) are detected and refused with a hint instead of returning garbled output — use `render_card` with `file_path` to display image files.",
    parameters: ReadFileParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = resolveProjectPath(root, params.path);
      try {
        getPolicy().assertRead(params.path);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { path: params.path, denied: true },
        };
      }

      let buf: Uint8Array;
      try {
        buf = await fsPort.readBinaryFile(path.relative(root, resolved).split(path.sep).join("/"));
      } catch {
        return {
          content: [{ type: "text" as const, text: `Error: file not found at ${params.path}` }],
          details: undefined,
        };
      }

      if (isBinaryBuffer(buf)) {
        const size = buf.length;
        const image = isImageExt(params.path);
        const hint = image
          ? `Error: \`${params.path}\` is a binary image file (${formatSize(size)}). \`read_file\` only returns text. To display this image, call \`render_card\` with \`file_path: "${params.path}"\`.`
          : `Error: \`${params.path}\` is a binary file (${formatSize(size)}). \`read_file\` only returns text and cannot read binary content.`;
        return {
          content: [{ type: "text" as const, text: hint }],
          details: { path: params.path, binary: true, image, size },
        };
      }

      const content = utf8Decoder.decode(buf);
      return {
        content: [{ type: "text" as const, text: content }],
        details: { path: params.path, size: content.length },
      };
    },
  };
}
