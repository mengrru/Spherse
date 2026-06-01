import { useEffect } from "react";
import type { ComponentProps, ElementType } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../../components/ui/native-select";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "./store";
import { MODEL_PROVIDER_IDS, type ProviderConfig, type SettingsApi } from "./types";

interface SettingsModalProps {
  onClose: () => void;
}

const electronAPI = (window as unknown as { electronAPI: SettingsApi }).electronAPI;

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
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const saving = useSettingsStore((state) => state.saving);
  const message = useSettingsStore((state) => state.message);
  const load = useSettingsStore((state) => state.load);
  const setApiKey = useSettingsStore((state) => state.setApiKey);
  const setDefaultModel = useSettingsStore((state) => state.setDefaultModel);
  const save = useSettingsStore((state) => state.save);
  const connect = useSettingsStore((state) => state.connect);
  const disconnect = useSettingsStore((state) => state.disconnect);
  const modelProviders = useSettingsStore((state) => state.getModelProviders());

  useEffect(() => {
    void load(electronAPI);
  }, [load]);

  const handleConnect = async (id: string) => {
    await connect(electronAPI, id);
  };

  const handleDisconnect = async (id: string) => {
    await disconnect(electronAPI, id);
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
                    onApiKeyChange={(value) => setApiKey(id, value)}
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
        <Button onClick={() => save(electronAPI)} disabled={saving}>
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
