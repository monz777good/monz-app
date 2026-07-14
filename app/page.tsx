'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type InstructionResultMark = 'CIRCLE' | 'TRIANGLE' | 'X'

type TaskRow = {
  id: number
  user_name: string
  task_content: string
  type: string
  created_at?: string | null
  leave_date?: string | null
  target_name?: string | null
  instruction_status?: string | null
  instruction_checked_at?: string | null
  instruction_result_mark?: InstructionResultMark | string | null
  instruction_result_at?: string | null
}

type EvaluationCount = {
  circle: number
  triangle: number
  x: number
  total: number
}

type ProductionManualItem = {
  id: string
  text: string
}

type ProductionCheckAnswer = {
  itemId: string
  text: string
  answer: '예' | '아니오'
  note: string
}

type ProductionCheckPayload = {
  date: string
  producer: string
  answers: ProductionCheckAnswer[]
}

type AcupunctureRecipe = {
  id: string
  title: string
  imageUrls: string[]
  sourceUrl: string
  printUrl: string
  rowRange: string
  fields: { label: string; value: string }[]
}

const OWNER_PIN = '1919'
const DEFAULT_ANNUAL_LEAVE_LIMIT = 15
const ANNUAL_LEAVE_LIMIT_BY_EMPLOYEE: Record<string, number> = {
  이현택: 16,
  전창식: 11,
  안정은: 15,
  조승: 0,
}
const PRIOR_ANNUAL_USED_BY_EMPLOYEE: Record<string, number> = {
  이현택: 4.5,
  안정은: 5,
}
const LEAVE_USED_ADJUSTMENT_BY_EMPLOYEE: Record<string, { annualUsed?: number; halfUsed?: number; monthlyUsed?: number }> = {
  조승: { annualUsed: 2, halfUsed: 2 },
}
const LEAVE_COUNT_START_DATE_BY_EMPLOYEE: Record<string, string> = {
  전창식: '2026-05-01',
}
const MONTHLY_LEAVE_RULE_BY_EMPLOYEE: Record<string, { baseMonth: string; baseAllowance: number }> = {
  조승: { baseMonth: '2026-07', baseAllowance: 5 },
}
const KNOWN_EMPLOYEES = ['이현택', '안정은', '전창식', '조승']
const LEAVE_TYPES = ['연차', '월차', '반차']
const INSTRUCTION_TYPES = ['업무지시', '업무요청']
const PRODUCTION_MANUAL_TYPE = '생산매뉴얼'
const PRODUCTION_CHECK_TYPE = '생산체크'
const DEFAULT_PRODUCTION_MANUAL_ITEMS: ProductionManualItem[] = [
  { id: 'clean-workbench', text: '작업대와 주변 정리 상태를 확인했습니다.' },
  { id: 'check-ingredients', text: '생산 원료와 수량을 확인했습니다.' },
  { id: 'check-label', text: '라벨/환자명/처방 정보를 확인했습니다.' },
  { id: 'check-machine', text: '기기 작동 상태와 안전 상태를 확인했습니다.' },
]

function isLeaveType(type: string) {
  return LEAVE_TYPES.includes(type)
}

function isInstructionType(type: string) {
  return INSTRUCTION_TYPES.includes(type)
}

function isSystemTaskType(type: string) {
  return type === PRODUCTION_MANUAL_TYPE || type === PRODUCTION_CHECK_TYPE
}

function getAnnualLeaveLimit(name: string) {
  const overrideName = Object.keys(ANNUAL_LEAVE_LIMIT_BY_EMPLOYEE).find((employeeName) => name.includes(employeeName))
  if (overrideName) return ANNUAL_LEAVE_LIMIT_BY_EMPLOYEE[overrideName]

  return ANNUAL_LEAVE_LIMIT_BY_EMPLOYEE[name] ?? DEFAULT_ANNUAL_LEAVE_LIMIT
}

function monthDiff(fromMonth: string, toMonth: string) {
  const [fromYear, from] = fromMonth.split('-').map(Number)
  const [toYear, to] = toMonth.split('-').map(Number)
  return (toYear - fromYear) * 12 + (to - from)
}

function getMonthlyLeaveLimit(name: string, month: string) {
  const overrideName = Object.keys(MONTHLY_LEAVE_RULE_BY_EMPLOYEE).find((employeeName) => name.includes(employeeName))
  if (!overrideName) return null

  const rule = MONTHLY_LEAVE_RULE_BY_EMPLOYEE[overrideName]
  return Math.max(0, rule.baseAllowance + monthDiff(rule.baseMonth, month))
}

function normalizeEmployeeName(raw?: string | null) {
  const name = (raw || '')
    .replace(/^\s*\[?지시\]?\s*/i, '')
    .replace(/^\s*to\.?\s*/i, '')
    .trim()

  if (name.includes('이현택')) return '이현택'
  if (name.includes('전창식')) return '전창식'
  if (name.includes('안정은')) return '안정은'
  if (name.includes('조승')) return '조승'
  return name
}

function formatLeaveCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function getPriorAnnualUsed(name: string, year: string) {
  if (year !== '2026') return 0

  const overrideName = Object.keys(PRIOR_ANNUAL_USED_BY_EMPLOYEE).find((employeeName) => name.includes(employeeName))
  return overrideName ? PRIOR_ANNUAL_USED_BY_EMPLOYEE[overrideName] : 0
}

function getLeaveUsedAdjustment(name: string, year: string) {
  if (year !== '2026') return {}

  const overrideName = Object.keys(LEAVE_USED_ADJUSTMENT_BY_EMPLOYEE).find((employeeName) => name.includes(employeeName))
  return overrideName ? LEAVE_USED_ADJUSTMENT_BY_EMPLOYEE[overrideName] : {}
}

function shouldCountLeaveForEmployee(name: string, taskDate: string) {
  const overrideName = Object.keys(LEAVE_COUNT_START_DATE_BY_EMPLOYEE).find((employeeName) => name.includes(employeeName))
  if (!overrideName) return true

  return taskDate >= LEAVE_COUNT_START_DATE_BY_EMPLOYEE[overrideName]
}

function parseProductionManualItems(content?: string | null) {
  if (!content) return DEFAULT_PRODUCTION_MANUAL_ITEMS

  try {
    const parsed = JSON.parse(content) as ProductionManualItem[]
    if (Array.isArray(parsed)) {
      const items = parsed
        .map((item, index) => ({
          id: String(item.id || `item-${index + 1}`),
          text: String(item.text || '').trim(),
        }))
        .filter((item) => item.text)

      if (items.length > 0) return items
    }
  } catch {
    const lines = content
      .split('\n')
      .map((line, index) => ({ id: `item-${index + 1}`, text: line.trim() }))
      .filter((item) => item.text)

    if (lines.length > 0) return lines
  }

  return DEFAULT_PRODUCTION_MANUAL_ITEMS
}

function serializeProductionManualItems(draft: string) {
  return draft
    .split('\n')
    .map((line, index) => ({ id: `item-${index + 1}`, text: line.trim() }))
    .filter((item) => item.text)
}

function parseProductionCheckPayload(content?: string | null) {
  if (!content) return null

  try {
    const parsed = JSON.parse(content) as ProductionCheckPayload
    if (parsed && Array.isArray(parsed.answers)) return parsed
  } catch {
    return null
  }

  return null
}

function getKSTDateString(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function getKSTMonthString(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 7)
}

function formatKSTDateTime(value?: string | null) {
  if (!value) return '방금 등록'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatKSTDateOnly(value?: string | null) {
  if (!value) return '-'
  const d = new Date(`${value}T00:00:00+09:00`)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function getTaskKSTDate(task: TaskRow) {
  if (isLeaveType(task.type)) {
    return task.leave_date || null
  }
  if (!task.created_at) return null
  const d = new Date(task.created_at)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function statusColor(status?: string | null) {
  if (status === '완료') return 'bg-emerald-500 text-white'
  if (status === '진행중') return 'bg-amber-400 text-black'
  if (status === '확인') return 'bg-sky-500 text-white'
  return 'bg-slate-200 text-black'
}

function resultLabel(mark?: string | null) {
  if (mark === 'CIRCLE') return '○'
  if (mark === 'TRIANGLE') return '△'
  if (mark === 'X') return '✕'
  return '미평가'
}

function resultText(mark?: string | null) {
  if (mark === 'CIRCLE') return '완료 인정'
  if (mark === 'TRIANGLE') return '보완 필요'
  if (mark === 'X') return '미흡'
  return '미평가'
}

function resultColor(mark?: string | null) {
  if (mark === 'CIRCLE') return 'bg-emerald-500 text-white'
  if (mark === 'TRIANGLE') return 'bg-amber-400 text-black'
  if (mark === 'X') return 'bg-rose-500 text-white'
  return 'bg-slate-200 text-black'
}

function normalizeNameList(raw?: string | null) {
  if (!raw) return []
  return raw
    .split(/[,\n/|]+/)
    .flatMap((chunk) => chunk.split(/\s+/))
    .map((v) => v.trim())
    .filter(Boolean)
}

function matchesTarget(targetName: string | null | undefined, writerName: string) {
  const me = writerName.trim()
  if (!me) return false
  const list = normalizeNameList(targetName)
  return list.includes('전체') || list.includes(me)
}

function emptyEvaluationCount(): EvaluationCount {
  return {
    circle: 0,
    triangle: 0,
    x: 0,
    total: 0,
  }
}

function addResultCount(count: EvaluationCount, mark?: string | null) {
  if (mark === 'CIRCLE') count.circle += 1
  if (mark === 'TRIANGLE') count.triangle += 1
  if (mark === 'X') count.x += 1
  if (mark === 'CIRCLE' || mark === 'TRIANGLE' || mark === 'X') count.total += 1
}

function formatAcupunctureProductionName(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return ''
  return trimmed.includes('약침') ? trimmed : `${trimmed} 약침`
}

export default function Home() {
  const today = useMemo(() => getKSTDateString(), [])

  const [writerName, setWriterName] = useState('')
  const [dailyContent, setDailyContent] = useState('')
  const [weeklyContent, setWeeklyContent] = useState('')
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const [isOwnerView, setIsOwnerView] = useState(false)
  const [pin, setPin] = useState('')

  const [tasks, setTasks] = useState<TaskRow[]>([])

  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showEmployeeRequestModal, setShowEmployeeRequestModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showProductionModal, setShowProductionModal] = useState(false)
  const [showAcupunctureRecipeModal, setShowAcupunctureRecipeModal] = useState(false)

  const [orderData, setOrderData] = useState({
    to: '',
    content: '',
  })

  const [employeeRequestData, setEmployeeRequestData] = useState({
    to: '',
    content: '',
  })

  const [leaveData, setLeaveData] = useState({
    type: '연차',
    content: '',
    date: today,
  })

  const [producerName, setProducerName] = useState('')
  const [productionDate, setProductionDate] = useState(today)
  const [productionAnswers, setProductionAnswers] = useState<Record<string, { answer: '' | '예' | '아니오'; note: string }>>({})
  const [manualDraft, setManualDraft] = useState('')
  const [acupunctureRecipeQuery, setAcupunctureRecipeQuery] = useState('')
  const [acupunctureRecipeLoading, setAcupunctureRecipeLoading] = useState(false)
  const [acupunctureRecipeError, setAcupunctureRecipeError] = useState('')
  const [acupunctureRecipeResults, setAcupunctureRecipeResults] = useState<AcupunctureRecipe[]>([])
  const [selectedAcupunctureRecipeTitle, setSelectedAcupunctureRecipeTitle] = useState('')
  const [agreedAcupunctureRecipeTitle, setAgreedAcupunctureRecipeTitle] = useState('')
  const [pendingAcupunctureConsentTitle, setPendingAcupunctureConsentTitle] = useState('')
  const [showAcupunctureConsentPrompt, setShowAcupunctureConsentPrompt] = useState(false)

  const [ownerTab, setOwnerTab] = useState<'전체' | '일일업무' | '주간계획' | '연차/월차/반차' | '업무지시' | '업무요청' | '생산체크'>('전체')
  const [dateFilterEnabled, setDateFilterEnabled] = useState(true)
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [employeeHistoryDate, setEmployeeHistoryDate] = useState(today)
  const [productionHistoryMode, setProductionHistoryMode] = useState<'year' | 'date'>('date')
  const [productionHistoryYear, setProductionHistoryYear] = useState(today.slice(0, 4))
  const [productionHistoryDate, setProductionHistoryDate] = useState(today)
  const [productionHistoryProducer, setProductionHistoryProducer] = useState('전체')

  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(today)

  const [evaluationMode, setEvaluationMode] = useState<'month' | 'year'>('month')
  const [evaluationMonth, setEvaluationMonth] = useState(today.slice(0, 7))
  const [evaluationYear, setEvaluationYear] = useState(today.slice(0, 4))

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from('MONZ')
      .select(
        'id, user_name, task_content, type, created_at, leave_date, target_name, instruction_status, instruction_checked_at, instruction_result_mark, instruction_result_at'
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('fetchTasks error:', error)
      alert(`목록 불러오기 실패: ${error.message}`)
      return
    }

    setTasks((data as TaskRow[]) || [])
  }, [])

  useEffect(() => {
    const savedName = localStorage.getItem('monz_name')
    const savedDaily = localStorage.getItem('monz_daily_content')
    const savedWeekly = localStorage.getItem('monz_weekly_content')

    if (savedName) setWriterName(savedName)
    if (savedDaily) setDailyContent(savedDaily)
    if (savedWeekly) setWeeklyContent(savedWeekly)

    setDraftLoaded(true)
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    if (!draftLoaded) return
    localStorage.setItem('monz_name', writerName)
  }, [writerName, draftLoaded])

  useEffect(() => {
    if (!draftLoaded) return
    localStorage.setItem('monz_daily_content', dailyContent)
  }, [dailyContent, draftLoaded])

  useEffect(() => {
    if (!draftLoaded) return
    localStorage.setItem('monz_weekly_content', weeklyContent)
  }, [weeklyContent, draftLoaded])

  useEffect(() => {
    fetchTasks()
    const timer = setInterval(() => {
      fetchTasks()
    }, 10000)

    return () => clearInterval(timer)
  }, [fetchTasks])

  const evaluationStats = useMemo(() => {
    const total = emptyEvaluationCount()
    const byEmployee: Record<string, EvaluationCount> = {}

    tasks.forEach((task) => {
      if (task.type !== '업무지시') return
      if (!task.instruction_result_mark) return

      const evaluatedAt = task.instruction_result_at || task.created_at
      const evaluatedMonth = getKSTMonthString(evaluatedAt)
      if (!evaluatedMonth) return

      const evaluatedYear = evaluatedMonth.slice(0, 4)

      if (evaluationMode === 'month') {
        if (evaluatedMonth !== evaluationMonth) return
      }

      if (evaluationMode === 'year') {
        if (evaluatedYear !== evaluationYear) return
      }

      addResultCount(total, task.instruction_result_mark)

      const targetNames = normalizeNameList(task.target_name)
      const names = targetNames.length > 0 ? targetNames : ['미지정']

      names.forEach((name) => {
        if (!byEmployee[name]) byEmployee[name] = emptyEvaluationCount()
        addResultCount(byEmployee[name], task.instruction_result_mark)
      })
    })

    const employeeRows = Object.entries(byEmployee)
      .map(([name, count]) => ({
        name,
        ...count,
      }))
      .sort((a, b) => b.total - a.total || b.circle - a.circle || a.name.localeCompare(b.name, 'ko'))

    return {
      total,
      employeeRows,
    }
  }, [tasks, evaluationMode, evaluationMonth, evaluationYear])

  const employeeOptions = KNOWN_EMPLOYEES

  const productionManualRow = useMemo(() => tasks.find((task) => task.type === PRODUCTION_MANUAL_TYPE), [tasks])
  const productionManualItems = useMemo(() => parseProductionManualItems(productionManualRow?.task_content), [productionManualRow])
  const productionCheckItems = useMemo(() => {
    if (!agreedAcupunctureRecipeTitle) return productionManualItems

    return [
      {
        id: 'agreed-acupuncture-recipe',
        text: `${formatAcupunctureProductionName(agreedAcupunctureRecipeTitle)}을 생산하기로 동의하셨는데 맞습니까?`,
      },
      ...productionManualItems,
    ]
  }, [agreedAcupunctureRecipeTitle, productionManualItems])
  const productionSubmissionRows = useMemo(
    () =>
      tasks
        .filter((task) => task.type === PRODUCTION_CHECK_TYPE)
        .map((task) => ({ task, payload: parseProductionCheckPayload(task.task_content) }))
        .filter((row) => row.payload)
        .sort((a, b) => new Date(b.task.created_at || '').getTime() - new Date(a.task.created_at || '').getTime()),
    [tasks]
  )
  const productionSubmissions = useMemo(() => productionSubmissionRows.slice(0, 8), [productionSubmissionRows])
  const periodProductionSubmissions = useMemo(
    () =>
      productionSubmissionRows.filter(({ task, payload }) => {
        const taskDate = getTaskKSTDate(task)
        if (!taskDate) return false

        if (productionHistoryMode === 'year') {
          if (taskDate.slice(0, 4) !== productionHistoryYear) return false
        } else if (taskDate !== productionHistoryDate) {
          return false
        }

        return true
      }),
    [productionSubmissionRows, productionHistoryMode, productionHistoryYear, productionHistoryDate]
  )
  const filteredProductionSubmissions = useMemo(
    () =>
      periodProductionSubmissions.filter(({ payload }) => {
        if (productionHistoryProducer === '전체') return true
        return normalizeEmployeeName(payload?.producer) === productionHistoryProducer
      }),
    [periodProductionSubmissions, productionHistoryProducer]
  )
  const productionSummaryRows = useMemo(
    () =>
      employeeOptions.map((name) => ({
        name,
        count: periodProductionSubmissions.filter(({ payload }) => normalizeEmployeeName(payload?.producer) === name).length,
      })),
    [employeeOptions, periodProductionSubmissions]
  )

  const leaveSummaryYear = calendarMonth.slice(0, 4)

  const leaveSummaryRows = useMemo(() => {
    const byEmployee = new Map<string, { name: string; priorUsed: number; annualUsed: number; halfUsed: number; monthlyUsed: number }>()

    Object.keys(ANNUAL_LEAVE_LIMIT_BY_EMPLOYEE).forEach((name) => {
      byEmployee.set(name, {
        name,
        priorUsed: getPriorAnnualUsed(name, leaveSummaryYear),
        annualUsed: 0,
        halfUsed: 0,
        monthlyUsed: 0,
      })
    })

    tasks.forEach((task) => {
      if (!isLeaveType(task.type)) return

      const name = normalizeEmployeeName(task.user_name)
      if (!name || name === '사장님') return

      const taskDate = getTaskKSTDate(task)
      if (!taskDate || taskDate.slice(0, 4) !== leaveSummaryYear) return
      if (!shouldCountLeaveForEmployee(name, taskDate)) return

      if (!byEmployee.has(name)) {
        byEmployee.set(name, {
          name,
          priorUsed: getPriorAnnualUsed(name, leaveSummaryYear),
          annualUsed: 0,
          halfUsed: 0,
          monthlyUsed: 0,
        })
      }

      const row = byEmployee.get(name)!
      if (task.type === '연차') row.annualUsed += 1
      if (task.type === '반차') row.halfUsed += 1
      if (task.type === '월차') row.monthlyUsed += 1
    })

    return [...byEmployee.values()]
      .map((row) => {
        const adjustment = getLeaveUsedAdjustment(row.name, leaveSummaryYear)
        const annualUsed = row.annualUsed + (adjustment.annualUsed || 0)
        const halfUsed = row.halfUsed + (adjustment.halfUsed || 0)
        const monthlyUsed = row.monthlyUsed + (adjustment.monthlyUsed || 0)
        const annualLimit = getAnnualLeaveLimit(row.name)
        const monthlyLimit = getMonthlyLeaveLimit(row.name, calendarMonth)
        const monthlyConsumed =
          monthlyLimit === null ? monthlyUsed : monthlyUsed + annualUsed + halfUsed * 0.5
        const annualConsumed = monthlyLimit === null ? row.priorUsed + annualUsed + halfUsed * 0.5 : 0
        const remaining = monthlyLimit === null ? annualLimit - annualConsumed : monthlyLimit - monthlyConsumed

        return {
          ...row,
          annualUsed,
          halfUsed,
          monthlyUsed,
          annualLimit,
          monthlyLimit,
          annualConsumed,
          monthlyConsumed,
          remaining,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [tasks, leaveSummaryYear, calendarMonth])

  const handleDailySubmit = async () => {
    if (!writerName.trim()) {
      alert('이름 써주세요!')
      return
    }
    if (!dailyContent.trim()) {
      alert('업무 내용을 입력해주세요!')
      return
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: writerName.trim(),
        task_content: dailyContent.trim(),
        type: '일일업무',
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`일일업무 등록 실패: ${error.message}`)
      return
    }

    alert('일일업무 등록 완료!')
    setDailyContent('')
    localStorage.removeItem('monz_daily_content')
    await fetchTasks()
  }

  const handleWeeklySubmit = async () => {
    if (!writerName.trim()) {
      alert('이름 써주세요!')
      return
    }
    if (!weeklyContent.trim()) {
      alert('주간계획 내용을 입력해주세요!')
      return
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: writerName.trim(),
        task_content: weeklyContent.trim(),
        type: '주간계획',
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`주간계획 등록 실패: ${error.message}`)
      return
    }

    alert('주간계획 등록 완료!')
    setWeeklyContent('')
    localStorage.removeItem('monz_weekly_content')
    await fetchTasks()
  }

  const handleOrderSubmit = async () => {
    if (!isOwnerView) {
      alert('사장님 인증부터 해주세요!')
      return
    }
    if (!orderData.to.trim() || !orderData.content.trim()) {
      alert('직원명과 지시 내용을 입력해주세요!')
      return
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: '사장님',
        task_content: orderData.content.trim(),
        type: '업무지시',
        target_name: orderData.to.trim(),
        instruction_status: '대기',
        instruction_result_mark: null,
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`업무지시 등록 실패: ${error.message}`)
      return
    }

    alert('업무지시 등록 완료!')
    setOrderData({ to: '', content: '' })
    setShowOrderModal(false)
    await fetchTasks()
  }

  const handleEmployeeRequestSubmit = async () => {
    if (!writerName.trim()) {
      alert('성함을 먼저 입력해주세요!')
      return
    }
    if (!employeeRequestData.to.trim() || !employeeRequestData.content.trim()) {
      alert('직원과 요청 내용을 입력해주세요!')
      return
    }
    if (normalizeEmployeeName(employeeRequestData.to) === normalizeEmployeeName(writerName)) {
      alert('본인에게는 업무요청을 보낼 수 없습니다.')
      return
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: writerName.trim(),
        task_content: employeeRequestData.content.trim(),
        type: '업무요청',
        target_name: employeeRequestData.to.trim(),
        instruction_status: '대기',
        instruction_result_mark: null,
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`업무요청 등록 실패: ${error.message}`)
      return
    }

    alert('업무요청 등록 완료!')
    setEmployeeRequestData({ to: '', content: '' })
    setShowEmployeeRequestModal(false)
    await fetchTasks()
  }

  const openProductionModal = () => {
    setProductionDate(getKSTDateString())
    setProducerName((prev) => prev || writerName.trim())
    setManualDraft(productionManualItems.map((item) => item.text).join('\n'))
    setProductionAnswers((prev) => {
      const next = { ...prev }
      productionCheckItems.forEach((item) => {
        if (!next[item.id]) next[item.id] = { answer: '', note: '' }
      })
      return next
    })
    setShowProductionModal(true)
  }

  const handleSaveProductionManual = async () => {
    if (!isOwnerView) {
      alert('사장님 인증 후 수정할 수 있습니다.')
      return
    }

    const items = serializeProductionManualItems(manualDraft)
    if (items.length === 0) {
      alert('체크리스트 항목을 1개 이상 입력해주세요.')
      return
    }

    setLoading(true)

    const payload = {
      user_name: '사장님',
      task_content: JSON.stringify(items),
      type: PRODUCTION_MANUAL_TYPE,
      created_at: new Date().toISOString(),
    }

    const { error } = productionManualRow
      ? await supabase
          .from('MONZ')
          .update({
            task_content: payload.task_content,
            created_at: payload.created_at,
          })
          .eq('id', productionManualRow.id)
      : await supabase.from('MONZ').insert([payload])

    setLoading(false)

    if (error) {
      alert(`체크리스트 저장 실패: ${error.message}`)
      return
    }

    alert('체크리스트 저장 완료!')
    await fetchTasks()
  }

  const handleProductionSubmit = async () => {
    const producer = producerName.trim() || writerName.trim()
    if (!producer) {
      alert('생산자를 입력해주세요.')
      return
    }

    const missingItem = productionCheckItems.find((item) => !productionAnswers[item.id]?.answer)
    if (missingItem) {
      alert('모든 항목에 예/아니오를 체크해주세요.')
      return
    }

    const payload: ProductionCheckPayload = {
      date: productionDate,
      producer,
      answers: productionCheckItems.map((item) => ({
        itemId: item.id,
        text: item.text,
        answer: productionAnswers[item.id].answer as '예' | '아니오',
        note: productionAnswers[item.id].note || '',
      })),
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: producer,
        task_content: JSON.stringify(payload),
        type: PRODUCTION_CHECK_TYPE,
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`생산 체크 저장 실패: ${error.message}`)
      return
    }

    alert('생산 체크 저장 완료!')
    setProductionAnswers({})
    setShowProductionModal(false)
    await fetchTasks()
  }

  const handleAcupunctureRecipeSearch = async () => {
    const query = acupunctureRecipeQuery.trim()
    if (!query) {
      alert('검색할 약침명을 입력해주세요.')
      return
    }

    setAcupunctureRecipeLoading(true)
    setAcupunctureRecipeError('')
    setAcupunctureRecipeResults([])

    try {
      const response = await fetch(`/api/acupuncture-recipes?q=${encodeURIComponent(query)}`)
      const payload = (await response.json()) as { recipes?: AcupunctureRecipe[]; error?: string }

      if (!response.ok) {
        throw new Error(payload.error || '검색 중 오류가 발생했습니다.')
      }

      const recipes = payload.recipes || []
      setAcupunctureRecipeResults(recipes)
      setSelectedAcupunctureRecipeTitle(recipes[0]?.title || '')
      if (recipes.length === 0) {
        setAcupunctureRecipeError('검색 결과가 없습니다.')
      }
    } catch (error) {
      setAcupunctureRecipeError(error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.')
    } finally {
      setAcupunctureRecipeLoading(false)
    }
  }

  const handlePrintAcupunctureRecipe = (recipe: AcupunctureRecipe) => {
    if (recipe.printUrl) {
      window.open(recipe.printUrl, '_blank')
      return
    }

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('팝업이 차단되어 인쇄창을 열 수 없습니다.')
      return
    }

    const images = recipe.imageUrls
      .map((imageUrl) => `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.title)}" />`)
      .join('')
    const rows = recipe.fields
      .map((field) => `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(field.value).replace(/\n/g, '<br />')}</td></tr>`)
      .join('')

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(recipe.title)} 약침 생산 레시피</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { font-size: 22px; margin-bottom: 16px; }
            img { display: block; max-width: 100%; max-height: 92vh; object-fit: contain; margin: 0 0 16px; border: 2px solid #111; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #111; padding: 8px; vertical-align: top; text-align: left; }
            th { width: 180px; background: #f1f5f9; }
            @media print { button { display: none; } body { margin: 12mm; } }
          </style>
        </head>
        <body>
          <button onclick="window.print()" style="padding:10px 16px;margin-bottom:16px;">인쇄</button>
          <h1>${escapeHtml(recipe.title)} 약침 생산 레시피</h1>
          ${images}
          ${rows ? `<table>${rows}</table>` : ''}
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  const handleCloseAcupunctureRecipeModal = () => {
    const consentTitle = selectedAcupunctureRecipeTitle || acupunctureRecipeResults[0]?.title || acupunctureRecipeQuery.trim()
    if (acupunctureRecipeResults.length > 0 && consentTitle) {
      setPendingAcupunctureConsentTitle(consentTitle)
      setShowAcupunctureConsentPrompt(true)
      return
    }

    setShowAcupunctureRecipeModal(false)
  }

  const handleAcupunctureConsentAnswer = (agreed: boolean) => {
    if (agreed) {
      setAgreedAcupunctureRecipeTitle(pendingAcupunctureConsentTitle)
    } else {
      setAgreedAcupunctureRecipeTitle('')
    }

    setShowAcupunctureConsentPrompt(false)
    setPendingAcupunctureConsentTitle('')
    setShowAcupunctureRecipeModal(false)
  }

  const handleLeaveSubmit = async () => {
    if (!writerName.trim()) {
      alert('이름부터 입력해주세요!')
      return
    }
    if (!leaveData.date || !leaveData.content.trim()) {
      alert('날짜와 사유를 입력해주세요!')
      return
    }

    setLoading(true)

    const { error } = await supabase.from('MONZ').insert([
      {
        user_name: writerName.trim(),
        task_content: leaveData.content.trim(),
        type: leaveData.type,
        leave_date: leaveData.date,
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      alert(`연차/월차/반차 등록 실패: ${error.message}`)
      return
    }

    alert('신청 완료!')
    setLeaveData({ type: '연차', content: '', date: today })
    setShowLeaveModal(false)
    await fetchTasks()
  }

  const updateInstructionStatus = async (taskId: number, nextStatus: '확인' | '진행중' | '완료') => {
    if (nextStatus === '완료' && !window.confirm('정말 완료 하셨습니까?')) {
      return
    }

    const { error } = await supabase
      .from('MONZ')
      .update({
        instruction_status: nextStatus,
        instruction_checked_at: new Date().toISOString(),
      })
      .eq('id', taskId)

    if (error) {
      alert(`상태 변경 실패: ${error.message}`)
      return
    }

    await fetchTasks()
  }

  const updateInstructionResult = async (taskId: number, nextResult: InstructionResultMark) => {
    if (!isOwnerView) {
      alert('사장님 인증 후 평가할 수 있습니다.')
      return
    }

    const { error } = await supabase
      .from('MONZ')
      .update({
        instruction_result_mark: nextResult,
        instruction_result_at: new Date().toISOString(),
      })
      .eq('id', taskId)

    if (error) {
      alert(`평가 저장 실패: ${error.message}`)
      return
    }

    await fetchTasks()
  }

  const myInstructions = tasks.filter((task) => {
    if (!isInstructionType(task.type)) return false
    if (task.instruction_status === '완료') return false
    return matchesTarget(task.target_name, writerName)
  })

  const myHistoryTasks = useMemo(() => {
    const myName = normalizeEmployeeName(writerName)
    if (!myName) return []

    return tasks
      .filter((task) => {
        if (isSystemTaskType(task.type)) return false

        const taskDate = getTaskKSTDate(task)
        if (taskDate !== employeeHistoryDate) return false

        if (isInstructionType(task.type)) {
          return matchesTarget(task.target_name, writerName)
        }

        return normalizeEmployeeName(task.user_name) === myName
      })
      .sort((a, b) => {
        const aTime = new Date(a.created_at || '').getTime()
        const bTime = new Date(b.created_at || '').getTime()
        return bTime - aTime
      })
  }, [tasks, writerName, employeeHistoryDate])

  const filteredTasks = tasks.filter((task) => {
    if (isSystemTaskType(task.type)) return false

    if (ownerTab !== '전체') {
      if (ownerTab === '연차/월차/반차') {
        if (!isLeaveType(task.type)) return false
      } else if (task.type !== ownerTab) {
        return false
      }
    }

    if (!dateFilterEnabled) return true

    const taskDate = getTaskKSTDate(task)
    if (!taskDate) return false

    return taskDate >= fromDate && taskDate <= toDate
  })

  const leaveTasks = tasks.filter(
    (task) =>
      isLeaveType(task.type) &&
      !!task.leave_date &&
      task.leave_date.slice(0, 7) === calendarMonth
  )

  const leaveTaskMap = leaveTasks.reduce<Record<string, TaskRow[]>>((acc, task) => {
    const key = task.leave_date!
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const [year, month] = calendarMonth.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const firstWeekday = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  const calendarCells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i++) calendarCells.push(null)
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(`${calendarMonth}-${String(d).padStart(2, '0')}`)

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => (isOwnerView ? setShowOrderModal(true) : alert('사장님 PIN 인증부터 해주세요!'))}
            className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
          >
            📢 사장님전용 업무지시
          </button>
          <button
            onClick={() => setShowEmployeeRequestModal(true)}
            className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
          >
            🤝 직원용 업무요청
          </button>
        </div>
        <button
          onClick={openProductionModal}
          className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
        >
          ✅ 생산 메뉴얼 확인체크
        </button>
        <button
          onClick={() => setShowAcupunctureRecipeModal(true)}
          className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
        >
          💉 약침 생산 레시피
        </button>
        <button
          onClick={() => setShowLeaveModal(true)}
          className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
        >
          📅 연차/월차/반차
        </button>
      </div>

      <header className="max-w-5xl mx-auto mb-6 bg-teal-700 rounded-[2rem] p-8 text-white text-center shadow-lg">
        <h1 className="text-3xl font-bold text-white">한의N원외탕전</h1>
        <div className="mt-4 text-xl font-black text-amber-300">{today} 업무보고 시스템</div>
      </header>

      {writerName.trim() && myInstructions.length > 0 && (
        <div className="max-w-5xl mx-auto mb-6">
          <div className="bg-stone-100 border-2 border-black rounded-2xl p-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="text-center text-2xl font-black text-amber-600 mb-4">📢 업무지시/요청 확인하기</div>
            <div className="space-y-4">
              {myInstructions.map((task) => (
                <div
                  key={task.id}
                  className="bg-white border-2 border-black rounded-2xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex flex-wrap justify-between gap-3 mb-3">
                    <div className="font-black">
                      {task.type === '업무요청' ? `요청자: ${task.user_name}` : '사장님 지시'} · 대상: {task.target_name || '전체'}
                    </div>
                    <div className="text-sm font-black text-slate-500">{formatKSTDateTime(task.created_at)}</div>
                  </div>
                  <div className="font-bold whitespace-pre-wrap mb-4">{task.task_content}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-black border border-black ${statusColor(task.instruction_status)}`}>
                      상태: {task.instruction_status || '대기'}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-black border border-black ${resultColor(task.instruction_result_mark)}`}>
                      평가: {resultLabel(task.instruction_result_mark)} {task.instruction_result_mark ? `(${resultText(task.instruction_result_mark)})` : ''}
                    </span>
                    <button type="button" onClick={() => updateInstructionStatus(task.id, '확인')} className="px-3 py-2 rounded-lg border-2 border-black bg-sky-100 font-black text-sm">
                      확인
                    </button>
                    <button type="button" onClick={() => updateInstructionStatus(task.id, '진행중')} className="px-3 py-2 rounded-lg border-2 border-black bg-amber-100 font-black text-sm">
                      진행중
                    </button>
                    <button type="button" onClick={() => updateInstructionStatus(task.id, '완료')} className="px-3 py-2 rounded-lg border-2 border-black bg-emerald-100 font-black text-sm">
                      완료
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto mb-6">
        <input
          className="w-full p-3 border-2 border-black rounded-xl font-bold bg-white text-black"
          placeholder="성함"
          value={writerName}
          onChange={(e) => setWriterName(e.target.value)}
        />
      </div>

      {writerName.trim() && (
        <div className="max-w-5xl mx-auto mb-6">
          <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-xl font-black text-teal-800">📆 내 업무 기록</h2>
              <input
                type="date"
                value={employeeHistoryDate}
                onChange={(e) => setEmployeeHistoryDate(e.target.value)}
                className="border-2 border-black rounded-lg px-3 py-2 font-bold"
              />
            </div>

            <div className="space-y-3">
              {myHistoryTasks.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-300 p-4 text-center font-bold text-slate-400">
                  선택한 날짜에 표시할 기록이 없습니다.
                </div>
              ) : (
                myHistoryTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border-2 border-black bg-slate-50 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-black bg-white px-3 py-1 text-xs font-black">{task.type}</span>
                        {isInstructionType(task.type) && (
                          <>
                            <span className={`rounded-full border border-black px-3 py-1 text-xs font-black ${statusColor(task.instruction_status)}`}>
                              상태: {task.instruction_status || '대기'}
                            </span>
                            <span className={`rounded-full border border-black px-3 py-1 text-xs font-black ${resultColor(task.instruction_result_mark)}`}>
                              평가: {resultLabel(task.instruction_result_mark)}
                            </span>
                          </>
                        )}
                        {isLeaveType(task.type) && <span className="text-xs font-black text-slate-500">신청일: {formatKSTDateOnly(task.leave_date)}</span>}
                      </div>
                      <span className="text-sm font-black text-slate-500">{formatKSTDateTime(task.created_at)}</span>
                    </div>
                    {isInstructionType(task.type) && (
                      <div className="mb-2 text-sm font-black text-slate-600">
                        {task.type === '업무요청' ? `요청자: ${task.user_name}` : '사장님 지시'} · 대상: {task.target_name || '전체'}
                      </div>
                    )}
                    {task.type === PRODUCTION_CHECK_TYPE ? (
                      <div className="whitespace-pre-wrap font-bold">
                        생산 메뉴얼 확인체크 완료
                        <div className="mt-1 text-sm text-slate-600">
                          {parseProductionCheckPayload(task.task_content)
                            ?.answers.map((answer) => `${answer.text}: ${answer.answer}${answer.note ? `(${answer.note})` : ''}`)
                            .join(' / ')}
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap font-bold">{task.task_content}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-xl font-black mb-3">📝 일일업무보고</h2>
          <textarea
            className="w-full h-40 p-4 border-2 border-black rounded-xl font-bold bg-white text-black"
            placeholder="업무 내용을 입력하세요..."
            value={dailyContent}
            onChange={(e) => setDailyContent(e.target.value)}
          />
          <button
            onClick={handleDailySubmit}
            disabled={loading}
            className="w-full mt-4 bg-black text-white py-4 rounded-xl font-black text-xl shadow-lg disabled:opacity-60"
          >
            {loading ? '등록 중...' : '오늘 보고 등록'}
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-xl font-black mb-3 text-indigo-700">📅 주간계획업무</h2>
          <textarea
            className="w-full h-32 p-4 border-2 border-black rounded-xl font-bold bg-white text-black"
            placeholder="이번 주 계획 업무를 입력하세요..."
            value={weeklyContent}
            onChange={(e) => setWeeklyContent(e.target.value)}
          />
          <button
            onClick={handleWeeklySubmit}
            disabled={loading}
            className="w-full mt-4 bg-indigo-700 text-white py-4 rounded-xl font-black text-xl shadow-lg disabled:opacity-60"
          >
            {loading ? '등록 중...' : '주간계획 등록'}
          </button>
        </div>

        <div className="pt-10 border-t-4 border-dashed border-slate-300">
          <div className="flex flex-col gap-4 mb-6 px-2">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-teal-800">📋 사장님 전용</h2>
              {!isOwnerView ? (
                <div className="flex gap-2 bg-slate-800 p-2 rounded-xl">
                  <input
                    type="password"
                    placeholder="PIN"
                    className="w-20 bg-transparent text-white text-center font-bold outline-none"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                  <button
                    onClick={() => (pin === OWNER_PIN ? setIsOwnerView(true) : alert('PIN이 틀렸습니다.'))}
                    className="bg-amber-400 px-3 py-1 rounded-lg font-black text-xs"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <button onClick={() => setIsOwnerView(false)} className="text-xs font-bold text-rose-500 underline">
                  인증 해제
                </button>
              )}
            </div>

            {isOwnerView && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(['전체', '일일업무', '주간계획', '연차/월차/반차', '업무지시', '업무요청', '생산체크'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setOwnerTab(tab)}
                      className={`px-4 py-2 rounded-xl border-2 border-black font-bold ${ownerTab === tab ? 'bg-teal-700 text-white' : 'bg-white'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border-2 border-black p-4">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <label className="flex items-center gap-2 font-bold">
                      <input type="checkbox" checked={dateFilterEnabled} onChange={(e) => setDateFilterEnabled(e.target.checked)} />
                      날짜 필터 사용
                    </label>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border-2 border-black rounded-lg px-3 py-2 font-bold" />
                    <span className="font-bold">~</span>
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border-2 border-black rounded-lg px-3 py-2 font-bold" />
                    <button
                      onClick={() => {
                        setFromDate(today)
                        setToDate(today)
                        setDateFilterEnabled(true)
                      }}
                      className="px-3 py-2 rounded-lg bg-slate-100 border border-black font-bold"
                    >
                      오늘로
                    </button>
                    <button onClick={() => setDateFilterEnabled(false)} className="px-3 py-2 rounded-lg bg-slate-100 border border-black font-bold">
                      전체보기
                    </button>
                  </div>
                </div>

                {ownerTab === '업무지시' && (
                  <div className="bg-white rounded-2xl border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="text-xl font-black text-teal-700">📊 업무평가 통계</h3>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEvaluationMode('month')}
                          className={`px-4 py-2 rounded-xl border-2 border-black font-black ${
                            evaluationMode === 'month' ? 'bg-teal-700 text-white' : 'bg-white text-black'
                          }`}
                        >
                          월별
                        </button>

                        <button
                          type="button"
                          onClick={() => setEvaluationMode('year')}
                          className={`px-4 py-2 rounded-xl border-2 border-black font-black ${
                            evaluationMode === 'year' ? 'bg-teal-700 text-white' : 'bg-white text-black'
                          }`}
                        >
                          연도별
                        </button>

                        {evaluationMode === 'month' ? (
                          <>
                            <span className="text-sm font-black text-slate-500 ml-2">기준월</span>
                            <input
                              type="month"
                              value={evaluationMonth}
                              onChange={(e) => setEvaluationMonth(e.target.value)}
                              className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                            />
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-black text-slate-500 ml-2">기준연도</span>
                            <input
                              type="number"
                              min="2000"
                              max="2100"
                              value={evaluationYear}
                              onChange={(e) => setEvaluationYear(e.target.value)}
                              className="w-28 border-2 border-black rounded-lg px-3 py-2 font-bold"
                            />
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                      <div className="rounded-2xl border-2 border-black bg-emerald-50 p-4">
                        <div className="text-sm font-black text-slate-500">○ 완료 인정</div>
                        <div className="text-3xl font-black text-emerald-600 mt-1">{evaluationStats.total.circle}건</div>
                      </div>
                      <div className="rounded-2xl border-2 border-black bg-amber-50 p-4">
                        <div className="text-sm font-black text-slate-500">△ 보완 필요</div>
                        <div className="text-3xl font-black text-amber-500 mt-1">{evaluationStats.total.triangle}건</div>
                      </div>
                      <div className="rounded-2xl border-2 border-black bg-rose-50 p-4">
                        <div className="text-sm font-black text-slate-500">✕ 미흡</div>
                        <div className="text-3xl font-black text-rose-500 mt-1">{evaluationStats.total.x}건</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border-2 border-black overflow-hidden">
                      <div className="grid grid-cols-5 bg-slate-900 text-white text-center font-black text-sm">
                        <div className="p-3 text-left">직원명</div>
                        <div className="p-3">○</div>
                        <div className="p-3">△</div>
                        <div className="p-3">✕</div>
                        <div className="p-3">총 평가</div>
                      </div>

                      {evaluationStats.employeeRows.length === 0 ? (
                        <div className="p-5 text-center font-bold text-slate-400">
                          {evaluationMode === 'month' ? '이 달에 평가된 업무지시가 없습니다.' : '이 연도에 평가된 업무지시가 없습니다.'}
                        </div>
                      ) : (
                        evaluationStats.employeeRows.map((row) => (
                          <div key={row.name} className="grid grid-cols-5 text-center border-t-2 border-black font-bold bg-white">
                            <div className="p-3 text-left font-black">{row.name}</div>
                            <div className="p-3 text-emerald-600 font-black">{row.circle}</div>
                            <div className="p-3 text-amber-500 font-black">{row.triangle}</div>
                            <div className="p-3 text-rose-500 font-black">{row.x}</div>
                            <div className="p-3 font-black">{row.total}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {(ownerTab === '전체' || ownerTab === '생산체크') && (
                  <div className="bg-white rounded-2xl border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="text-xl font-black text-teal-700">✅ 생산 체크 기록</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setProductionHistoryMode('date')}
                          className={`px-4 py-2 rounded-xl border-2 border-black font-black ${
                            productionHistoryMode === 'date' ? 'bg-teal-700 text-white' : 'bg-white text-black'
                          }`}
                        >
                          날짜별
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductionHistoryMode('year')}
                          className={`px-4 py-2 rounded-xl border-2 border-black font-black ${
                            productionHistoryMode === 'year' ? 'bg-teal-700 text-white' : 'bg-white text-black'
                          }`}
                        >
                          연도별
                        </button>
                        {productionHistoryMode === 'date' ? (
                          <input
                            type="date"
                            value={productionHistoryDate}
                            onChange={(e) => setProductionHistoryDate(e.target.value)}
                            className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                          />
                        ) : (
                          <input
                            type="number"
                            min="2000"
                            max="2100"
                            value={productionHistoryYear}
                            onChange={(e) => setProductionHistoryYear(e.target.value)}
                            className="w-28 border-2 border-black rounded-lg px-3 py-2 font-bold"
                          />
                        )}
                        <select
                          value={productionHistoryProducer}
                          onChange={(e) => setProductionHistoryProducer(e.target.value)}
                          className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                        >
                          <option value="전체">전체 생산자</option>
                          {employeeOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
                      {productionSummaryRows.map((row) => (
                        <button
                          type="button"
                          key={row.name}
                          onClick={() => setProductionHistoryProducer(row.name)}
                          className={`rounded-xl border-2 border-black p-3 text-left font-black ${
                            productionHistoryProducer === row.name ? 'bg-teal-700 text-white' : 'bg-slate-50 text-black'
                          }`}
                        >
                          <div>{row.name}</div>
                          <div className="mt-1 text-2xl">{row.count}건</div>
                        </button>
                      ))}
                    </div>

                    {filteredProductionSubmissions.length === 0 ? (
                      <div className="rounded-2xl border-2 border-dashed border-slate-300 p-5 text-center font-bold text-slate-400">
                        조건에 맞는 생산 체크 기록이 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {filteredProductionSubmissions.map(({ task, payload }) => (
                          <div key={task.id} className="overflow-hidden rounded-2xl border-2 border-black bg-white">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-slate-100 p-3 font-black">
                              <span>생산자: {payload?.producer}</span>
                              <span className="text-slate-500">{formatKSTDateTime(task.created_at)}</span>
                            </div>
                            <div className="overflow-x-auto">
                              <div className="min-w-[720px]">
                                <div className="grid grid-cols-[1fr_80px_90px_1fr] bg-slate-900 text-center text-sm font-black text-white">
                                  <div className="p-3 text-left">체크 항목</div>
                                  <div className="p-3">예</div>
                                  <div className="p-3">아니오</div>
                                  <div className="p-3 text-left">비고</div>
                                </div>
                                {payload?.answers.map((answer) => (
                                  <div key={answer.itemId} className="grid grid-cols-[1fr_80px_90px_1fr] border-t border-slate-300 text-center">
                                    <div className="p-3 text-left font-bold">{answer.text}</div>
                                    <div className={`p-3 font-black ${answer.answer === '예' ? 'text-emerald-600' : 'text-slate-300'}`}>
                                      {answer.answer === '예' ? '✓' : '-'}
                                    </div>
                                    <div className={`p-3 font-black ${answer.answer === '아니오' ? 'text-rose-600' : 'text-slate-300'}`}>
                                      {answer.answer === '아니오' ? '✓' : '-'}
                                    </div>
                                    <div className="p-3 text-left font-bold text-slate-600">{answer.note || '-'}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(ownerTab === '전체' || ownerTab === '연차/월차/반차') && (
                  <div className="bg-white rounded-2xl border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="text-xl font-black text-rose-500">📅 연차/월차/반차 달력</h3>
                      <input
                        type="month"
                        value={calendarMonth}
                        onChange={(e) => {
                          setCalendarMonth(e.target.value)
                          setSelectedCalendarDate(`${e.target.value}-01`)
                        }}
                        className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                      />
                    </div>

                    <div className="mb-5 overflow-hidden rounded-2xl border-2 border-black">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-rose-50 p-3">
                        <h4 className="font-black">직원별 연차 현황</h4>
                        <span className="text-xs font-black text-slate-500">
                          {leaveSummaryYear}년 기준 · 기본 {DEFAULT_ANNUAL_LEAVE_LIMIT}회 · 이현택 16회(기존 4.5회 포함) · 안정은 15회(기존 5회 포함) · 전창식 11회(5월부터) · 조승 월차 5회(연차 2회+반차 3회)
                        </span>
                      </div>

                      <div className="grid grid-cols-[1.25fr_1fr_0.8fr_0.8fr_0.8fr_1fr] bg-slate-900 text-center text-xs font-black text-white sm:text-sm">
                        <div className="p-3 text-left">이름</div>
                        <div className="p-3">사용 합계</div>
                        <div className="p-3">연차</div>
                        <div className="p-3">반차</div>
                        <div className="p-3">월차</div>
                        <div className="p-3">잔여</div>
                      </div>

                      {leaveSummaryRows.length === 0 ? (
                        <div className="p-5 text-center font-bold text-slate-400">이 연도에 표시할 직원 기록이 없습니다.</div>
                      ) : (
                        leaveSummaryRows.map((row) => (
                          <div key={row.name} className="grid grid-cols-[1.25fr_1fr_0.8fr_0.8fr_0.8fr_1fr] border-t-2 border-black bg-white text-center text-sm font-bold">
                            <div className="truncate p-3 text-left font-black">{row.name}</div>
                            <div className="p-3 text-rose-600 font-black">
                              {formatLeaveCount(row.monthlyLimit === null ? row.annualConsumed : row.monthlyConsumed)}회
                              {row.priorUsed > 0 && <div className="text-[10px] text-slate-500">기존 {formatLeaveCount(row.priorUsed)}회</div>}
                              {row.monthlyLimit !== null && <div className="text-[10px] text-slate-500">월차 기준 {formatLeaveCount(row.monthlyLimit)}회</div>}
                            </div>
                            <div className="p-3 text-rose-600 font-black">{formatLeaveCount(row.annualUsed)}회</div>
                            <div className="p-3 text-amber-600 font-black">{formatLeaveCount(row.halfUsed)}회</div>
                            <div className="p-3 text-slate-700 font-black">{formatLeaveCount(row.monthlyUsed)}회</div>
                            <div className={`p-3 font-black ${row.remaining <= 2 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatLeaveCount(row.remaining)}회</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid grid-cols-7 gap-2 mb-4 text-center font-black">
                      {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
                        <div key={day} className="py-2">
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {calendarCells.map((date, idx) => {
                        const count = date ? leaveTaskMap[date]?.length || 0 : 0
                        const selected = date === selectedCalendarDate
                        return (
                          <button
                            key={`${date}-${idx}`}
                            disabled={!date}
                            onClick={() => date && setSelectedCalendarDate(date)}
                            className={`min-h-[74px] rounded-xl border-2 p-2 text-left ${
                              !date ? 'border-transparent bg-transparent' : selected ? 'border-rose-500 bg-rose-50' : 'border-black bg-white'
                            }`}
                          >
                            {date && (
                              <>
                                <div className="font-black">{Number(date.slice(-2))}</div>
                                {count > 0 && <div className="mt-2 inline-block rounded-full bg-rose-500 text-white text-xs px-2 py-1 font-black">{count}건</div>}
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-5 rounded-2xl border-2 border-black p-4 bg-slate-50">
                      <div className="font-black mb-3">선택 날짜: {formatKSTDateOnly(selectedCalendarDate)}</div>
                      <div className="space-y-3">
                        {(leaveTaskMap[selectedCalendarDate] || []).length === 0 ? (
                          <div className="font-bold text-slate-400">이 날짜의 연차/월차/반차 신청이 없습니다.</div>
                        ) : (
                          (leaveTaskMap[selectedCalendarDate] || []).map((task) => (
                            <div key={task.id} className="rounded-xl border-2 border-black bg-white p-3 flex justify-between gap-4">
                              <div>
                                <div className="font-black">
                                  [{task.type}] {task.user_name}
                                </div>
                                <div className="font-bold mt-1 whitespace-pre-wrap">{task.task_content}</div>
                              </div>
                              <div className="font-black text-sm whitespace-nowrap">{formatKSTDateTime(task.created_at)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {isOwnerView && ownerTab !== '생산체크' ? (
            <div className="space-y-4 px-2">
              {filteredTasks.length === 0 ? (
                <div className="bg-white p-10 rounded-2xl border-2 border-black text-center font-bold text-slate-400">등록된 항목이 없습니다.</div>
              ) : (
                filteredTasks.map((task) => (
                  <div key={task.id} className="p-5 rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-black">
                    <div className="flex justify-between mb-2 gap-4">
                      <div className="flex gap-2 items-center flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black border border-black ${
                            isInstructionType(task.type)
                              ? 'bg-amber-400'
                              : isLeaveType(task.type)
                                ? 'bg-rose-200'
                                : task.type === '주간계획'
                                  ? 'bg-indigo-200'
                                  : 'bg-slate-100'
                          }`}
                        >
                          {task.type}
                        </span>
                        {isInstructionType(task.type) && (
                          <>
                            <span className="text-xs font-black text-slate-500">
                              {task.type === '업무요청' ? `요청자: ${task.user_name}` : '사장님 지시'} · 대상: {task.target_name}
                            </span>
                            <span className={`text-xs font-black px-2 py-1 rounded-full border border-black ${statusColor(task.instruction_status)}`}>
                              상태: {task.instruction_status || '대기'}
                            </span>
                            <span className={`text-xs font-black px-2 py-1 rounded-full border border-black ${resultColor(task.instruction_result_mark)}`}>
                              평가: {resultLabel(task.instruction_result_mark)}
                            </span>
                          </>
                        )}
                        {isLeaveType(task.type) && <span className="text-xs font-black text-slate-500">신청일: {formatKSTDateOnly(task.leave_date)}</span>}
                      </div>
                      <span className="font-black text-sm text-right whitespace-nowrap">
                        {task.user_name} | {formatKSTDateTime(task.created_at)}
                      </span>
                    </div>

                    <p className="font-bold whitespace-pre-wrap">{task.task_content}</p>

                    {isInstructionType(task.type) && (
                      <div className="mt-4 rounded-2xl border-2 border-black bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-sm mr-2">업무결과 평가</span>
                          <button
                            type="button"
                            onClick={() => updateInstructionResult(task.id, 'CIRCLE')}
                            className={`px-4 py-2 rounded-xl border-2 border-black font-black text-lg ${task.instruction_result_mark === 'CIRCLE' ? 'bg-emerald-500 text-white' : 'bg-white'}`}
                          >
                            ○
                          </button>
                          <button
                            type="button"
                            onClick={() => updateInstructionResult(task.id, 'TRIANGLE')}
                            className={`px-4 py-2 rounded-xl border-2 border-black font-black text-lg ${task.instruction_result_mark === 'TRIANGLE' ? 'bg-amber-400 text-black' : 'bg-white'}`}
                          >
                            △
                          </button>
                          <button
                            type="button"
                            onClick={() => updateInstructionResult(task.id, 'X')}
                            className={`px-4 py-2 rounded-xl border-2 border-black font-black text-lg ${task.instruction_result_mark === 'X' ? 'bg-rose-500 text-white' : 'bg-white'}`}
                          >
                            ✕
                          </button>
                          <span className="ml-2 text-sm font-black text-slate-600">
                            현재: {resultLabel(task.instruction_result_mark)} {task.instruction_result_mark ? `(${resultText(task.instruction_result_mark)})` : ''}
                          </span>
                        </div>
                        {task.instruction_result_at && <div className="mt-2 text-xs font-bold text-slate-500">평가일시: {formatKSTDateTime(task.instruction_result_at)}</div>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : !isOwnerView ? (
            <div className="bg-white p-10 rounded-2xl border-2 border-black text-center font-bold text-slate-400 mx-2">관리자 인증 후 실시간으로 확인 가능합니다.</div>
          ) : null}
        </div>
      </div>

      {showEmployeeRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-md">
            <h2 className="text-xl font-black mb-4">🤝 직원용 업무요청</h2>
            <select
              className="w-full mb-2 p-3 border-2 border-black rounded-lg"
              value={employeeRequestData.to}
              onChange={(e) => setEmployeeRequestData({ ...employeeRequestData, to: e.target.value })}
            >
              <option value="">직원 선택</option>
              {employeeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <textarea
              className="w-full h-28 p-3 border-2 border-black rounded-lg mb-4"
              placeholder="업무요청 내용"
              value={employeeRequestData.content}
              onChange={(e) => setEmployeeRequestData({ ...employeeRequestData, content: e.target.value })}
            />
            <div className="flex gap-2">
              <button onClick={handleEmployeeRequestSubmit} disabled={loading} className="flex-1 bg-amber-500 text-white py-3 rounded-lg disabled:opacity-60">
                요청
              </button>
              <button onClick={() => setShowEmployeeRequestModal(false)} className="flex-1 bg-slate-200 py-3 rounded-lg">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showProductionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-xl font-black">✅ 생산 메뉴얼 확인체크</h2>
              <div className="text-sm font-black text-slate-500">{formatKSTDateOnly(productionDate)}</div>
            </div>

            <input
              className="w-full mb-4 p-3 border-2 border-black rounded-lg"
              placeholder="생산자"
              value={producerName}
              onChange={(e) => setProducerName(e.target.value)}
            />

            {isOwnerView && (
              <div className="mb-5 rounded-2xl border-2 border-black bg-amber-50 p-4">
                <div className="mb-2 font-black">사장님 체크리스트 수정</div>
                <textarea
                  className="w-full h-32 p-3 border-2 border-black rounded-lg bg-white"
                  value={manualDraft}
                  onChange={(e) => setManualDraft(e.target.value)}
                />
                <button onClick={handleSaveProductionManual} disabled={loading} className="mt-3 rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-60">
                  체크리스트 저장
                </button>
              </div>
            )}

            <div className="space-y-3">
              {productionCheckItems.map((item, index) => (
                <div key={item.id} className="rounded-2xl border-2 border-black bg-slate-50 p-4">
                  <div className="mb-3 font-black">
                    {index + 1}. {item.text}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {(['예', '아니오'] as const).map((answer) => (
                      <label key={answer} className="flex items-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-2">
                        <input
                          type="radio"
                          name={`production-${item.id}`}
                          checked={productionAnswers[item.id]?.answer === answer}
                          onChange={() =>
                            setProductionAnswers({
                              ...productionAnswers,
                              [item.id]: {
                                answer,
                                note: productionAnswers[item.id]?.note || '',
                              },
                            })
                          }
                        />
                        {answer}
                      </label>
                    ))}
                    <input
                      className="min-w-[220px] flex-1 rounded-lg border-2 border-black bg-white px-3 py-2"
                      placeholder="비고"
                      value={productionAnswers[item.id]?.note || ''}
                      onChange={(e) =>
                        setProductionAnswers({
                          ...productionAnswers,
                          [item.id]: {
                            answer: productionAnswers[item.id]?.answer || '',
                            note: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {productionSubmissions.length > 0 && (
              <div className="mt-5 rounded-2xl border-2 border-black bg-white p-4">
                <div className="mb-3 font-black">최근 생산 체크 기록</div>
                <div className="space-y-4">
                  {productionSubmissions.map(({ task, payload }) => (
                    <div key={task.id} className="overflow-hidden rounded-xl border-2 border-black text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-slate-100 p-3 font-black">
                        <span>생산자: {payload?.producer}</span>
                        <span className="text-slate-500">{formatKSTDateTime(task.created_at)}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_64px_78px_1fr] bg-slate-900 text-center text-xs font-black text-white">
                        <div className="p-2 text-left">체크 항목</div>
                        <div className="p-2">예</div>
                        <div className="p-2">아니오</div>
                        <div className="p-2 text-left">비고</div>
                      </div>
                      {payload?.answers.map((answer) => (
                        <div key={answer.itemId} className="grid grid-cols-[1fr_64px_78px_1fr] border-t border-slate-300 bg-white text-center">
                          <div className="p-2 text-left font-bold">{answer.text}</div>
                          <div className={`p-2 font-black ${answer.answer === '예' ? 'text-emerald-600' : 'text-slate-300'}`}>{answer.answer === '예' ? '✓' : '-'}</div>
                          <div className={`p-2 font-black ${answer.answer === '아니오' ? 'text-rose-600' : 'text-slate-300'}`}>{answer.answer === '아니오' ? '✓' : '-'}</div>
                          <div className="p-2 text-left font-bold text-slate-600">{answer.note || '-'}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {productionSubmissions.length === 0 && (
              <div className="mt-5 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4 text-center font-bold text-slate-400">
                아직 저장된 생산 체크 기록이 없습니다.
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={handleProductionSubmit} disabled={loading} className="flex-1 bg-teal-700 text-white py-3 rounded-lg disabled:opacity-60">
                체크 저장
              </button>
              <button onClick={() => setShowProductionModal(false)} className="flex-1 bg-slate-200 py-3 rounded-lg">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showAcupunctureRecipeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-xl font-black">💉 약침 생산 레시피</h2>
              <button onClick={handleCloseAcupunctureRecipeModal} className="rounded-lg bg-slate-200 px-4 py-2">
                닫기
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="flex-1 rounded-lg border-2 border-black p-3"
                placeholder="약침명 검색"
                value={acupunctureRecipeQuery}
                onChange={(e) => setAcupunctureRecipeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAcupunctureRecipeSearch()
                }}
              />
              <button onClick={handleAcupunctureRecipeSearch} disabled={acupunctureRecipeLoading} className="rounded-lg bg-teal-700 px-6 py-3 text-white disabled:opacity-60">
                {acupunctureRecipeLoading ? '검색 중...' : '검색'}
              </button>
            </div>

            {acupunctureRecipeError && (
              <div className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm font-black text-amber-700">
                {acupunctureRecipeError}
              </div>
            )}

            {selectedAcupunctureRecipeTitle && (
              <div className="mt-4 rounded-xl border-2 border-teal-700 bg-teal-50 p-3 text-sm font-black text-teal-800">
                선택한 약침: {selectedAcupunctureRecipeTitle}
              </div>
            )}

            <div className="mt-5 space-y-5">
              {acupunctureRecipeResults.map((recipe) => (
                <div
                  key={recipe.id}
                  className={`overflow-hidden rounded-2xl border-2 bg-white ${
                    selectedAcupunctureRecipeTitle === recipe.title ? 'border-teal-700' : 'border-black'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-slate-100 p-3 font-black">
                    <span>
                      {recipe.title}
                      {recipe.rowRange && <span className="ml-2 text-xs text-slate-500">{recipe.rowRange}</span>}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedAcupunctureRecipeTitle(recipe.title)}
                        className={`rounded-lg border-2 border-black px-3 py-2 text-sm ${
                          selectedAcupunctureRecipeTitle === recipe.title ? 'bg-teal-700 text-white' : 'bg-white text-black'
                        }`}
                      >
                        이 약침 생산 선택
                      </button>
                      <button type="button" onClick={() => handlePrintAcupunctureRecipe(recipe)} className="rounded-lg border-2 border-black bg-white px-3 py-2 text-sm">
                        인쇄
                      </button>
                      {recipe.sourceUrl && (
                        <button type="button" onClick={() => window.open(recipe.sourceUrl, '_blank')} className="rounded-lg border-2 border-black bg-white px-3 py-2 text-sm">
                          원본
                        </button>
                      )}
                    </div>
                  </div>

                  {recipe.imageUrls.length > 0 ? (
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      {recipe.imageUrls.map((imageUrl) => (
                        <img
                          key={imageUrl}
                          src={imageUrl}
                          alt={recipe.title}
                          className="max-h-[70vh] w-full rounded-xl border-2 border-black object-contain bg-white"
                        />
                      ))}
                    </div>
                  ) : recipe.printUrl ? (
                    <div className="p-4">
                      <iframe
                        src={recipe.printUrl}
                        title={`${recipe.title} 미리보기`}
                        className="h-[70vh] w-full rounded-xl border-2 border-black bg-white"
                      />
                    </div>
                  ) : (
                    <div className="p-4 font-bold text-slate-500">이미지 또는 미리보기 주소가 없는 결과입니다.</div>
                  )}

                  {recipe.fields.length > 0 && (
                    <div className="overflow-x-auto border-t-2 border-black">
                      <div className="min-w-[640px]">
                        {recipe.fields.map((field) => (
                          <div key={`${recipe.id}-${field.label}`} className="grid grid-cols-[180px_1fr] border-b border-slate-200 last:border-b-0">
                            <div className="bg-slate-50 p-3 font-black">{field.label}</div>
                            <div className="whitespace-pre-wrap p-3 font-bold">{field.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAcupunctureConsentPrompt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] p-4 text-black font-bold">
          <div className="w-full max-w-sm rounded-2xl border-4 border-black bg-white p-6">
            <h2 className="mb-3 text-xl font-black">생산에 동의하십니까?</h2>
            <div className="mb-5 whitespace-pre-wrap text-sm font-bold text-slate-700">
              {formatAcupunctureProductionName(pendingAcupunctureConsentTitle)}을 생산 메뉴얼 체크에 반영할까요?
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAcupunctureConsentAnswer(true)} className="flex-1 rounded-lg bg-teal-700 py-3 text-white">
                네
              </button>
              <button onClick={() => handleAcupunctureConsentAnswer(false)} className="flex-1 rounded-lg bg-slate-200 py-3">
                아니오
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-md">
            <h2 className="text-xl font-black mb-4">📢 사장님전용 업무지시</h2>
            <input
              className="w-full mb-2 p-3 border-2 border-black rounded-lg"
              placeholder="직원명"
              value={orderData.to}
              onChange={(e) => setOrderData({ ...orderData, to: e.target.value })}
            />
            <textarea
              className="w-full h-28 p-3 border-2 border-black rounded-lg mb-4"
              placeholder="내용"
              value={orderData.content}
              onChange={(e) => setOrderData({ ...orderData, content: e.target.value })}
            />
            <div className="flex gap-2">
              <button onClick={handleOrderSubmit} className="flex-1 bg-teal-600 text-white py-3 rounded-lg">
                전송
              </button>
              <button onClick={() => setShowOrderModal(false)} className="flex-1 bg-slate-200 py-3 rounded-lg">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-sm">
            <h2 className="text-xl font-black mb-4">📅 연차/월차/반차 신청</h2>
            <select
              className="w-full mb-2 p-3 border-2 border-black rounded-lg"
              value={leaveData.type}
              onChange={(e) => setLeaveData({ ...leaveData, type: e.target.value })}
            >
              <option value="연차">연차</option>
              <option value="월차">월차</option>
              <option value="반차">반차</option>
            </select>
            <input
              type="date"
              className="w-full mb-2 p-3 border-2 border-black rounded-lg"
              value={leaveData.date}
              onChange={(e) => setLeaveData({ ...leaveData, date: e.target.value })}
            />
            <textarea
              className="w-full h-24 p-3 border-2 border-black rounded-lg mb-4"
              placeholder="사유"
              value={leaveData.content}
              onChange={(e) => setLeaveData({ ...leaveData, content: e.target.value })}
            />
            <div className="flex gap-2">
              <button onClick={handleLeaveSubmit} className="flex-1 bg-rose-500 text-white py-3 rounded-lg">
                등록
              </button>
              <button onClick={() => setShowLeaveModal(false)} className="flex-1 bg-slate-200 py-3 rounded-lg">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
