import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { open } from "@tauri-apps/plugin-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Folder, Cloud, Trash2, Plus, Play, RefreshCw, X, Check } from "lucide-react"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { ScheduledImportPath } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import {
  isProjectManagedScheduledImportPath,
  resolveImportPath,
  scanAndImport,
} from "@/lib/scheduled-import"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/** 生成唯一 ID */
function generateId(): string {
  return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ScheduledImportSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const scheduledImportConfig = useWikiStore((s) => s.scheduledImportConfig)
  const [isScanning, setIsScanning] = useState(false)
  const [isAdding, setIsAdding] = useState(false)

  // 新增表单状态
  const [newType, setNewType] = useState<ScheduledImportPath["type"]>("local")
  const [newPath, setNewPath] = useState("")
  const [newLabel, setNewLabel] = useState("")

  const paths = draft.scheduledImportPaths || []

  // ── 添加路径 ─────────────────────────────────────────────────────

  const handleSelectLocalDir = async () => {
    const selected = await open({
      directory: true,
      title: t("settings.sections.scheduledImport.selectDirectory", {
        defaultValue: "Select Directory to Monitor",
      }),
    })
    if (selected && typeof selected === "string") {
      setNewPath(selected)
    }
  }

  const handleConfirmAdd = useCallback(() => {
    if (!newPath.trim()) return
    const newItem: ScheduledImportPath = {
      id: generateId(),
      path: newPath.trim(),
      type: newType,
      label: newLabel.trim() || undefined,
    }
    setDraft("scheduledImportPaths", [...paths, newItem])
    setNewPath("")
    setNewLabel("")
    setNewType("local")
    setIsAdding(false)
  }, [newPath, newType, newLabel, paths, setDraft])

  const handleCancelAdd = () => {
    setNewPath("")
    setNewLabel("")
    setNewType("local")
    setIsAdding(false)
  }

  const handleDeletePath = useCallback(
    (id: string) => {
      setDraft(
        "scheduledImportPaths",
        paths.filter((p) => p.id !== id),
      )
    },
    [paths, setDraft],
  )

  // ── 手动扫描 ─────────────────────────────────────────────────────

  const handleManualScan = useCallback(async () => {
    if (!project || isScanning) return
    setIsScanning(true)
    try {
      for (const p of paths) {
        if (p.type === "local") {
          await scanAndImport(project, p.path)
        }
        // feishu 路径不在此手动触发（会调用 Rust 命令，较慢）
      }
    } catch (err) {
      console.error("[Scheduled Import] Manual scan failed:", err)
    } finally {
      setIsScanning(false)
    }
  }, [project, paths, isScanning])

  const hasLocalPath = paths.some((p) => p.type === "local" && p.path)
  const lastScanDate = scheduledImportConfig.lastScan
    ? new Date(scheduledImportConfig.lastScan).toLocaleString()
    : t("settings.sections.scheduledImport.never", { defaultValue: "Never" })

  // ── 渲染各路径项 ─────────────────────────────────────────────────

  const renderPathItem = (item: ScheduledImportPath) => {
    const isLocal = item.type === "local"
    const isManaged =
      isLocal &&
      project &&
      item.path &&
      isProjectManagedScheduledImportPath(
        project.path,
        resolveImportPath(project.path, item.path),
      )

    return (
      <div key={item.id} className="space-y-1">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
          {isLocal ? (
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Cloud className="h-4 w-4 shrink-0 text-blue-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{item.path}</p>
            {item.label && (
              <p className="text-xs text-muted-foreground">{item.label}</p>
            )}
          </div>
          <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
            {isLocal ? "Local" : "Feishu"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => handleDeletePath(item.id)}
            disabled={!draft.scheduledImportEnabled}
            title={t("settings.sections.scheduledImport.deletePath", {
              defaultValue: "Delete path",
            })}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
        {isManaged && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            {t("settings.sections.scheduledImport.managedPathWarning", {
              defaultValue:
                "This path is inside the current LLM Wiki project and is already managed by source folder monitoring. Pick an external folder to avoid duplicate scans.",
            })}
          </p>
        )}
      </div>
    )
  }

  // ── 渲染 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.scheduledImport.title", {
            defaultValue: "Scheduled Import",
          })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.scheduledImport.description", {
            defaultValue:
              "Automatically monitor directories and import new or modified files at regular intervals.",
          })}
        </p>
      </div>

      {/* 启用开关 */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.scheduledImportEnabled}
          onChange={(e) => setDraft("scheduledImportEnabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          {t("settings.sections.scheduledImport.enable", {
            defaultValue: "Enable scheduled import",
          })}
        </span>
      </label>

      {/* 隐私提示 */}
      {draft.scheduledImportEnabled && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t("settings.sections.scheduledImport.privacyNotice", {
            defaultValue:
              "Files from the selected directory may be copied into this project and sent to your configured LLM during ingest. Removed files are not automatically deleted from the project.",
          })}
        </div>
      )}

      {/* 路径列表 */}
      <div className="space-y-2">
        <Label>
          {t("settings.sections.scheduledImport.directories", {
            defaultValue: "Monitor Paths",
          })}
        </Label>

        {/* 已有路径 */}
        {paths.length > 0 && (
          <div className="space-y-2">{paths.map(renderPathItem)}</div>
        )}

        {paths.length === 0 && draft.scheduledImportEnabled && (
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.scheduledImport.noPaths", {
              defaultValue: "No paths configured. Click \"Add\" to add a directory or Feishu URL.",
            })}
          </p>
        )}

        {/* 新增表单 */}
        {isAdding ? (
          <div className="space-y-2 rounded-md border p-3">
            {/* 类型选择 */}
            <div className="flex gap-2">
              <Button
                variant={newType === "local" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewType("local")}
              >
                <Folder className="mr-1 h-3.5 w-3.5" />
                {t("settings.sections.scheduledImport.localDir", {
                  defaultValue: "Local Directory",
                })}
              </Button>
              <Button
                variant={newType === "feishu" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewType("feishu")}
              >
                <Cloud className="mr-1 h-3.5 w-3.5" />
                {t("settings.sections.scheduledImport.feishuUrl", {
                  defaultValue: "Feishu URL",
                })}
              </Button>
            </div>

            {/* 路径输入 */}
            {newType === "local" ? (
              <div className="flex gap-2">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder={t("settings.sections.scheduledImport.pathPlaceholder", {
                    defaultValue: "C:\\Users\\... or /home/...",
                  })}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleSelectLocalDir}
                  title={t("settings.sections.scheduledImport.browse", { defaultValue: "Browse" })}
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="https://xxx.feishu.cn/drive/folder/..."
                className="flex-1"
              />
            )}

            {/* 可选标签 */}
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("settings.sections.scheduledImport.labelOptional", {
                defaultValue: "Label (optional)",
              })}
            />

            {/* 确认/取消 */}
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleConfirmAdd}
                disabled={!newPath.trim()}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                {t("settings.sections.scheduledImport.confirmAdd", {
                  defaultValue: "Add",
                })}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancelAdd}>
                <X className="mr-1 h-3.5 w-3.5" />
                {t("settings.sections.scheduledImport.cancelAdd", {
                  defaultValue: "Cancel",
                })}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAdding(true)}
            disabled={!draft.scheduledImportEnabled}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("settings.sections.scheduledImport.addPath", {
              defaultValue: "Add Path",
            })}
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.directoryHelp", {
            defaultValue:
              "Add external folders or Feishu document URLs. Files will be imported according to the scan interval below.",
          })}
        </p>
      </div>

      {/* 扫描间隔 */}
      <div className="space-y-2">
        <Label htmlFor="scheduled-import-interval">
          {t("settings.sections.scheduledImport.interval", {
            defaultValue: "Scan Interval (minutes)",
          })}
        </Label>
        <Input
          id="scheduled-import-interval"
          type="number"
          min={1}
          max={1440}
          value={draft.scheduledImportInterval}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (!isNaN(val) && val >= 1) {
              setDraft("scheduledImportInterval", val)
            }
          }}
          disabled={!draft.scheduledImportEnabled}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.intervalHelp", {
            defaultValue: "How often to check for changes. Minimum: 1 minute.",
          })}
        </p>
      </div>

      {/* 手动扫描 + 上次扫描时间 */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualScan}
          disabled={!draft.scheduledImportEnabled || !hasLocalPath || isScanning}
        >
          {isScanning ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isScanning
            ? t("settings.sections.scheduledImport.scanning", { defaultValue: "Scanning..." })
            : t("settings.sections.scheduledImport.scanNow", { defaultValue: "Scan Now" })}
        </Button>

        <span className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.lastScan", {
            defaultValue: "Last scan: {{time}}",
            time: lastScanDate,
          })}
        </span>
      </div>
    </div>
  )
}
