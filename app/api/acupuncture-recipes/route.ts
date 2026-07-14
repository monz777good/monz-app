import { NextResponse } from 'next/server'

type RecipeRow = {
  id: string
  title: string
  imageUrls: string[]
  sourceUrl: string
  printUrl: string
  rowRange: string
  fields: { label: string; value: string }[]
}

const DEFAULT_SPREADSHEET_ID = '1wc-TzjMAe3zbK6qdxewwz6MPGJvPt4nXp2nGiT5g7-8'
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

function findRecipeBlock(rows: string[][], matchedIndex: number) {
  let startIndex = matchedIndex
  for (let index = matchedIndex; index >= Math.max(0, matchedIndex - 8); index -= 1) {
    const rowText = rows[index].join(' ')
    if (rowText.includes('상품명') || rowText.includes('제품명') || rowText.includes('약침명')) {
      startIndex = index
      break
    }
  }

  let endIndex = Math.min(rows.length - 1, startIndex + 35)
  for (let index = startIndex + 1; index <= Math.min(rows.length - 1, startIndex + 60); index += 1) {
    const rowText = rows[index].join(' ')
    if (rowText.includes('상품명') || rowText.includes('제품명') || rowText.includes('약침명')) {
      endIndex = Math.max(startIndex, index - 1)
      break
    }
  }

  let maxColumnIndex = 0
  rows.slice(startIndex, endIndex + 1).forEach((row) => {
    row.forEach((value, columnIndex) => {
      if (value.trim()) maxColumnIndex = Math.max(maxColumnIndex, columnIndex)
    })
  })

  return {
    startIndex,
    endIndex,
    startRow: startIndex + 1,
    endRow: endIndex + 1,
    endColumn: getColumnName(Math.max(6, maxColumnIndex + 2)),
  }
}

function pickTitle(blockRows: string[][], query: string) {
  const exactMatch = blockRows.flat().find((value) => value.trim().toLowerCase().includes(query.toLowerCase()))
  if (exactMatch?.trim()) return exactMatch.trim()

  return blockRows.flat().find((value) => value.trim())?.trim() || '이름 없음'
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
  const seenRanges = new Set<string>()

  const recipes: RecipeRow[] = rows
    .map((values, index) => {
      const haystack = values.join(' ').toLowerCase()
      if (!haystack.includes(needle)) return null

      const block = findRecipeBlock(rows, index)
      const rowRange = `A${block.startRow}:${block.endColumn}${block.endRow}`
      if (seenRanges.has(rowRange)) return null
      seenRanges.add(rowRange)

      const blockRows = rows.slice(block.startIndex, block.endIndex + 1)
      const blockValues = blockRows.flat()
      const imageUrls = blockValues.flatMap(extractImageUrls)
      const fields = blockRows
        .flatMap((row, rowIndex) =>
          row.map((value, columnIndex) => ({
            label: `${getColumnName(columnIndex)}${block.startRow + rowIndex}`,
            value: value.trim(),
          }))
        )
        .filter((field) => field.value && extractImageUrls(field.value).length === 0)

      const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetGid}&range=${encodeURIComponent(rowRange)}`
      const printUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=pdf&gid=${sheetGid}&range=${encodeURIComponent(rowRange)}&size=A4&portrait=false&fitw=true&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false`
      const title = pickTitle(blockRows, query)

      return {
        id: `${index}-${title}`,
        title,
        imageUrls,
        sourceUrl,
        printUrl,
        rowRange,
        fields,
      }
    })
    .filter(Boolean) as RecipeRow[]

  return NextResponse.json({ recipes })
}
