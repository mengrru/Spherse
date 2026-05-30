export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background text-foreground">
      <h1 className="mb-2 text-2xl font-semibold">
        Spherse
      </h1>
      <p className="text-sm text-muted-foreground">
        点击左侧 + 打开项目
      </p>
    </div>
  );
}
