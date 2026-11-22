import { Type } from "@sinclair/typebox";
import { parseContract, schemas } from "@spherse/contracts";
import {
  AccessDeniedError,
  assertInsideProject,
  isPathInside,
  resolveProjectPath,
} from "@spherse/core";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "@spherse/rpc/host";

const ATTACHMENTS_DIR = ".spherse/attachments";
const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function randomHex4(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const upload = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    file: Type.Unknown(),
    filename: Type.Optional(Type.String()),
    width: Type.Optional(Type.Number()),
    height: Type.Optional(Type.Number()),
  }),
  async (params, ctx) => {
    if (!(params.file instanceof Blob)) {
      throw new RpcAppError(-32602, "Invalid params for attachments.upload: file must be a Blob");
    }
    const mimeType = params.file.type;
    if (!(mimeType in MIME_TO_EXT)) {
      throw new RpcAppError(400, "Unsupported media type");
    }
    if (params.file.size > MAX_BYTES) {
      throw new RpcAppError(400, "File too large");
    }
    const bytes = new Uint8Array(await params.file.arrayBuffer());
    const ext = MIME_TO_EXT[mimeType];
    const filename = `${Date.now()}-${randomHex4()}.${ext}`;
    const destRel = `${ATTACHMENTS_DIR}/${filename}`;

    const { projectManager } = ctx.resolveProject(params.projectId);
    const root = projectManager.getRootPath();
    const destAbs = resolveProjectPath(root, destRel);
    assertInsideProject(root, destAbs, destRel);
    const attachmentsRoot = resolveProjectPath(root, ATTACHMENTS_DIR);
    if (!isPathInside(attachmentsRoot, destAbs)) {
      throw new RpcAppError(101, "Access denied");
    }

    await projectManager.writeBinaryFile(destRel, bytes);

    return {
      type: "image",
      path: destRel,
      ...(params.width !== undefined ? { width: params.width } : {}),
      ...(params.height !== undefined ? { height: params.height } : {}),
      bytes: bytes.byteLength,
    };
  },
);

const remove = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    path: Type.String({ minLength: 1 }),
  }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const root = projectManager.getRootPath();
    let targetAbs: string;
    try {
      targetAbs = resolveProjectPath(root, params.path);
      assertInsideProject(root, targetAbs, params.path);
    } catch (err) {
      if (err instanceof AccessDeniedError) throw new RpcAppError(101, "Access denied");
      throw err;
    }
    const attachmentsRoot = resolveProjectPath(root, ATTACHMENTS_DIR);
    if (!isPathInside(attachmentsRoot, targetAbs)) {
      throw new RpcAppError(101, "Access denied");
    }
    try {
      await projectManager.deletePath(params.path);
    } catch (err) {
      if (err instanceof AccessDeniedError) throw new RpcAppError(101, "Access denied");
      throw err;
    }
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const attachmentMethods: Record<string, RpcMethodEntry> = {
  "attachments.upload": upload,
  "attachments.delete": remove,
};
