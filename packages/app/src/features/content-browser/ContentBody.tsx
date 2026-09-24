import { useFeature } from "../../lib/use-feature";
import { TextSelectionSession } from "../text-selection-session";
import { ContentView } from "./ContentView";
import type { useContentViewState } from "./hooks/useContentViewState";

type ViewState = ReturnType<typeof useContentViewState>;

interface ContentBodyProps {
  filePath: string;
  content: string | null;
  binary: boolean;
  loading: boolean;
  error: string | null;
  view: ViewState;
  isEditing?: boolean;
  editedContent?: string;
  onEditedContentChange?: (content: string) => void;
  onOpenFile?: (path: string) => void;
}

const noop = () => {};

export function ContentBody({
  filePath,
  content,
  binary,
  loading,
  error,
  view,
  isEditing = false,
  editedContent = "",
  onEditedContentChange = noop,
  onOpenFile,
}: ContentBodyProps) {
  const textSelectionEnabled = useFeature("text-selection-session");
  const viewProps = {
    filePath,
    content,
    binary,
    loading,
    error,
    isMarkdown: view.isMarkdown,
    isHtml: view.isHtml,
    isImage: view.isImage,
    htmlView: view.htmlView,
    isEditing,
    editedContent,
    onEditedContentChange,
    refreshKey: view.refreshKey,
    findOpen: view.findOpen,
    onFindOpenChange: view.setFindOpen,
    onOpenFile,
  };

  if (!textSelectionEnabled) return <ContentView {...viewProps} />;
  return (
    <TextSelectionSession disabled={isEditing} sourcePath={filePath}>
      {(contentRef) => <ContentView {...viewProps} contentRef={contentRef} />}
    </TextSelectionSession>
  );
}
