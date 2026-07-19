import { createAppRoot } from "@spherse/app/src/main";
import { createWebHostBridge } from "./host-bridge-web";

createAppRoot(createWebHostBridge());
