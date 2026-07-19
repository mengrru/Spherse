import { createAppRoot } from "@spherse/app/src/main";
import { createElectronHostBridge } from "./host-bridge-electron";

createAppRoot(createElectronHostBridge());
