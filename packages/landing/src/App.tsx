import { useLandingI18n } from "./i18n";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { Hero } from "./components/Hero";
import { Carousel } from "./components/Carousel";
import { Footer } from "./components/Footer";
import { FeatureCards } from "./components/FeatureCards";
import { UpcomingFeatures } from "./components/UpcomingFeatures";

export function App() {
  const { locale, setLocale, t } = useLandingI18n();

  return (
    <div data-landing-root className="flex min-h-full flex-col bg-background">
      <header className="flex justify-end px-6 py-2">
        <LanguageSwitcher locale={locale} onLocaleChange={setLocale} t={t} />
      </header>

      <main className="flex-1">
        <Hero t={t} />
        <Carousel />
        <FeatureCards t={t} />
        <UpcomingFeatures t={t} />
      </main>

      <Footer />
    </div>
  );
}
