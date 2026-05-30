import { useState, useEffect } from "react";
import type { ComponentProps, ElementType } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

interface ProviderConfig {
  name: string;
  envKey: string;
  models: readonly string[];
}

interface SettingsModalProps {
  onClose: () => void;
}

const MODEL_PROVIDER_IDS = ["deepseek", "zai"] as const;
const FALLBACK_MODEL_PROVIDERS: Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig> = {
  deepseek: {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  zai: {
    name: "z.ai",
    envKey: "ZAI_API_KEY",
    models: ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"],
  },
};

interface AppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
}

interface SettingsElectronAPI {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
}

const electronAPI = (window as unknown as { electronAPI: SettingsElectronAPI }).electronAPI;

export function SettingsModal({ onClose }: SettingsModalProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[80vh] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <ModelSettingsTab onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function ModelSettingsTab({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
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
          if (config?.apiKey) {
            keys[id] = config.apiKey;
          }
        }
        setApiKeys(keys);
        setDefaultModel(settings.defaultModel ?? "");
      }
    });
  }, []);

  const modelProviders = Object.fromEntries(
    MODEL_PROVIDER_IDS.map((id) => [id, providers[id] ?? FALLBACK_MODEL_PROVIDERS[id]]),
  ) as Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig>;

  const buildSettings = (
    keys: Record<string, string> = apiKeys,
    model: string = defaultModel,
  ): AppSettings => {
    const providersSettings: Record<string, { apiKey: string } | undefined> = {};
    for (const id of MODEL_PROVIDER_IDS) {
      providersSettings[id] = { apiKey: (keys[id] ?? "").trim() };
    }
    return {
      providers: providersSettings,
      defaultModel: model,
    };
  };

  const saveSettings = async (
    keys: Record<string, string> = apiKeys,
    model: string = defaultModel,
  ) => {
    setSaving(true);
    setMessage(null);
    try {
      await electronAPI.saveSettings(buildSettings(keys, model));
      setMessage("saved");
    } catch {
      setMessage("error");
    }
    setSaving(false);
  };

  const handleConnect = async (id: string) => {
    if (!apiKeys[id]?.trim()) return;
    await saveSettings(apiKeys);
  };

  const handleDisconnect = async (id: string) => {
    const nextApiKeys = { ...apiKeys, [id]: "" };
    const nextDefaultModel =
      defaultModel && modelProviders[id as keyof typeof modelProviders]?.models.includes(defaultModel)
        ? ""
        : defaultModel;
    setApiKeys(nextApiKeys);
    setDefaultModel(nextDefaultModel);
    await saveSettings(nextApiKeys, nextDefaultModel);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">模型</TabsTrigger>
          </TabsList>
          <TabsContent value="models" className="mt-3">
            <FieldGroup>
              <DefaultModelField
                providers={modelProviders}
                apiKeys={apiKeys}
                value={defaultModel}
                onChange={setDefaultModel}
              />
            </FieldGroup>
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 text-sm font-medium">模型提供商</div>
              <div className="flex flex-col gap-2">
                {MODEL_PROVIDER_IDS.map((id) => (
                  <ModelProviderItem
                    key={id}
                    id={id}
                    config={modelProviders[id]}
                    apiKey={apiKeys[id] ?? ""}
                    onApiKeyChange={(value) => setApiKeys({ ...apiKeys, [id]: value })}
                    onConnect={() => handleConnect(id)}
                    onDisconnect={() => handleDisconnect(id)}
                  />
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter className="-mx-4 -mb-4 items-center border-t border-border bg-muted/30 px-4 py-3">
        {message === "saved" && (
          <span className="mr-auto text-xs text-muted-foreground">已保存</span>
        )}
        {message === "error" && (
          <span className="mr-auto text-xs text-destructive">保存失败</span>
        )}
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
        <Button onClick={() => saveSettings()} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ModelProviderItem({
  id,
  config,
  apiKey,
  onApiKeyChange,
  onConnect,
  onDisconnect,
}: {
  id: string;
  config: ProviderConfig;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const configured = apiKey.trim().length > 0;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{config.name}</div>
          <div className="text-xs text-muted-foreground">{config.envKey}</div>
        </div>
        <Badge variant={configured ? "secondary" : "outline"}>
          {configured ? "已提供 API Key" : "未连接"}
        </Badge>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          className="flex-1"
          placeholder={config.envKey}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          autoComplete={`off-${id}`}
        />
        {configured ? (
          <Button type="button" variant="outline" className="group min-w-20" onClick={onDisconnect}>
            <span className="group-hover:hidden">已连接</span>
            <span className="hidden group-hover:inline">断开连接</span>
          </Button>
        ) : (
          <Button type="button" className="min-w-20" onClick={onConnect} disabled={!apiKey.trim()}>
            连接
          </Button>
        )}
      </div>
    </div>
  );
}

function DefaultModelField({
  providers,
  apiKeys,
  value,
  onChange,
}: {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  const configuredProviders = Object.entries(providers).filter(([id]) => apiKeys[id]?.trim());

  return (
    <Field>
      <SectionTitle as={FieldLabel}>默认模型</SectionTitle>
      <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">-- 请选择 --</NativeSelectOption>
        {configuredProviders.map(([id, config]) => (
          <NativeSelectOptGroup key={id} label={config.name}>
            {config.models.map((model) => (
              <NativeSelectOption key={model} value={model}>
                {model}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
      {configuredProviders.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">请先配置 API Key</p>
      )}
    </Field>
  );
}

function SectionTitle({
  as: Component = "div",
  className,
  ...props
}: ComponentProps<"div"> & {
  as?: ElementType;
}) {
  return (
    <Component
      className={cn("mb-2 text-sm font-medium leading-none", className)}
      {...props}
    />
  );
}
