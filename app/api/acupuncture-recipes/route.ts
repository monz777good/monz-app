import { NextResponse } from 'next/server'

type RecipeRow = {
  id: string
  title: string
  imageUrls: string[]
  sourceUrl: string
  printUrl: string
  rowRange: string
  methodText: string
  fields: { label: string; value: string }[]
}

type RecipeBlock = {
  startIndex: number
  endIndex: number
  startRow: number
  endRow: number
  endColumn: string
  title: string
  blockRows: string[][]
}

const DEFAULT_SPREADSHEET_ID = '1wc-TzjMAe3zbK6qdxcwwz6MPGUvPt4nXp2nGiT5g7-8'
const DEFAULT_SHEET_NAME = '약침처방전 추출개선'
const DEFAULT_SHEET_GID = '227446664'

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  rows.push(row)
  return rows.filter((csvRow) => csvRow.some((value) => value.trim()))
}

function normalizeImageUrl(url: string) {
  const trimmed = url.trim().replace(/^"|"$/g, '')
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (fileMatch) return `https://drive.google.com/uc?export=view&id=${fileMatch[1]}`

  const openMatch = trimmed.match(/[?&]id=([^&]+)/)
  if (trimmed.includes('drive.google.com') && openMatch) {
    return `https://drive.google.com/uc?export=view&id=${openMatch[1]}`
  }

  return trimmed
}

function extractImageUrls(value: string) {
  const urls = new Set<string>()
  const imageFormulaMatches = value.matchAll(/IMAGE\(\s*["']([^"']+)["']/gi)
  for (const match of imageFormulaMatches) urls.add(normalizeImageUrl(match[1]))

  const urlMatches = value.matchAll(/https?:\/\/[^\s"',)]+/gi)
  for (const match of urlMatches) {
    const url = normalizeImageUrl(match[0])
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) || url.includes('drive.google.com')) {
      urls.add(url)
    }
  }

  return [...urls]
}

function getColumnName(index: number) {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function getBlockEndColumn(rows: string[][], startIndex: number, endIndex: number) {
  let maxColumnIndex = 0
  rows.slice(startIndex, endIndex + 1).forEach((row) => {
    row.forEach((value, columnIndex) => {
      if (value.trim()) maxColumnIndex = Math.max(maxColumnIndex, columnIndex)
    })
  })

  return getColumnName(Math.max(6, maxColumnIndex + 2))
}

function compactLabel(value: string) {
  return value.replace(/\s/g, '')
}

function isProductHeaderRow(row: string[]) {
  return row.some((value) => {
    const label = compactLabel(value)
    return label.includes('상품명') || label.includes('제품명')
  })
}

function pickProductTitle(row: string[], fallback: string) {
  const labelIndex = row.findIndex((value) => {
    const label = compactLabel(value)
    return label.includes('상품명') || label.includes('제품명')
  })

  if (labelIndex < 0) return fallback

  for (let columnIndex = labelIndex + 1; columnIndex < row.length; columnIndex += 1) {
    const value = row[columnIndex].trim()
    const label = compactLabel(value)
    if (!value) continue
    if (label.includes('제조사') || label.includes('효과') || label.includes('제조방법') || label.includes('주의사항')) continue
    return value
  }

  return fallback
}

function buildRecipeBlocks(rows: string[][]): RecipeBlock[] {
  const headerIndexes = rows.map((row, index) => (isProductHeaderRow(row) ? index : -1)).filter((index) => index >= 0)

  return headerIndexes.map((startIndex, blockIndex) => {
    const nextStartIndex = headerIndexes[blockIndex + 1]
    const endIndex = nextStartIndex ? nextStartIndex - 1 : rows.length - 1
    const blockRows = rows.slice(startIndex, endIndex + 1)
    const title = pickProductTitle(rows[startIndex], pickTitle(blockRows, ''))

    return {
      startIndex,
      endIndex,
      startRow: startIndex + 1,
      endRow: endIndex + 1,
      endColumn: getBlockEndColumn(rows, startIndex, endIndex),
      title,
      blockRows,
    }
  })
}

function pickTitle(blockRows: string[][], query: string) {
  const exactMatch = blockRows.flat().find((value) => value.trim().toLowerCase().includes(query.toLowerCase()))
  if (exactMatch?.trim()) return exactMatch.trim()

  return blockRows.flat().find((value) => value.trim())?.trim() || '이름 없음'
}

function isManufacturingMethodLabel(value: string) {
  return compactLabel(value).includes('제조방법')
}

function isRecipeSectionBoundary(row: string[]) {
  return row.some((value) => {
    const label = compactLabel(value)
    return (
      label.includes('주의사항') ||
      label.includes('상품명') ||
      label.includes('제품명') ||
      label.includes('약침명') ||
      label.includes('처방코드') ||
      label === '효과'
    )
  })
}

function extractManufacturingMethod(blockRows: string[][]) {
  for (let rowIndex = 0; rowIndex < blockRows.length; rowIndex += 1) {
    const row = blockRows[rowIndex]
    const labelIndex = row.findIndex(isManufacturingMethodLabel)
    if (labelIndex < 0) continue

    const parts = row
      .slice(labelIndex + 1)
      .map((value) => value.trim())
      .filter(Boolean)

    for (let nextIndex = rowIndex + 1; nextIndex < blockRows.length; nextIndex += 1) {
      const nextRow = blockRows[nextIndex]
      if (isRecipeSectionBoundary(nextRow)) break

      const nextParts = nextRow
        .slice(labelIndex + 1)
        .map((value) => value.trim())
        .filter(Boolean)

      if (nextParts.length > 0) parts.push(nextParts.join('\n'))
    }

    const methodText = parts.join('\n').trim()
    if (methodText) return methodText
  }

  return ''
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || '').trim()

  if (!query) {
    return NextResponse.json({ recipes: [] })
  }

  const spreadsheetId =
    process.env.ACUPUNCTURE_RECIPE_SPREADSHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_ID ||
    DEFAULT_SPREADSHEET_ID
  const sheetName = process.env.ACUPUNCTURE_RECIPE_SHEET_NAME || DEFAULT_SHEET_NAME
  const sheetGid = process.env.ACUPUNCTURE_RECIPE_SHEET_GID || process.env.GOOGLE_SHEET_GID || DEFAULT_SHEET_GID

  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(sheetGid)}`
  const response = await fetch(csvUrl, { next: { revalidate: 60 } })

  if (!response.ok) {
    return NextResponse.json(
      {
        error: `구글시트를 읽지 못했습니다. 공유 권한 또는 gid(${sheetGid})를 확인해주세요. 상태코드: ${response.status}`,
      },
      { status: 502 }
    )
  }

  const csv = await response.text()
  const rows = parseCsv(csv)
  const needle = query.toLowerCase()

  const matchedRecipes = buildRecipeBlocks(rows)
    .map((block) => {
      const blockValues = block.blockRows.flat()
      const titleMatch = block.title.toLowerCase().includes(needle)
      const contentMatch = blockValues.join(' ').toLowerCase().includes(needle)
      if (!titleMatch && !contentMatch) return null

      const rowRange = `A${block.startRow}:${block.endColumn}${block.endRow}`
      const imageUrls = blockValues.flatMap(extractImageUrls)
      const methodText = extractManufacturingMethod(block.blockRows)
      if (!methodText) return null

      const fields = block.blockRows
        .flatMap((row, rowIndex) =>
          row.map((value, columnIndex) => ({
            label: `${getColumnName(columnIndex)}${block.startRow + rowIndex}`,
            value: value.trim(),
          }))
        )
        .filter((field) => field.value && extractImageUrls(field.value).length === 0)

      const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetGid}&range=${encodeURIComponent(rowRange)}`

      return {
        titleMatch,
        recipe: {
          id: `${block.startRow}-${block.title}`,
          title: block.title,
          imageUrls,
          sourceUrl,
          printUrl: '',
          rowRange,
          methodText,
          fields,
        },
      }
    })
    .filter((match): match is { titleMatch: boolean; recipe: RecipeRow } => Boolean(match))

  const hasTitleMatch = matchedRecipes.some((match) => match.titleMatch)
  const recipes = matchedRecipes.filter((match) => !hasTitleMatch || match.titleMatch).map((match) => match.recipe)

  return NextResponse.json({ recipes })
}
