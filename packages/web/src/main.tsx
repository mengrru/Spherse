import { createAppRoot } from "@spherse/app/main";
import { createWebHostBridge } from "./host-bridge-web";
import { setupWebResumeProbe } from "@spherse/app/web-resume-probe";
import { runWebVersionGuard } from "./version-guard";

const bridge = createWebHostBridge();
setupWebResumeProbe();
createAppRoot(bridge);
void runWebVersionGuard();
