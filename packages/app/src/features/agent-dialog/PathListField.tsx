import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { SearchFileField } from "./SearchFileField";
import { HintLabel } from "./HintLabel";
import { XIcon } from "lucide-react";

export function PathListField({
  paths,
  onAdd,
  onRemove,
  label,
  hint,
  placeholder,
}: {
  paths: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  label: string;
  hint: string;
  placeholder: string;
}) {
  return (
    <Field>
      <HintLabel hint={hint}>{label}</HintLabel>
      {paths.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {paths.map((path) => (
            <Badge key={path} variant="secondary" className="gap-1">
              {path}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1 size-4"
                onClick={() => onRemove(path)}
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <SearchFileField
        exclude={paths}
        onSelect={onAdd}
        placeholder={placeholder}
      />
    </Field>
  );
}
