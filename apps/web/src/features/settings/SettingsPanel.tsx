import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { loadLLMSettings, saveLLMSettings } from "../../shared/api/llmSettings";

interface Props {
  onBack: () => void;
}

export function SettingsPanel({ onBack }: Props) {
  const initial = useMemo(() => loadLLMSettings(), []);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1200);
    return () => clearTimeout(timer);
  }, [saved]);

  const canSave = baseURL.trim().length > 0 && apiKey.trim().length > 0;

  const handleSave = () => {
    saveLLMSettings({
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
    });
    setSaved(true);
  };

  return (
    <section className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">LLM Settings</h2>
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Base URL</label>
          <Input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://api.openai.com/v1"
            aria-label="Base URL"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">API Key</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            aria-label="API Key"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
          {saved && <span className="text-xs text-green-600">Saved</span>}
        </div>
      </div>
    </section>
  );
}
