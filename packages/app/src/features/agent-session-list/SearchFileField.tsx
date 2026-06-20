import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { useProjectCtx } from "../../context/project-context";

const FILE_TREE_EXCLUDE = new Set(["AGENTS.md", "CHANGELOG.md", "changelog.md"]);

type FileSuggestion = { name: string; fullPath: string };

function fuzzyMatch(filePath: string, query: string): boolean {
  const lower = filePath.toLowerCase();
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length === 0 || parts.every((seg) => lower.includes(seg));
}

interface SearchFileFieldProps {
  exclude?: string[];
  onSelect: (path: string) => void;
  placeholder?: string;
}

export function SearchFileField({ exclude = [], onSelect, placeholder }: SearchFileFieldProps) {
  const { client } = useProjectCtx();
  const [input, setInput] = useState("");
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    client.getFileTree().then((tree) => {
      setFileTree(tree.filter((f) => !FILE_TREE_EXCLUDE.has(f.split("/").pop() ?? "")));
    }).catch(() => {});
  }, [client]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function selectPath(path: string) {
    onSelect(path);
    setInput("");
    setSuggestions([]);
    setOpen(false);
  }

  function matchFiles(query: string) {
    if (!query.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const matched = fileTree
      .filter((f) => fuzzyMatch(f, query))
      .filter((f) => !exclude.includes(f))
      .map((f) => ({ name: f.split("/").pop() ?? f, fullPath: f }));
    setSuggestions(matched.slice(0, 8));
    setOpen(matched.length > 0);
  }

  function handleInputChange(value: string) {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => matchFiles(value), 200);
  }

  function handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const path = input.trim();
      if (path && !exclude.includes(path)) {
        selectPath(path);
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) { setOpen(false); setSuggestions([]); } }}>
      <PopoverTrigger render={<div />} onClick={(e) => e.preventDefault()}>
        <Input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
        />
      </PopoverTrigger>
      <PopoverContent
        initialFocus={false}
        align="start"
        side="bottom"
        sideOffset={2}
        className="gap-0 p-1"
        style={{ width: "var(--anchor-width, 200px)" }}
      >
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.fullPath}
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              selectPath(suggestion.fullPath);
            }}
          >
            {suggestion.fullPath}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
