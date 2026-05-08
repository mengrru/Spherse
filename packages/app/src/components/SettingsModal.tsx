import { useState, useEffect } from "react";

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
    <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-surface rounded-[10px] w-[480px] max-h-[80vh] flex flex-col shadow-[var(--shadow-dialog)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="text-base font-semibold text-[var(--primary)]">设置</h2>
          <button className="bg-none text-lg text-[var(--muted)] p-1 hover:text-[var(--primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5 last:mb-0">
            <h3 className="text-[13px] font-semibold text-[var(--on-muted)] mb-2.5">API 配置</h3>
            {Object.entries(providers).map(([id, config]) => (
              <div key={id} className="mb-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[13px] font-medium">{config.name}</span>
                  <span
                    className={`w-2 h-2 rounded-full inline-block ${apiKeys[id]?.trim() ? "bg-success" : "bg-[var(--border)]"}`}
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    type={showKeys[id] ? "text" : "password"}
                    className="flex-1 px-2.5 py-1.5 border border-[var(--border-input)] rounded-[5px] outline-none text-[13px] bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
                    placeholder={config.envKey}
                    value={apiKeys[id] ?? ""}
                    onChange={(e) =>
                      setApiKeys({ ...apiKeys, [id]: e.target.value })
                    }
                  />
                  <button
                    className="px-2.5 py-1.5 bg-[var(--muted-bg)] rounded-[5px] text-xs text-[var(--secondary)] whitespace-nowrap hover:bg-[var(--hover-strong)]"
                    onClick={() =>
                      setShowKeys({ ...showKeys, [id]: !showKeys[id] })
                    }
                  >
                    {showKeys[id] ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mb-5 last:mb-0">
            <h3 className="text-[13px] font-semibold text-[var(--on-muted)] mb-2.5">默认模型</h3>
            <select
              className="w-full px-2.5 py-2 border border-[var(--border-input)] rounded-[5px] text-[13px] outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            >
              <option value="">-- 请选择 --</option>
              {Object.entries(providers)
                .filter(([id]) => apiKeys[id]?.trim())
                .map(([id, config]) => (
                  <optgroup key={id} label={config.name}>
                    {config.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
            {Object.entries(providers).filter(([id]) => apiKeys[id]?.trim()).length === 0 && (
              <p className="text-xs text-[var(--muted)] mt-1.5">请先配置 API Key</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-light)]">
          {message === "saved" && (
            <span className="text-success text-[13px] mr-auto">已保存</span>
          )}
          {message === "error" && (
            <span className="text-danger text-[13px] mr-auto">保存失败</span>
          )}
          <button className="px-4 py-1.5 bg-[var(--muted-bg)] rounded-[5px] text-[13px] text-[var(--on-muted)] hover:bg-[var(--border)]" onClick={onClose}>
            关闭
          </button>
          <button
            className="px-4 py-1.5 bg-accent text-white rounded-[5px] text-[13px] hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
