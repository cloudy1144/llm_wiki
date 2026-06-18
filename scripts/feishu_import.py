"""
飞书云文档导入脚本

从飞书知识库(wiki)空间或云空间(drive)文件夹中批量下载文档并保存为本地 markdown 文件，
供 llm_wiki 的摄取管线使用。

用法:
    # 从 wiki 空间 URL 导入
    python scripts/feishu_import.py --wiki-url "https://xxx.feishu.cn/wiki/space/123456"

    # 从云空间文件夹 URL 导入
    python scripts/feishu_import.py --wiki-url "https://xxx.feishu.cn/drive/folder/ABC123"

    # 指定输出目录
    python scripts/feishu_import.py --wiki-url "https://xxx.feishu.cn/xxx" --output-dir "./raw/sources/feishu"

    # 静默模式 + JSON 输出（供 Tauri 调用）
    python scripts/feishu_import.py --wiki-url "https://xxx.feishu.cn/xxx" --json

依赖: lark-cli (已安装并登录)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse


# ── 常量 ──────────────────────────────────────────────────────────────────

# 飞书知识库 URL 模式
WIKI_URL_PATTERNS = [
    re.compile(r"/wiki/(?:space/)?(\d+)"),           # /wiki/space/123456 或 /wiki/123456
    re.compile(r"/wiki/([A-Za-z0-9_-]+)"),           # /wiki/wikitoken
]

# 文档 URL 模式
DOCX_URL_PATTERN = re.compile(r"/docx/([A-Za-z0-9_-]+)")

# 有效的文档节点类型
DOC_NODE_TYPES = {"docx", "doc"}

# 文件名中需要替换的非法字符
ILLEGAL_FILENAME_CHARS = re.compile(r'[<>:"|?*\\/]')

# 单页最大节点数
PAGE_SIZE = 50


# ── 工具函数 ──────────────────────────────────────────────────────────────

def sanitize_filename(name: str, max_len: int = 120) -> str:
    """清理文件名，移除非法字符"""
    name = ILLEGAL_FILENAME_CHARS.sub("_", name)
    name = name.strip().strip(".")
    if not name:
        name = "untitled"
    if len(name) > max_len:
        name = name[:max_len].rstrip("_")
    return name


def run_larkcli(args: List[str], timeout: int = 120) -> Tuple[int, str, str]:
    """
    执行 lark-cli 命令并返回 (返回码, stdout, stderr)。
    超时默认 120 秒。
    """
    try:
        result = subprocess.run(
            ["lark-cli"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            shell=True,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"命令超时: lark-cli {' '.join(args)}"
    except FileNotFoundError:
        return -1, "", "lark-cli 未找到，请确认已安装"


def parse_json_output(stdout: str) -> Optional[Dict[str, Any]]:
    """解析 lark-cli 的 JSON 输出"""
    if not stdout:
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return None


def extract_wiki_token(url: str) -> Optional[str]:
    """从飞书知识库 URL 中提取 wiki token"""
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")

    for pattern in WIKI_URL_PATTERNS:
        match = pattern.search(path)
        if match:
            return match.group(1)
    return None


def inspect_url(url: str) -> Optional[Dict[str, str]]:
    """
    使用 lark-cli drive +inspect 自动识别飞书 URL 的类型和 token。
    支持 wiki、drive/folder、docx 等所有飞书文档 URL。
    """
    code, stdout, stderr = run_larkcli([
        "drive", "+inspect",
        "--url", url,
        "--as", "user",
    ])
    if code != 0:
        return None
    data = parse_json_output(stdout)
    if not data or not data.get("ok"):
        return None
    result = data.get("data", {})
    return {
        "type": result.get("type", ""),
        "token": result.get("token", ""),
        "title": result.get("title", ""),
    }


def resolve_space_id(wiki_token: str) -> Optional[str]:
    """
    通过 wiki token 解析 space_id。
    支持直接传 space_id 数字、wiki token、或 my_library。
    """
    # 如果是纯数字，可能就是 space_id
    if wiki_token.isdigit():
        return wiki_token

    # 如果是 my_library
    if wiki_token.lower() == "my_library":
        return "my_library"

    # 通过 get_node 解析
    code, stdout, stderr = run_larkcli([
        "wiki", "spaces", "get_node",
        "--params", json.dumps({"token": wiki_token}),
        "--format", "json",
        "--as", "user",
    ])

    if code != 0:
        print(f"[错误] 解析 space_id 失败: {stderr}", file=sys.stderr)
        return None

    data = parse_json_output(stdout)
    if not data or not data.get("ok"):
        print(f"[错误] 解析 space_id 失败: {stdout}", file=sys.stderr)
        return None

    space_id = data.get("data", {}).get("node", {}).get("space_id", "")
    if not space_id:
        print(f"[错误] 未能从响应中提取 space_id", file=sys.stderr)
        return None

    return str(space_id)


def list_nodes_recursive(
    space_id: str,
    parent_node_token: str = "",
) -> List[Dict[str, Any]]:
    """
    递归列出知识库中所有文档节点。
    返回只包含 docx/doc 类型的节点列表。
    """
    all_nodes: List[Dict[str, Any]] = []
    page_token = ""
    has_more = True

    while has_more:
        args = [
            "wiki", "+node-list",
            "--space-id", space_id,
            "--page-size", str(PAGE_SIZE),
            "--as", "user",
        ]
        if parent_node_token:
            args += ["--parent-node-token", parent_node_token]
        if page_token:
            args += ["--page-token", page_token]

        code, stdout, stderr = run_larkcli(args)
        if code != 0:
            print(f"[错误] 列出节点失败: {stderr}", file=sys.stderr)
            break

        data = parse_json_output(stdout)
        if not data or not data.get("ok"):
            print(f"[错误] 节点列表响应异常: {stdout}", file=sys.stderr)
            break

        nodes_data = data.get("data", {})
        nodes = nodes_data.get("nodes", [])

        for node in nodes:
            obj_type = node.get("obj_type", "")
            if obj_type in DOC_NODE_TYPES:
                all_nodes.append(node)

            # 递归子节点
            if node.get("has_child"):
                child_nodes = list_nodes_recursive(
                    space_id,
                    parent_node_token=node.get("node_token", ""),
                )
                all_nodes.extend(child_nodes)

        has_more = nodes_data.get("has_more", False)
        page_token = nodes_data.get("page_token", "")

    return all_nodes


def list_drive_files_recursive(folder_token: str) -> List[Dict[str, Any]]:
    """
    递归列出 drive 文件夹中所有 docx/doc 类型的文件。
    返回格式与 wiki 节点一致: [{"title": "...", "obj_token": "..."}, ...]
    自动递归子文件夹。
    """
    all_files: List[Dict[str, Any]] = []

    code, stdout, stderr = run_larkcli([
        "drive", "files", "list",
        "--folder-token", folder_token,
        "--page-all",
        "--as", "user",
    ], timeout=120)

    if code != 0:
        print(f"[错误] 列出文件夹失败: {stderr}", file=sys.stderr)
        return []

    data = parse_json_output(stdout)
    if not data or data.get("code") != 0:
        print(f"[错误] 文件夹列表响应异常: {stdout}", file=sys.stderr)
        return []

    files = data.get("data", {}).get("files", [])

    for f in files:
        file_type = f.get("type", "")
        if file_type in DOC_NODE_TYPES:
            all_files.append({
                "title": f.get("name", "untitled"),
                "obj_token": f.get("token", ""),
            })
        elif file_type == "folder":
            sub_files = list_drive_files_recursive(f.get("token", ""))
            all_files.extend(sub_files)

    return all_files


def fetch_doc_markdown(doc_token: str) -> Optional[str]:
    """
    获取飞书文档的 markdown 内容。
    使用 lark-cli docs +fetch --api-version v2 --doc-format markdown。
    """
    code, stdout, stderr = run_larkcli([
        "docs", "+fetch",
        "--api-version", "v2",
        "--doc", doc_token,
        "--doc-format", "markdown",
    ], timeout=300)

    if code != 0:
        print(f"[错误] 获取文档 {doc_token} 失败: {stderr}", file=sys.stderr)
        return None

    data = parse_json_output(stdout)
    if not data or not data.get("ok"):
        print(f"[错误] 文档 {doc_token} 响应异常: {stdout}", file=sys.stderr)
        return None

    content = data.get("data", {}).get("document", {}).get("content", "")
    return content


def save_doc(output_dir: str, title: str, content: str) -> str:
    """
    保存文档到指定目录。
    返回保存的完整文件路径。
    """
    safe_title = sanitize_filename(title)
    file_path = os.path.join(output_dir, f"{safe_title}.md")

    # 如果文件已存在，追加序号
    if os.path.exists(file_path):
        base = safe_title
        counter = 2
        while os.path.exists(file_path):
            file_path = os.path.join(output_dir, f"{base}_{counter}.md")
            counter += 1

    os.makedirs(output_dir, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    return os.path.abspath(file_path)


def import_wiki_space(
    wiki_url: str,
    output_dir: str,
    json_output: bool = False,
) -> List[str]:
    """
    主流程：导入飞书云文档。
    支持 wiki 知识库 URL 和 drive/folder 云空间文件夹 URL。

    参数:
        wiki_url: 飞书知识库 URL 或云空间文件夹 URL
        output_dir: 输出目录
        json_output: 是否以 JSON 格式输出结果

    返回:
        已保存的文件路径列表
    """
    saved_files: List[str] = []

    # 1. 识别 URL 类型并提取 token
    url_info = inspect_url(wiki_url)
    url_type = ""
    token = ""

    if url_info:
        url_type = url_info["type"]
        token = url_info["token"]
    else:
        # 兼容旧版：直接用正则提取 wiki token
        wiki_token = extract_wiki_token(wiki_url)
        if wiki_token:
            url_type = "wiki"
            token = wiki_token

    if not url_type or not token:
        msg = f"无法识别飞书 URL 类型或提取 token: {wiki_url}"
        if json_output:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
        else:
            print(f"[错误] {msg}", file=sys.stderr)
        return []

    if not json_output:
        print(f"[信息] URL 类型: {url_type}, token: {token}")

    # 2. 根据 URL 类型列出文档节点
    nodes: List[Dict[str, Any]] = []

    if url_type in ("folder",):
        # 云空间文件夹
        if not json_output:
            print(f"[信息] 正在列出云空间文件夹中的文档...")
        nodes = list_drive_files_recursive(token)
    else:
        # Wiki 知识库
        space_id = resolve_space_id(token)
        if not space_id:
            msg = "无法解析 space_id"
            if json_output:
                print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
            return []
        if not json_output:
            print(f"[信息] 解析到 space_id: {space_id}")

        if not json_output:
            print(f"[信息] 正在列出知识库文档...")
        nodes = list_nodes_recursive(space_id)

    if not nodes:
        msg = "未找到可导入的文档"
        if json_output:
            print(json.dumps({"ok": True, "files": [], "warning": msg}, ensure_ascii=False))
        else:
            print(f"[警告] {msg}")
        return []

    if not json_output:
        print(f"[信息] 找到 {len(nodes)} 个文档")

    # 4. 逐个获取并保存
    total = len(nodes)
    for i, node in enumerate(nodes):
        title = node.get("title", "untitled")
        obj_token = node.get("obj_token", "")
        if not json_output:
            print(f"[进度] ({i + 1}/{total}) 正在获取: {title}")

        content = fetch_doc_markdown(obj_token)
        if content is None:
            if not json_output:
                print(f"[警告] 跳过: {title} (获取失败)")
            continue

        # 添加元数据头
        header = f"---\n"
        header += f"title: \"{title}\"\n"
        header += f"source: \"feishu:{obj_token}\"\n"
        header += f"imported_at: \"{time.strftime('%Y-%m-%d %H:%M:%S')}\"\n"
        header += f"---\n\n"
        full_content = header + content

        saved_path = save_doc(output_dir, title, full_content)
        saved_files.append(saved_path)

        if not json_output:
            print(f"[完成] ({i + 1}/{total}) {title} → {saved_path}")

    if json_output:
        print(json.dumps({
            "ok": True,
            "files": saved_files,
            "count": len(saved_files),
            "total": total,
        }, ensure_ascii=False))
    else:
        print(f"\n[总结] 成功导入 {len(saved_files)}/{total} 个文档到 {output_dir}")

    return saved_files


# ── 命令行入口 ────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="从飞书知识库导入文档到本地",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--wiki-url",
        required=True,
        help="飞书知识库空间 URL 或云空间文件夹 URL",
    )
    parser.add_argument(
        "--output-dir",
        default="./raw/sources/feishu",
        help="输出目录 (默认: ./raw/sources/feishu)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式输出结果（供程序调用）",
    )

    args = parser.parse_args()
    import_wiki_space(
        wiki_url=args.wiki_url,
        output_dir=args.output_dir,
        json_output=args.json,
    )


if __name__ == "__main__":
    main()
