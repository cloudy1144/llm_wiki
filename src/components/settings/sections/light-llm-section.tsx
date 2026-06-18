import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const PROVIDER_OPTIONS: Array<{ value: SettingsDraft["lightLlmProvider"]; label: string }> = [
  { value: "custom", label: "Custom (OpenAI-compat)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "minimax", label: "MiniMax" },
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "codex-cli", label: "Codex CLI" },
]

const LIGHT_FEATURES = [
  "ingest",
  "wikilinks",
  "search",
  "optimize",
  "dedup",
  "test",
]

export function LightLlmSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.lightLlm.title", "Light LLM (成本优化)")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.sections.lightLlm.description",
            "为低复杂度的轻量任务指定廉价模型，降低 token 消耗。Wiki 生成、Wikilink 丰富化、搜索意图解析等任务将使用此模型，深度研究和审查等重型任务仍使用主力模型。",
          )}
        </p>
      </div>

      {/* 主开关 */}
      <div
        className={`flex items-center justify-between rounded-md border-2 p-3 transition-colors ${
          draft.lightLlmEnabled
            ? "border-green-500/40 bg-green-500/5"
            : "border-border bg-background"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {t("settings.sections.lightLlm.enableLabel", "启用轻量模型")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              "settings.sections.lightLlm.enableHint",
              "关闭时所有功能使用主力模型。开启后轻量任务自动路由到下方配置的廉价模型。",
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraft("lightLlmEnabled", !draft.lightLlmEnabled)}
          role="switch"
          aria-checked={draft.lightLlmEnabled}
          aria-label={t("settings.sections.lightLlm.enableLabel", "启用轻量模型")}
          className="ml-3 flex shrink-0 items-center gap-2"
        >
          <span
            className={`text-xs font-semibold ${
              draft.lightLlmEnabled ? "text-green-600" : "text-muted-foreground"
            }`}
          >
            {draft.lightLlmEnabled
              ? t("settings.sections.lightLlm.stateOn", "ON")
              : t("settings.sections.lightLlm.stateOff", "OFF")}
          </span>
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              draft.lightLlmEnabled ? "bg-green-600" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                draft.lightLlmEnabled ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {draft.lightLlmEnabled && (
        <>
          {/* 当前激活的轻量模型信息 */}
          {draft.lightLlmModel && (
            <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.sections.lightLlm.activeModel", "当前使用")}:
              </span>
              <code className="rounded bg-green-500/20 px-1.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">
                {draft.lightLlmProvider}/{draft.lightLlmModel}
              </code>
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
          )}

          {/* 轻量功能标签展示 */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">
              {t("settings.sections.lightLlm.featuresHeading", "使用轻量模型的功能")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LIGHT_FEATURES.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center rounded-md bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700"
                >
                  {t(`settings.sections.lightLlm.feature.${f}`, f)}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.sections.lightLlm.featuresHint",
                "Wiki 生成 · Wikilink 丰富化 · 搜索意图解析 · 研究主题优化 · 去重分析 · 连接测试",
              )}
            </p>
          </div>

          {/* 独立端点配置 */}
          <div className="space-y-4 rounded-md border p-3">
            <div className="text-sm font-medium">
              {t("settings.sections.lightLlm.dedicatedHeading", "轻量模型配置")}
            </div>

            <div className="space-y-2">
              <Label>{t("settings.sections.lightLlm.provider", "提供商")}</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.lightLlmProvider}
                onChange={(e) =>
                  setDraft("lightLlmProvider", e.target.value as SettingsDraft["lightLlmProvider"])
                }
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {draft.lightLlmProvider === "ollama" && (
              <div className="space-y-2">
                <Label>{t("settings.sections.lightLlm.ollamaUrl", "Ollama URL")}</Label>
                <Input
                  value={draft.lightLlmOllamaUrl}
                  onChange={(e) => setDraft("lightLlmOllamaUrl", e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            {(draft.lightLlmProvider === "custom" || draft.lightLlmProvider === "azure") && (
              <div className="space-y-2">
                <Label>
                  {draft.lightLlmProvider === "azure"
                    ? t("settings.sections.lightLlm.azureEndpoint", "Azure endpoint")
                    : t("settings.sections.lightLlm.customEndpoint", "端点 URL")}
                </Label>
                <Input
                  value={draft.lightLlmCustomEndpoint}
                  onChange={(e) => setDraft("lightLlmCustomEndpoint", e.target.value)}
                  placeholder={
                    draft.lightLlmProvider === "azure"
                      ? "https://your-resource.openai.azure.com"
                      : "https://api.openai.com/v1"
                  }
                />
              </div>
            )}

            {draft.lightLlmProvider === "azure" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("settings.sections.lightLlm.azureApiVersion")}</Label>
                  <Input
                    value={draft.lightLlmAzureApiVersion}
                    onChange={(e) => setDraft("lightLlmAzureApiVersion", e.target.value)}
                    placeholder="2024-10-21"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("settings.sections.lightLlm.azureModelFamily")}</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={draft.lightLlmAzureModelFamily}
                    onChange={(e) => setDraft("lightLlmAzureModelFamily", e.target.value as typeof draft.lightLlmAzureModelFamily)}
                  >
                    <option value="auto">Auto</option>
                    <option value="gpt5">GPT-5 / o-series</option>
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("settings.sections.lightLlm.apiKey", "API Key")}</Label>
              <Input
                type="password"
                value={draft.lightLlmApiKey}
                onChange={(e) => setDraft("lightLlmApiKey", e.target.value)}
                placeholder={t(
                  "settings.sections.lightLlm.apiKeyPlaceholder",
                  "留空使用本地/无认证端点",
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("settings.sections.lightLlm.model", "模型")}</Label>
              <Input
                value={draft.lightLlmModel}
                onChange={(e) => setDraft("lightLlmModel", e.target.value)}
                placeholder="e.g. glm-4-flash, deepseek-v4-flash, gpt-4o-mini"
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "settings.sections.lightLlm.modelHint",
                  "推荐使用廉价模型：glm-4-flash / deepseek-v4-flash / gpt-4o-mini / gemini-2.5-flash",
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                {t("settings.sections.lightLlm.maxContextSize", "最大上下文窗口 (字符数)")}
              </Label>
              <Input
                type="number"
                min={4096}
                step={4096}
                value={draft.lightLlmMaxContextSize}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setDraft("lightLlmMaxContextSize", Number.isFinite(n) && n >= 4096 ? n : 131072)
                }}
              />
            </div>
          </div>

          {/* 成本节省提示 */}
          <div className="space-y-1 rounded-md border border-green-500/40 bg-green-500/5 p-3">
            <div className="text-sm font-medium text-green-700 dark:text-green-400">
              {t("settings.sections.lightLlm.costHeading", "预估成本节省")}
            </div>
            <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
              <li>
                {t(
                  "settings.sections.lightLlm.costPoint1",
                  "Wiki 生成单次约 2K tokens（vs 主力模型 ~15K），节省约 87%",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.lightLlm.costPoint2",
                  "Wikilink 丰富化每次仅 ~300 tokens，批量处理几乎零成本",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.lightLlm.costPoint3",
                  "深度研究、审查、Lint 检查等重型任务仍使用主力模型，确保质量",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.lightLlm.costPoint4",
                  "轻量模型不支持推理模式 (reasoning)，所有推理相关参数将被忽略",
                )}
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
