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
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>设置</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div className="settings-section">
            <h3 className="settings-section-title">API 配置</h3>
            {Object.entries(providers).map(([id, config]) => (
              <div key={id} className="settings-provider-row">
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{config.name}</span>
                  <span
                    className={`settings-status-dot ${apiKeys[id]?.trim() ? "settings-status-ok" : "settings-status-none"}`}
                  />
                </div>
                <div className="settings-key-input-wrap">
                  <input
                    type={showKeys[id] ? "text" : "password"}
                    className="settings-key-input"
                    placeholder={config.envKey}
                    value={apiKeys[id] ?? ""}
                    onChange={(e) =>
                      setApiKeys({ ...apiKeys, [id]: e.target.value })
                    }
                  />
                  <button
                    className="settings-toggle-key"
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
          <div className="settings-section">
            <h3 className="settings-section-title">默认模型</h3>
            <select
              className="settings-model-select"
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
              <p className="settings-hint">请先配置 API Key</p>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          {message === "saved" && (
            <span className="settings-save-ok">已保存</span>
          )}
          {message === "error" && (
            <span className="settings-save-error">保存失败</span>
          )}
          <button className="dialog-btn-cancel" onClick={onClose}>
            关闭
          </button>
          <button
            className="dialog-btn-submit"
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
