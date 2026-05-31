import { useParams } from "react-router";
import { ProjectLayout } from "../layouts/ProjectLayout";
import { useAppStore } from "../stores/app-store";

export function ProjectPage() {
  const { projectKey } = useParams();
  const project = useAppStore((state) => (
    projectKey ? state.projects.get(projectKey) : undefined
  ));
  const initializing = useAppStore((state) => state.initializing);

  if (!projectKey || !project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        {initializing ? "加载中..." : "项目不存在"}
      </div>
    );
  }

  return <ProjectLayout projectKey={projectKey} project={project} />;
}
