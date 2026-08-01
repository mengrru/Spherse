interface BrowserViewProps {
  url: string;
  refreshKey: number;
}

export function BrowserView({ url, refreshKey }: BrowserViewProps) {
  return (
    <iframe
      key={refreshKey}
      src={url}
      title="Browser"
      className="h-full w-full border-0 bg-background"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
