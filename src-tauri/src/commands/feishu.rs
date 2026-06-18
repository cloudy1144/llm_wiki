/// 飞书文档导入命令模块。
///
/// 通过调用 Python 脚本 `scripts/feishu_import.py` 实现飞书文档导入。
/// 支持 wiki 知识库 URL 和 drive/folder 云空间文件夹 URL。
/// 前端通过 Tauri IPC 调用 `feishu_import` 命令触发导入流程。

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::panic_guard::run_guarded;

/// 飞书文档导入结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuImportResult {
    /// 是否成功
    pub ok: bool,
    /// 成功导入的文件路径列表
    #[serde(default)]
    pub files: Vec<String>,
    /// 成功导入的数量
    #[serde(default)]
    pub count: usize,
    /// 知识库中的文档总数
    #[serde(default)]
    pub total: usize,
    /// 错误信息
    #[serde(default)]
    pub error: String,
    /// 警告信息
    #[serde(default)]
    pub warning: String,
}

/// 查找 Python 解释器路径。
///
/// 优先使用当前虚拟环境中的 python，其次用系统路径中的 python3/python。
fn find_python() -> Option<String> {
    // 检查常见 python 命令
    for cmd in &["python", "python3"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

/// 查找项目根目录中的 feishu_import.py 脚本。
///
/// 从 Cargo manifest 目录开始向上查找。
fn find_script() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // 开发模式：在项目根目录的 scripts/ 下
    let candidates = vec![
        manifest_dir.join("..").join("scripts").join("feishu_import.py"),
        manifest_dir.join("scripts").join("feishu_import.py"),
    ];

    for candidate in &candidates {
        if candidate.is_file() {
            return Some(candidate.canonicalize().unwrap_or_else(|_| candidate.clone()));
        }
    }

    None
}

/// 执行飞书文档导入。
///
/// # 参数
/// - `wiki_url`: 飞书知识库空间 URL 或云空间文件夹 URL
/// - `project_path`: 项目根目录路径（输出目录将在此路径下）
/// - `output_subdir`: 输出子目录，相对于项目根目录（默认: "raw/sources/feishu"）
#[tauri::command]
pub async fn feishu_import(
    wiki_url: String,
    project_path: String,
    output_subdir: Option<String>,
) -> Result<FeishuImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("feishu_import", || {
            let python = find_python()
                .ok_or("未找到 Python 解释器，请确认已安装 Python".to_string())?;
            let script = find_script()
                .ok_or("未找到 feishu_import.py 脚本".to_string())?;

            let subdir = output_subdir.unwrap_or_else(|| "raw/sources/feishu".to_string());
            let output_dir = PathBuf::from(&project_path).join(&subdir);
            let output_dir_str = output_dir.to_string_lossy().to_string();

            eprintln!(
                "[feishu_import] 执行: {} {} --wiki-url {} --output-dir {} --json",
                python,
                script.display(),
                wiki_url,
                output_dir_str,
            );

            let output = Command::new(&python)
                .arg(script.to_string_lossy().to_string())
                .arg("--wiki-url")
                .arg(&wiki_url)
                .arg("--output-dir")
                .arg(&output_dir_str)
                .arg("--json")
                .output()
                .map_err(|e| format!("执行 Python 脚本失败: {e}"))?;

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            if !stderr.is_empty() {
                eprintln!("[feishu_import] stderr: {}", stderr);
            }

            if stdout.is_empty() {
                return Err(format!(
                    "Python 脚本无输出。exit_code={}, stderr={}",
                    output.status.code().unwrap_or(-1),
                    stderr,
                ));
            }

            // 尝试解析 JSON 输出
            match serde_json::from_str::<FeishuImportResult>(&stdout) {
                Ok(result) => Ok(result),
                Err(parse_err) => {
                    eprintln!(
                        "[feishu_import] JSON 解析失败: {}. stdout={}",
                        parse_err, stdout,
                    );
                    // 作为兜底，返回一个包含原始输出的结果
                    Ok(FeishuImportResult {
                        ok: output.status.success(),
                        files: vec![],
                        count: 0,
                        total: 0,
                        error: format!("无法解析脚本输出: {}", parse_err),
                        warning: String::new(),
                    })
                }
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
