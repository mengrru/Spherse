import { createAppRoot } from "@spherse/app/src/main";
import { createWebHostBridge } from "./host-bridge-web";
import { setupWebResumeProbe } from "@spherse/app/src/lib/web-resume-probe";

const bridge = createWebHostBridge();
setupWebResumeProbe();
createAppRoot(bridge);
