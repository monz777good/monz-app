import { NextResponse } from 'next/server'

type RecipeRow = {
  id: string
  title: string
  imageUrls: string[]
  fields: { label: string; value: string }[]
}

const DEFAULT_SHEET_NAME = '약침처방전 추출개선'

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

function pickTitle(headers: string[], values: string[]) {
  const titleIndex = headers.findIndex((header) => /약침|처방|품명|이름|명칭|제품|레시피|생산법/i.test(header))
  if (titleIndex >= 0 && values[titleIndex]?.trim()) return values[titleIndex].trim()

  return values.find((value) => value.trim())?.trim() || '이름 없음'
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
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_ID
  const sheetName = process.env.ACUPUNCTURE_RECIPE_SHEET_NAME || DEFAULT_SHEET_NAME

  if (!spreadsheetId) {
    return NextResponse.json(
      {
        error: 'GOOGLE_SHEET_ID 또는 ACUPUNCTURE_RECIPE_SPREADSHEET_ID 환경변수가 필요합니다.',
      },
      { status: 500 }
    )
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  const response = await fetch(csvUrl, { next: { revalidate: 60 } })

  if (!response.ok) {
    return NextResponse.json(
      {
        error: '구글시트를 읽지 못했습니다. 시트 공유 권한이나 탭 이름을 확인해주세요.',
      },
      { status: 502 }
    )
  }

  const csv = await response.text()
  const rows = parseCsv(csv)
  const headers = rows[0]?.map((header) => header.trim()) || []
  const needle = query.toLowerCase()

  const recipes: RecipeRow[] = rows
    .slice(1)
    .map((values, index) => {
      const paddedValues = headers.map((_, valueIndex) => values[valueIndex] || '')
      const haystack = paddedValues.join(' ').toLowerCase()
      if (!haystack.includes(needle)) return null

      const imageUrls = paddedValues.flatMap(extractImageUrls)
      const fields = headers
        .map((header, valueIndex) => ({
          label: header || `열 ${valueIndex + 1}`,
          value: paddedValues[valueIndex]?.trim() || '',
        }))
        .filter((field) => field.value && extractImageUrls(field.value).length === 0)

      return {
        id: `${index}-${pickTitle(headers, paddedValues)}`,
        title: pickTitle(headers, paddedValues),
        imageUrls,
        fields,
      }
    })
    .filter(Boolean) as RecipeRow[]

  return NextResponse.json({ recipes })
}
