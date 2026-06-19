import { useI18n } from "@spherse/i18n/react";
import { WelcomePage } from "../features/welcome-page";

export function WelcomePagePage() {
  const { t } = useI18n();

  return (
    <WelcomePage
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p>{t("chat.startConversation")}</p>
        </div>
      }
    />
  );
}
