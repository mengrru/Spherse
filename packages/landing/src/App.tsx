import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router";
import { useLandingI18n } from "./i18n";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Carousel } from "./components/Carousel";
import { Footer } from "./components/Footer";
import { FeatureCards } from "./components/FeatureCards";
import { UpcomingFeatures } from "./components/UpcomingFeatures";
import { CasesPage } from "./components/CasesPage";
import { DocsPage } from "./components/DocsPage";
import { DownloadPage } from "./components/DownloadPage";

export function App() {
  const { locale, setLocale, t } = useLandingI18n();

  return (
    <BrowserRouter>
      <div data-landing-root className="flex min-h-full flex-col bg-background">
        <Header locale={locale} onLocaleChange={setLocale} t={t} />

        <main className="flex-1">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <Hero t={t} />
                  <Carousel />
                  <div className="flex justify-center pb-10">
                    <Link
                      to="/explore"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      {t("home.moreCases")} →
                    </Link>
                  </div>
                  <FeatureCards t={t} />
                  <UpcomingFeatures t={t} />
                </>
              }
            />
            <Route path="/explore" element={<CasesPage t={t} />} />
            <Route path="/download" element={<DownloadPage t={t} />} />
            <Route path="/docs" element={<DocsPage t={t} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <Footer />
      </div>
    </BrowserRouter>
  );
}
