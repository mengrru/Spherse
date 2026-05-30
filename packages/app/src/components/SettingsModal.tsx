import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { EyeIcon, EyeOffIcon } from "lucide-react";

interface ProviderConfig {
  name: string;
  envKey: string;
  models: readonly string[];
}

interface SettingsModalProps {
  onClose: () => void;
}

const electronAPI = (window as any).electronAPI as {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      electronAPI.getSupportedProviders(),
      electronAPI.getSettings(),
    ]).then(([prov, settings]) => {
      setProviders(prov ?? {});
      if (settings) {
        const keys: Record<string, string> = {};
        for (const [id, config] of Object.entries(settings.providers ?? {})) {
          if ((config as any)?.apiKey) {
            keys[id] = (config as any).apiKey;
          }
        }
        setApiKeys(keys);
        setDefaultModel(settings.defaultModel ?? "");
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const providersSettings: Record<string, { apiKey: string } | undefined> = {};
    for (const [id, key] of Object.entries(apiKeys)) {
      if (key.trim()) {
        providersSettings[id] = { apiKey: key.trim() };
      }
    }
    try {
      await electronAPI.saveSettings({
        providers: providersSettings,
        defaultModel,
      });
      setMessage("saved");
    } catch {
      setMessage("error");
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[80vh] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FieldGroup>
            <h3 className="text-sm font-medium">API 配置</h3>
            {Object.entries(providers).map(([id, config]) => (
              <Field key={id}>
                <FieldLabel className="items-center gap-2">
                  {config.name}
                  <Badge variant={apiKeys[id]?.trim() ? "secondary" : "outline"}>
                    {apiKeys[id]?.trim() ? "已配置" : "未配置"}
                  </Badge>
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    type={showKeys[id] ? "text" : "password"}
                    className="flex-1"
                    placeholder={config.envKey}
                    value={apiKeys[id] ?? ""}
                    onChange={(e) =>
                      setApiKeys({ ...apiKeys, [id]: e.target.value })
                    }
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setShowKeys({ ...showKeys, [id]: !showKeys[id] })
                    }
                    title={showKeys[id] ? "隐藏" : "显示"}
                  >
                    {showKeys[id] ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </Field>
            ))}
          </FieldGroup>
          <FieldGroup className="mt-5">
            <Field>
              <FieldLabel>默认模型</FieldLabel>
              <NativeSelect
                className="w-full"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                <NativeSelectOption value="">-- 请选择 --</NativeSelectOption>
                {Object.entries(providers)
                  .filter(([id]) => apiKeys[id]?.trim())
                  .map(([id, config]) => (
                    <NativeSelectOptGroup key={id} label={config.name}>
                      {config.models.map((m) => (
                        <NativeSelectOption key={m} value={m}>
                          {m}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
              </NativeSelect>
              {Object.entries(providers).filter(([id]) => apiKeys[id]?.trim()).length === 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">请先配置 API Key</p>
              )}
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter className="items-center">
          {message === "saved" && (
            <span className="mr-auto text-xs text-muted-foreground">已保存</span>
          )}
          {message === "error" && (
            <span className="mr-auto text-xs text-destructive">保存失败</span>
          )}
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
