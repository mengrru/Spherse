import { createAppRoot } from "@spherse/app/main";
import { createElectronHostBridge } from "./host-bridge-electron";

createAppRoot(createElectronHostBridge());
