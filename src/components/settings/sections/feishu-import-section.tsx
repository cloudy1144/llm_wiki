import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Download, RefreshCw, CheckCircle, AlertCircle } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"

/** 飞书导入结果 */
interface FeishuImportResult {
  ok: boolean
  files: string[]
  count: number
  total: number
  error: string
  warning: string
}

export function FeishuImportSection() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)

  const [wikiUrl, setWikiUrl] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<FeishuImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleImport = useCallback(async () => {
    if (!project || !wikiUrl.trim() || isImporting) return

    setIsImporting(true)
    setError(null)
    setResult(null)

    try {
      const res = await invoke<FeishuImportResult>("feishu_import", {
        wikiUrl: wikiUrl.trim(),
        projectPath: project.path,
      })
      setResult(res)
      if (!res.ok) {
        setError(res.error || t("settings.sections.feishuImport.importFailed"))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setIsImporting(false)
    }
  }, [project, wikiUrl, isImporting, t])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.feishuImport.title", { defaultValue: "Feishu Import" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.feishuImport.description", {
            defaultValue:
              "Import documents from a Feishu Wiki space. Documents are saved as markdown files and then processed by the ingest pipeline.",
          })}
        </p>
      </div>

      {/* 说明信息 */}
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        {t("settings.sections.feishuImport.prerequisite", {
          defaultValue:
            "Requires lark-cli to be installed and authenticated. Run `lark-cli auth login` in terminal first if not yet logged in.",
        })}
      </div>

      {/* URL 输入 */}
      <div className="space-y-2">
        <Label htmlFor="feishu-wiki-url">
          {t("settings.sections.feishuImport.wikiUrl", { defaultValue: "Wiki Space URL" })}
        </Label>
        <div className="flex gap-2">
          <Input
            id="feishu-wiki-url"
            value={wikiUrl}
            onChange={(e) => {
              setWikiUrl(e.target.value)
              setError(null)
              setResult(null)
            }}
            placeholder="https://xxx.feishu.cn/wiki/space/123456"
            disabled={isImporting}
            className="flex-1"
          />
          <Button
            variant="default"
            onClick={handleImport}
            disabled={!wikiUrl.trim() || isImporting || !project}
          >
            {isImporting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isImporting
              ? t("settings.sections.feishuImport.importing", { defaultValue: "Importing..." })
              : t("settings.sections.feishuImport.importNow", { defaultValue: "Import Now" })}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.feishuImport.urlHelp", {
            defaultValue:
              "Paste the URL of a Feishu Wiki space. All documents in the space will be downloaded.",
          })}
        </p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 结果展示 */}
      {result && result.ok && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {t("settings.sections.feishuImport.importSuccess", {
                defaultValue: `Successfully imported {{count}} of {{total}} documents`,
                count: result.count,
                total: result.total,
              })}
            </span>
          </div>
          {result.warning && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{result.warning}</p>
          )}
          {result.files.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">
                {t("settings.sections.feishuImport.importedFiles", {
                  defaultValue: `{{count}} imported files`,
                  count: result.files.length,
                })}
              </summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs space-y-0.5 pl-4 list-disc">
                {result.files.map((file, i) => (
                  <li key={i} className="break-all">{file}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
