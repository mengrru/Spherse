import { Download } from "lucide-react";
import { Button } from "./ui/button";
import type { TranslationKey } from "../i18n";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

interface HeroProps {
  t: (key: TranslationKey) => string;
}

export function Hero({ t }: HeroProps) {
  return (
    <section className="flex flex-col items-center gap-8 px-6 py-12 text-center md:py-16">
      <h1 className="text-5xl font-bold tracking-tight text-foreground md:text-7xl">
        {t("hero.title")}
      </h1>
      <p className="-mt-3 max-w-2xl text-lg text-muted-foreground md:text-xl">
        {t("hero.subtitle")}
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" variant="default" render={<a href="#" />}>
          <Download className="size-5" />
          {t("hero.downloadMac")}
        </Button>
        <Button size="lg" variant="outline" render={<a href="#" />}>
          <Download className="size-5" />
          {t("hero.downloadWin")}
        </Button>
        <Button size="lg" variant="ghost" render={<a href="https://github.com/mengrru/Spherse" target="_blank" rel="noopener noreferrer" />}>
          <GithubIcon className="size-5" />
          GitHub
        </Button>
      </div>
    </section>
  );
}
