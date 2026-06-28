import { useEffect, useRef } from "react";
import { Input } from "../../components/ui/input";
import { INVALID_NAME_RE } from "./tree-model";

export function InlineNameInput({
  depth,
  onSubmit,
  onCancel,
}: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
      <Input
        ref={inputRef}
        className="h-6 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const value = e.currentTarget.value.trim();
            if (value && !INVALID_NAME_RE.test(value)) {
              onSubmit(value);
            }
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={() => onCancel()}
      />
    </div>
  );
}
