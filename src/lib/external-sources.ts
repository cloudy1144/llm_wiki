/**
 * 免费外部信息源 API 接口
 *
 * - Wikipedia  — 概念定义 / 知识卡片
 * - arXiv      — 最新研究预印本
 * - OpenAlex   — 学术论文 / 作者 / 机构
 * - Semantic Scholar — 学术论文（含引用图谱）
 * - CrossRef   — 学术论文 DOI 查询
 *
 * 以上 API 均为免费，无需 API Key（Semantic Scholar 可选 Key 提高速率）。
 */

import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"

// ─── 通用返回类型 ───────────────────────────────────────────────────────────

export interface ExternalSourceResult {
  title: string
  url: string
  snippet: string
  source: string
  /** 附加元数据（如日期、作者、DOI 等） */
  metadata?: Record<string, string>
}

export interface WikipediaExtract {
  title: string
  url: string
  extract: string    // 摘要全文
  pageId: number
  thumbnail?: string
  description?: string
}

export interface ArxivPaper {
  title: string
  url: string
  summary: string
  authors: string[]
  published: string   // ISO 日期
  updated: string
  pdfUrl: string
  doi?: string
  categories: string[]
}

export interface AcademicPaper {
  title: string
  url: string
  snippet: string
  authors: string[]
  year?: number
  doi?: string
  citationCount?: number
  source: string       // "openalex" | "semantic_scholar" | "crossref"
}

// ─── Wikipedia ──────────────────────────────────────────────────────────────

/**
 * 搜索 Wikipedia 文章（中文维基）。
 * 免费，无需 API Key。
 */
export async function wikipediaSearch(
  query: string,
  language: "zh" | "en" = "zh",
  maxResults: number = 5,
): Promise<ExternalSourceResult[]> {
  // 使用 opensearch 接口获取搜索结果列表
  const baseUrl = `https://${language}.wikipedia.org/w/api.php`
  const params = new URLSearchParams({
    action: "opensearch",
    search: query,
    limit: String(maxResults),
    namespace: "0",
    format: "json",
    origin: "*",
  })

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(`${baseUrl}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`Wikipedia API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`Wikipedia 搜索失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as [string, string[], string[], string[]]
  const titles = data[1] ?? []
  const descriptions = data[2] ?? []
  const urls = data[3] ?? []

  return titles.slice(0, maxResults).map((title, i) => ({
    title,
    url: urls[i] ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    snippet: descriptions[i] ?? "",
    source: `Wikipedia (${language})`,
  }))
}

/**
 * 获取 Wikipedia 页面摘要/定义（extract）。
 * 适合获取概念定义。
 */
export async function wikipediaExtract(
  title: string,
  language: "zh" | "en" = "zh",
): Promise<WikipediaExtract> {
  const baseUrl = `https://${language}.wikipedia.org/w/api.php`
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts|pageimages|description",
    exintro: "1",
    explaintext: "1",
    piprop: "thumbnail",
    pithumbsize: "300",
    format: "json",
    origin: "*",
  })

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(`${baseUrl}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`Wikipedia API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`Wikipedia 页面获取失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    query?: {
      pages?: Record<string, {
        pageid?: number
        title?: string
        extract?: string
        description?: string
        thumbnail?: { source?: string }
      }>
    }
  }

  const pages = data.query?.pages ?? {}
  const page = Object.values(pages)[0]

  if (!page || page.pageid === -1 || page.pageid === undefined) {
    const searchResults = await wikipediaSearch(title, language, 1)
    if (searchResults.length > 0) {
      return wikipediaExtract(searchResults[0].title, language)
    }
    throw new Error(`Wikipedia 上未找到页面: "${title}"`)
  }

  const pageTitle = page.title ?? title

  return {
    title: pageTitle,
    url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
    extract: page.extract ?? "",
    pageId: page.pageid ?? 0,
    thumbnail: page.thumbnail?.source,
    description: page.description,
  }
}

// ─── arXiv ──────────────────────────────────────────────────────────────────

/**
 * 搜索 arXiv 学术预印本。
 * 免费，无需 API Key。速率限制：单 IP 每秒 1 次（burst 4 次）。
 */
export async function arxivSearch(
  query: string,
  maxResults: number = 10,
): Promise<ArxivPaper[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: "relevance",
  })

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(
      `https://export.arxiv.org/api/query?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/atom+xml" },
      },
    )
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`arXiv API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`arXiv 搜索失败 (${response.status}): ${errorText}`)
  }

  const xmlText = await response.text()
  return parseArxivAtom(xmlText)
}

/**
 * 按分类搜索最新 arXiv 论文（如 cs.AI, stat.ML）。
 */
export async function arxivLatestByCategory(
  category: string,
  maxResults: number = 10,
): Promise<ArxivPaper[]> {
  return arxivSearch(`cat:${category}`, maxResults)
}

function parseArxivAtom(xml: string): ArxivPaper[] {
  // 简单的 XML 解析，避免引入额外依赖
  const papers: ArxivPaper[] = []
  const entries = xml.split("<entry>").slice(1)

  for (const entry of entries) {
    const entryEnd = entry.indexOf("</entry>")
    const content = entryEnd > 0 ? entry.slice(0, entryEnd) : entry

    const getTag = (tag: string): string => {
      const open = `<${tag}>`
      const close = `</${tag}>`
      const openIdx = content.indexOf(open)
      if (openIdx < 0) return ""
      const closeIdx = content.indexOf(close, openIdx + open.length)
      if (closeIdx < 0) return ""
      return content.slice(openIdx + open.length, closeIdx).trim()
    }

    const getTags = (tag: string): string[] => {
      const result: string[] = []
      const open = `<${tag}>`
      const close = `</${tag}>`
      let searchFrom = 0
      while (true) {
        const openIdx = content.indexOf(open, searchFrom)
        if (openIdx < 0) break
        const closeIdx = content.indexOf(close, openIdx + open.length)
        if (closeIdx < 0) break
        result.push(content.slice(openIdx + open.length, closeIdx).trim())
        searchFrom = closeIdx + close.length
      }
      return result
    }

    const title = getTag("title").replace(/\s+/g, " ")
    const summary = getTag("summary").replace(/\s+/g, " ")
    const published = getTag("published").replace("T", " ").replace("Z", "")
    const updated = getTag("updated").replace("T", " ").replace("Z", "")

    // 作者
    const authors = getTags("name").map((n) => n.trim()).filter(Boolean)

    // id → URL
    let arxivId = getTag("id")
    if (arxivId.startsWith("http://arxiv.org/abs/")) {
      arxivId = arxivId.replace("http://arxiv.org/abs/", "")
    }
    const url = `https://arxiv.org/abs/${arxivId}`
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}`

    // 分类
    const categoryTerms = getTags("category")
    const categories = categoryTerms
      .map((raw) => {
        const m = /term="([^"]+)"/.exec(raw)
        return m?.[1] ?? ""
      })
      .filter(Boolean)

    // DOI
    let doi: string | undefined
    for (const link of getTags("link")) {
      const m = /title="doi"\s+href="([^"]+)"/.exec(link)
      if (m?.[1]) {
        doi = m[1]
        break
      }
    }

    if (title && arxivId) {
      papers.push({
        title,
        url,
        summary: summary || "",
        authors,
        published,
        updated,
        pdfUrl,
        doi,
        categories,
      })
    }
  }

  return papers
}

// ─── OpenAlex ───────────────────────────────────────────────────────────────

/**
 * 搜索 OpenAlex 学术论文。
 * 免费，无需 API Key。礼貌池（polite pool）速率限制：每秒 ~10 次。
 *
 * 如果提供 email 参数，OpenAlex 会将该请求路由到更快的 polite pool。
 */
export async function openAlexSearch(
  query: string,
  maxResults: number = 10,
  email?: string,
): Promise<AcademicPaper[]> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(maxResults, 200)),
    sort: "relevance",
  })

  if (email) {
    params.set("mailto", email)
  }

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(
      `https://api.openalex.org/works?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    )
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`OpenAlex API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`OpenAlex 搜索失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    results?: Array<{
      id?: string
      title?: string
      doi?: string
      authorships?: Array<{ author?: { display_name?: string } }>
      cited_by_count?: number
      publication_year?: number
      abstract_inverted_index?: Record<string, number[]>
    }>
  }

  return (data.results ?? []).slice(0, maxResults).map((r) => {
    // OpenAlex 使用 inverted index 存储摘要，需要重建
    let abstract = ""
    if (r.abstract_inverted_index) {
      const words = Object.entries(r.abstract_inverted_index)
        .flatMap(([word, positions]) => positions.map((pos) => [pos, word] as [number, string]))
        .sort((a, b) => a[0] - b[0])
        .map(([, w]) => w)
      abstract = words.join(" ")
    }

    return {
      title: r.title ?? "Untitled",
      url: r.doi ? `https://doi.org/${r.doi}` : r.id ?? "",
      snippet: abstract.slice(0, 500),
      authors: (r.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
      year: r.publication_year,
      doi: r.doi,
      citationCount: r.cited_by_count,
      source: "openalex",
    }
  })
}

// ─── Semantic Scholar ───────────────────────────────────────────────────────

/**
 * 搜索 Semantic Scholar 学术论文。
 * 免费（无 Key 上限 1 请求/秒；有 Key 100 请求/秒）。
 * 注册免费 Key：https://api.semanticscholar.org/
 */
export async function semanticScholarSearch(
  query: string,
  maxResults: number = 10,
  apiKey?: string,
): Promise<AcademicPaper[]> {
  const params = new URLSearchParams({
    query,
    limit: String(Math.min(maxResults, 100)),
    fields: "title,url,year,authors,abstract,citationCount,externalIds",
  })

  const headers: Record<string, string> = { Accept: "application/json" }
  if (apiKey) {
    headers["x-api-key"] = apiKey
  }

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`,
      {
        method: "GET",
        headers,
      },
    )
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`Semantic Scholar API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`Semantic Scholar 搜索失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    data?: Array<{
      paperId?: string
      title?: string
      url?: string
      year?: number
      authors?: Array<{ name?: string }>
      abstract?: string
      citationCount?: number
      externalIds?: { DOI?: string; ArXiv?: string }
    }>
  }

  return (data.data ?? []).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? `https://www.semanticscholar.org/paper/${r.paperId}`,
    snippet: r.abstract ?? "",
    authors: (r.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: r.year,
    doi: r.externalIds?.DOI,
    citationCount: r.citationCount,
    source: "semantic_scholar",
  }))
}

// ─── CrossRef ───────────────────────────────────────────────────────────────

/**
 * 搜索 CrossRef 学术论文（按标题/关键词/DOI）。
 * 免费，无需 API Key。礼貌池速率限制：每秒 ~50 次。
 */
export async function crossrefSearch(
  query: string,
  maxResults: number = 10,
): Promise<AcademicPaper[]> {
  const params = new URLSearchParams({
    query,
    rows: String(Math.min(maxResults, 100)),
    sort: "relevance",
  })

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(
      `https://api.crossref.org/works?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    )
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(`CrossRef API 网络请求失败，请检查网络连接。`)
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误")
    throw new Error(`CrossRef 搜索失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    message?: {
      items?: Array<{
        title?: string[]
        DOI?: string
        author?: Array<{ given?: string; family?: string }>
        abstract?: string
        "published-print"?: { "date-parts"?: number[][] }
        "published-online"?: { "date-parts"?: number[][] }
        "is-referenced-by-count"?: number
        URL?: string
      }>
    }
  }

  return (data.message?.items ?? []).slice(0, maxResults).map((r) => {
    const authors = (r.author ?? []).map(
      (a) => [a.given, a.family].filter(Boolean).join(" "),
    )
    const dateParts = r["published-print"]?.["date-parts"]?.[0]
      ?? r["published-online"]?.["date-parts"]?.[0]

    return {
      title: r.title?.[0] ?? "Untitled",
      url: r.URL ?? (r.DOI ? `https://doi.org/${r.DOI}` : ""),
      snippet: r.abstract ?? "",
      authors,
      year: dateParts?.[0],
      doi: r.DOI,
      citationCount: r["is-referenced-by-count"],
      source: "crossref",
    }
  })
}

/**
 * 通过 arXiv API 转换为通用 ExternalSourceResult 格式，
 * 方便在 Deep Research 等场景下统一使用。
 */
export function arxivToSearchResult(paper: ArxivPaper): ExternalSourceResult {
  return {
    title: paper.title,
    url: paper.url,
    snippet: paper.summary,
    source: "arXiv",
    metadata: {
      authors: paper.authors.join("; "),
      published: paper.published,
      doi: paper.doi ?? "",
      pdfUrl: paper.pdfUrl,
      categories: paper.categories.join(", "),
    },
  }
}

/**
 * 通过 AcademicPaper 转换为通用 ExternalSourceResult 格式。
 */
export function academicToSearchResult(paper: AcademicPaper): ExternalSourceResult {
  return {
    title: paper.title,
    url: paper.url,
    snippet: paper.snippet,
    source: paper.source,
    metadata: {
      authors: paper.authors.join("; "),
      year: paper.year !== undefined ? String(paper.year) : "",
      doi: paper.doi ?? "",
      citations: paper.citationCount !== undefined ? String(paper.citationCount) : "",
    },
  }
}

// ─── 统一按需搜索 ───────────────────────────────────────────────────────────

/** 外部信息源类型标识 */
export type ExternalSourceType = "wikipedia" | "arxiv" | "academic"

/** 按需搜索的返回结果 */
export interface ExternalSourcesResult {
  results: ExternalSourceResult[]
  errors: string[]
}

/**
 * 统一按需搜索：根据指定的信息源类型列表，并发调用各免费 API。
 *
 * @param query   搜索关键词
 * @param sources 要搜索的信息源类型列表
 * @param maxPerSource 每个源最多返回几条
 */
export async function searchExternalSources(
  query: string,
  sources: ExternalSourceType[],
  maxPerSource: number = 5,
): Promise<ExternalSourcesResult> {
  if (sources.length === 0) return { results: [], errors: [] }

  const results: ExternalSourceResult[] = []
  const errors: string[] = []

  // 构建并发调用列表
  const calls: Array<Promise<ExternalSourceResult[]>> = []

  for (const source of sources) {
    switch (source) {
      case "wikipedia":
        calls.push(
          wikipediaSearch(query, "zh", maxPerSource).catch((err) => {
            errors.push(`Wikipedia: ${err instanceof Error ? err.message : String(err)}`)
            return []
          }),
        )
        break
      case "arxiv":
        calls.push(
          arxivSearch(query, maxPerSource).then((papers) =>
            papers.map(arxivToSearchResult),
          ).catch((err) => {
            errors.push(`arXiv: ${err instanceof Error ? err.message : String(err)}`)
            return []
          }),
        )
        break
      case "academic":
        // 优先 OpenAlex（免费、无需 Key、速度快）
        calls.push(
          openAlexSearch(query, maxPerSource).then((papers) =>
            papers.map(academicToSearchResult),
          ).catch((err) => {
            errors.push(`OpenAlex: ${err instanceof Error ? err.message : String(err)}`)
            return []
          }),
        )
        break
    }
  }

  const settled = await Promise.allSettled(calls)
  const seenTitles = new Set<string>()

  for (const item of settled) {
    if (item.status === "fulfilled") {
      for (const r of item.value) {
        const key = (r.title + r.source).toLowerCase()
        if (!seenTitles.has(key)) {
          seenTitles.add(key)
          results.push(r)
        }
      }
    }
  }

  return { results, errors }
}
