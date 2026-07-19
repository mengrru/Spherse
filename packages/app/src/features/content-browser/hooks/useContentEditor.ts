import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import { useBusSubscription } from "../../../hooks/useBusSubscription";

interface UseContentEditorOptions {
  client: ApiClient;
  projectId: string;
  filePath: string;
  content: string | null;
  setContent: (content: string) => void;
}

export function useContentEditor({
  client,
  projectId,
  filePath,
  content,
  setContent,
}: UseContentEditorOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const isDirty = isEditing && editedContent !== (content ?? "");

  useEffect(() => {
    setIsEditing(false);
    setConflict(false);
    setSaveError(null);
    setShowLeaveConfirm(false);
    setShowCancelConfirm(false);
    pendingLeaveRef.current = null;
  }, [filePath]);

  const enterEdit = () => {
    setEditedContent(content ?? "");
    setSaveError(null);
    setConflict(false);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      setIsEditing(false);
      setSaveError(null);
      setConflict(false);
    }
  };

  const confirmCancel = () => {
    setShowCancelConfirm(false);
    setIsEditing(false);
    setSaveError(null);
    setConflict(false);
  };

  const requestLeave = (onLeave: () => void) => {
    if (isDirty) {
      pendingLeaveRef.current = onLeave;
      setShowLeaveConfirm(true);
    } else {
      onLeave();
    }
  };

  const confirmLeave = () => {
    const cb = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    setShowLeaveConfirm(false);
    setIsEditing(false);
    cb?.();
  };

  const save = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.saveContent(filePath, editedContent);
      setContent(editedContent);
      setIsEditing(false);
      setConflict(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [client, filePath, editedContent, isDirty, saving, setContent]);

  const reloadFromDisk = async () => {
    const data = await client.getContent(filePath);
    if (data) {
      setContent(data.content);
      setEditedContent(data.content);
    }
    setConflict(false);
  };

  useEffect(() => {
    if (!isEditing) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing, save]);

  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const filePathRef = useRef(filePath);
  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    if (!isEditingRef.current) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== filePathRef.current.replace(/\\/g, "/")) return;
    setConflict(true);
  });

  return {
    isEditing,
    editedContent,
    setEditedContent,
    saving,
    saveError,
    conflict,
    setConflict,
    showLeaveConfirm,
    setShowLeaveConfirm,
    showCancelConfirm,
    setShowCancelConfirm,
    isDirty,
    enterEdit,
    cancelEdit,
    confirmCancel,
    requestLeave,
    confirmLeave,
    save,
    reloadFromDisk,
  };
}
