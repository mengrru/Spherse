import { registerAction } from "../registry";
import { toast } from "sonner";

type ToastVariant = "default" | "success" | "error" | "warning" | "info";

const VARIANTS: ToastVariant[] = ["default", "success", "error", "warning", "info"];

registerAction("showToast", (params) => {
  const { variant, message, description } = (params ?? {}) as {
    variant?: unknown;
    message?: unknown;
    description?: unknown;
  };
  if (typeof message !== "string" || !message) return;

  const v: ToastVariant =
    typeof variant === "string" && VARIANTS.includes(variant as ToastVariant)
      ? (variant as ToastVariant)
      : "default";
  const desc = typeof description === "string" ? description : undefined;
  const opts = desc ? { description: desc } : undefined;

  switch (v) {
    case "success":
      toast.success(message, opts);
      break;
    case "error":
      toast.error(message, opts);
      break;
    case "warning":
      toast.warning(message, opts);
      break;
    case "info":
      toast.info(message, opts);
      break;
    default:
      toast(message, opts);
  }
});
