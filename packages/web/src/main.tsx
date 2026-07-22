import { createAppRoot } from "@spherse/app/src/main";
import { createWebHostBridge } from "./host-bridge-web";
import { setupWebResumeReload } from "./resume-reload";

const bridge = createWebHostBridge();
setupWebResumeReload();
createAppRoot(bridge);
