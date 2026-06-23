import { useI18n } from "@spherse/i18n/react";
import { WelcomePage } from "../features/welcome-page";
import { useProjectCtx } from "../context/project-context";

export function WelcomePagePage() {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();

  return (
    <WelcomePage
      // 切换 project 时强制 remount，避免旧 project 的 path/client 残留导致跨项目请求
      key={projectId}
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p>{t("chat.startConversation")}</p>
        </div>
      }
    />
  );
}
