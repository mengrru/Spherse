import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router";
import "./styles.css";
import "./lib/electron-api";

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
