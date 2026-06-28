import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import type { TranslationKey } from "@spherse/i18n";
import { toast } from "sonner";
import type { SampleManifestEntry } from "@shared/electron-api";
import { useAppStore } from "../../stores/app-store";

const ERROR_KEYS: Record<string, TranslationKey> = {
  dirExistsNotEmpty: "onboarding.error.dirExistsNotEmpty",
  createFailed: "onboarding.error.createFailed",
  copyFailed: "onboarding.error.copyFailed",
  sampleNotFound: "onboarding.error.sampleNotFound",
};

function reportError(
  t: (key: TranslationKey) => string,
  code: string | undefined,
): void {
  if (!code) return;
  const key = ERROR_KEYS[code];
  if (key) toast.error(t(key));
  else console.warn("[onboarding] unknown error code:", code);
}

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const openProject = useAppStore((state) => state.openProject);
  const createNewProject = useAppStore((state) => state.createNewProject);
  const openSampleProject = useAppStore((state) => state.openSampleProject);
  const [samples, setSamples] = useState<SampleManifestEntry[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getSampleManifest()
      .then((entries) => {
        if (!cancelled) setSamples(entries);
      })
      .catch(() => {
        console.warn("[onboarding] failed to load sample manifest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenExisting = async () => {
    const projectId = await openProject();
    if (projectId) navigate(`/project/${projectId}`);
  };

  const handleCreateNew = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { projectId, error } = await createNewProject();
      if (projectId) {
        navigate(`/project/${projectId}`);
      } else {
        reportError(t, error);
      }
    } finally {
      busyRef.current = false;
    }
  };

  const handleOpenSample = async (sampleId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { projectId, error } = await openSampleProject(sampleId);
      if (projectId) {
        navigate(`/project/${projectId}`);
      } else {
        reportError(t, error);
      }
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center overflow-auto bg-background px-6 pb-16 pt-10 text-foreground">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-semibold">{t("onboarding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
      </header>
      <div className="grid w-full max-w-4xl grid-cols-3 gap-4">
        <ActionCard
          title={t("onboarding.action.openExisting")}
          desc={t("onboarding.desc.openExisting")}
          onClick={handleOpenExisting}
        />
        <ActionCard
          title={t("onboarding.action.createNew")}
          desc={t("onboarding.desc.createNew")}
          onClick={handleCreateNew}
        />
        {samples.map((sample) => (
          <ActionCard
            key={sample.id}
            title={`🪄✨ ${t("onboarding.action.openSample", { name: sample.displayName })}`}
            desc={t("onboarding.desc.openSample")}
            onClick={() => handleOpenSample(sample.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ActionCard({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-5 text-start transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </button>
  );
}
