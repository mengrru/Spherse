import { useProjectCtx } from "../context/project-context";
import { useApiClient } from "../lib/use-connection";
import { useEventBridge } from "./event/use-event-bridge";
import { useSpherseMessageListener } from "./use-spherse-message-listener";

export function UiSdkBridge() {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);

  useSpherseMessageListener(projectId, client);
  useEventBridge(projectId, client);

  return null;
}
