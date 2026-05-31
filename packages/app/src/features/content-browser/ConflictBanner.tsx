import { Button } from "../../components/ui/button";

interface ConflictBannerProps {
  onKeep: () => void;
  onReload: () => void;
}

export function ConflictBanner({ onKeep, onReload }: ConflictBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
      <span className="flex-1">文件已被外部修改</span>
      <Button
        variant="outline"
        size="sm"
        onClick={onKeep}
      >
        保留我的修改
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onReload}
      >
        重新加载文件
      </Button>
    </div>
  );
}
