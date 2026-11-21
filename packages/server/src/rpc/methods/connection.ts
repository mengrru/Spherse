import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "../context.js";
import { SERVER_VERSION, API_VERSION } from "../../server-info.js";

const info = defineRpcMethod(Type.Object({}), (_params, ctx) =>
  parseContract(schemas.connectionInfoResponse, {
    serverVersion: SERVER_VERSION,
    authRequired: ctx.authRequired,
    apiVersion: API_VERSION,
    appVersion: ctx.appVersion,
  }),
);

const projects = defineRpcMethod(Type.Object({}), (_params, ctx) =>
  parseContract(
    schemas.projectListResponse,
    ctx.registry.listInfo().map(({ id, name, lastOpened }) => ({ id, name, lastOpened })),
  ),
);

const projectInfo = defineRpcMethod(Type.Object({ projectId: Type.String() }), (params, ctx) => {
  const data = ctx.registry.getInfo(params.projectId);
  if (!data) throw new RpcAppError(100, "Unknown project");
  const { id, name, rootPath, lastOpened } = data;
  return parseContract(schemas.projectInfoResponse, { id, name, rootPath, lastOpened });
});

export const connectionMethods: Record<string, RpcMethodEntry> = {
  "connection.info": info,
  "connection.projects": projects,
  "connection.projectInfo": projectInfo,
};
