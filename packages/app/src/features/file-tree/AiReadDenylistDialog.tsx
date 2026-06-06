import type { KeyboardEvent } from "react";
import { Trash2Icon } from "lucide-react";
import type { ApiClient } from "../../lib/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { useAiReadDenylist } from "./useAiReadDenylist";

export function AiReadDenylistDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const denylist = useAiReadDenylist(client, open);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      denylist.addInput();
    }
  };

  const handleSave = async () => {
    const saved = await denylist.save();
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>AI 读取限制</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            列表中的文件或目录不会被 AI 工具读取；你仍可正常查看和编辑。
          </p>
          <div className="flex gap-2">
            <Input
              value={denylist.input}
              onChange={(event) => denylist.setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如 secrets 或 notes/private.md"
            />
            <Button type="button" onClick={denylist.addInput}>
              添加
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {denylist.loading ? (
              <p className="p-3 text-sm text-muted-foreground">加载中...</p>
            ) : denylist.paths.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">暂无限制路径</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {denylist.paths.map((path) => (
                  <div key={path} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{path}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`移除 ${path}`}
                      onClick={() => denylist.removePath(path)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSave} disabled={denylist.saving}>
            {denylist.saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
