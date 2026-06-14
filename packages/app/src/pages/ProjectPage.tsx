import { useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { ProjectLayout } from "../layouts/ProjectLayout";
import { useAppStore } from "../stores/app-store";

export function ProjectPage() {
  const { projectId } = useParams();
  const { t } = useI18n();
  const project = useAppStore((state) => (
    projectId ? state.projects.get(projectId) : undefined
  ));
  const initializing = useAppStore((state) => state.initializing);

  if (!projectId || !project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        {initializing ? t("common.loading") : t("pages.projectNotFound")}
      </div>
    );
  }

  return <ProjectLayout key={projectId} projectId={projectId} project={project} />;
}
