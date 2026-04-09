'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
}

const OWNER_PIN = '1919'

function getKSTDateString(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
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
  if (task.type === '연차' || task.type === '월차') {
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

export default function Home() {
  const today = useMemo(() => getKSTDateString(), [])

  const [writerName, setWriterName] = useState('')
  const [dailyContent, setDailyContent] = useState('')
  const [loading, setLoading] = useState(false)

  const [isOwnerView, setIsOwnerView] = useState(false)
  const [pin, setPin] = useState('')

  const [tasks, setTasks] = useState<TaskRow[]>([])

  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)

  const [orderData, setOrderData] = useState({
    to: '',
    content: '',
  })

  const [leaveData, setLeaveData] = useState({
    type: '연차',
    content: '',
    date: today,
  })

  const [ownerTab, setOwnerTab] = useState<'전체' | '일일업무' | '연차/월차' | '업무지시'>('전체')
  const [dateFilterEnabled, setDateFilterEnabled] = useState(true)
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)

  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(today)

  useEffect(() => {
    const savedName = localStorage.getItem('monz_name')
    if (savedName) setWriterName(savedName)
    fetchTasks()
  }, [])

  useEffect(() => {
    localStorage.setItem('monz_name', writerName)
  }, [writerName])

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from('MONZ')
      .select(
        'id, user_name, task_content, type, created_at, leave_date, target_name, instruction_status, instruction_checked_at'
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
    fetchTasks()
    const timer = setInterval(() => {
      fetchTasks()
    }, 10000)

    return () => clearInterval(timer)
  }, [fetchTasks])

  const handleFinalSubmit = async () => {
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
      console.error('handleFinalSubmit error:', error)
      alert(`보고 등록 실패: ${error.message}`)
      return
    }

    alert('보고 완료!')
    setDailyContent('')
    await fetchTasks()
  }

  const handleOrderSubmit = async () => {
    if (!isOwnerView) {
      alert('관리자 인증부터 해주세요!')
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
        created_at: new Date().toISOString(),
      },
    ])

    setLoading(false)

    if (error) {
      console.error('handleOrderSubmit error:', error)
      alert(`업무지시 등록 실패: ${error.message}`)
      return
    }

    alert('업무지시 등록 완료!')
    setOrderData({ to: '', content: '' })
    setShowOrderModal(false)
    await fetchTasks()
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
      console.error('handleLeaveSubmit error:', error)
      alert(`연차/월차 등록 실패: ${error.message}`)
      return
    }

    alert('신청 완료!')
    setLeaveData({ type: '연차', content: '', date: today })
    setShowLeaveModal(false)
    await fetchTasks()
  }

  const updateInstructionStatus = async (taskId: number, nextStatus: '확인' | '진행중' | '완료') => {
    const { error } = await supabase
      .from('MONZ')
      .update({
        instruction_status: nextStatus,
        instruction_checked_at: new Date().toISOString(),
      })
      .eq('id', taskId)

    if (error) {
      console.error('updateInstructionStatus error:', error)
      alert(`상태 변경 실패: ${error.message}`)
      return
    }

    await fetchTasks()
  }

  const myInstructions = tasks.filter((task) => {
    if (task.type !== '업무지시') return false
    if (!writerName.trim()) return false
    return task.target_name === writerName.trim() || task.target_name === '전체'
  })

  const activeInstructions = myInstructions.filter((task) => task.instruction_status !== '완료')

  const filteredTasks = tasks.filter((task) => {
    if (ownerTab !== '전체') {
      if (ownerTab === '연차/월차') {
        if (!(task.type === '연차' || task.type === '월차')) return false
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
      (task.type === '연차' || task.type === '월차') &&
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
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(`${calendarMonth}-${String(d).padStart(2, '0')}`)
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto flex justify-between mb-4">
        <button
          onClick={() => (isOwnerView ? setShowOrderModal(true) : alert('사장님 PIN 인증부터 해주세요!'))}
          className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
        >
          📢 업무지시
        </button>

        <button
          onClick={() => setShowLeaveModal(true)}
          className="bg-white p-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm"
        >
          📅 연차/월차
        </button>
      </div>

      <header className="max-w-5xl mx-auto mb-6 bg-teal-700 rounded-[2rem] p-8 text-white text-center shadow-lg">
        <h1 className="text-3xl font-bold text-white">한의N원외탕전</h1>
        <div className="mt-4 text-xl font-black text-amber-300">{today} 업무보고 시스템</div>
      </header>

      {/* 직원 전용 상단 가운데 업무지시 확인 카드 */}
      {writerName.trim() && activeInstructions.length > 0 && (
        <div className="max-w-5xl mx-auto mb-6">
          <div className="bg-amber-50 border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="text-center text-2xl font-black text-amber-600 mb-4">
              📢 업무지시 확인하기
            </div>

            <div className="space-y-4">
              {activeInstructions.map((task) => (
                <div
                  key={task.id}
                  className="bg-white border-2 border-black rounded-2xl p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex flex-wrap justify-between gap-3 mb-3">
                    <div className="font-black">
                      대상: {task.target_name || '전체'}
                    </div>
                    <div className="text-sm font-black text-slate-500">
                      {formatKSTDateTime(task.created_at)}
                    </div>
                  </div>

                  <div className="font-bold whitespace-pre-wrap mb-4">{task.task_content}</div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-black border border-black ${statusColor(task.instruction_status)}`}>
                      상태: {task.instruction_status || '대기'}
                    </span>

                    <button
                      onClick={() => updateInstructionStatus(task.id, '확인')}
                      className="px-3 py-2 rounded-lg border-2 border-black bg-sky-100 font-black text-sm"
                    >
                      확인
                    </button>

                    <button
                      onClick={() => updateInstructionStatus(task.id, '진행중')}
                      className="px-3 py-2 rounded-lg border-2 border-black bg-amber-100 font-black text-sm"
                    >
                      진행중
                    </button>

                    <button
                      onClick={() => updateInstructionStatus(task.id, '완료')}
                      className="px-3 py-2 rounded-lg border-2 border-black bg-emerald-100 font-black text-sm"
                    >
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

      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <textarea
            className="w-full h-40 p-4 border-2 border-black rounded-xl font-bold bg-white text-black"
            placeholder="업무 내용을 입력하세요..."
            value={dailyContent}
            onChange={(e) => setDailyContent(e.target.value)}
          />
          <button
            onClick={handleFinalSubmit}
            disabled={loading}
            className="w-full mt-4 bg-black text-white py-4 rounded-xl font-black text-xl shadow-lg disabled:opacity-60"
          >
            {loading ? '등록 중...' : '오늘 보고 등록'}
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
                <button
                  onClick={() => setIsOwnerView(false)}
                  className="text-xs font-bold text-rose-500 underline"
                >
                  인증 해제
                </button>
              )}
            </div>

            {isOwnerView && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(['전체', '일일업무', '연차/월차', '업무지시'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setOwnerTab(tab)}
                      className={`px-4 py-2 rounded-xl border-2 border-black font-bold ${
                        ownerTab === tab ? 'bg-teal-700 text-white' : 'bg-white'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border-2 border-black p-4">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <label className="flex items-center gap-2 font-bold">
                      <input
                        type="checkbox"
                        checked={dateFilterEnabled}
                        onChange={(e) => setDateFilterEnabled(e.target.checked)}
                      />
                      날짜 필터 사용
                    </label>

                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                    />

                    <span className="font-bold">~</span>

                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="border-2 border-black rounded-lg px-3 py-2 font-bold"
                    />

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

                    <button
                      onClick={() => setDateFilterEnabled(false)}
                      className="px-3 py-2 rounded-lg bg-slate-100 border border-black font-bold"
                    >
                      전체보기
                    </button>
                  </div>

                  <div className="text-sm font-bold text-slate-500">
                    한국시간 기준으로 필터링됩니다.
                  </div>
                </div>

                {(ownerTab === '전체' || ownerTab === '연차/월차') && (
                  <div className="bg-white rounded-2xl border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="text-xl font-black text-rose-500">📅 연차/월차 달력</h3>
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
                              !date
                                ? 'border-transparent bg-transparent'
                                : selected
                                  ? 'border-rose-500 bg-rose-50'
                                  : 'border-black bg-white'
                            }`}
                          >
                            {date && (
                              <>
                                <div className="font-black">{Number(date.slice(-2))}</div>
                                {count > 0 && (
                                  <div className="mt-2 inline-block rounded-full bg-rose-500 text-white text-xs px-2 py-1 font-black">
                                    {count}건
                                  </div>
                                )}
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-5 rounded-2xl border-2 border-black p-4 bg-slate-50">
                      <div className="font-black mb-3">
                        선택 날짜: {formatKSTDateOnly(selectedCalendarDate)}
                      </div>

                      <div className="space-y-3">
                        {(leaveTaskMap[selectedCalendarDate] || []).length === 0 ? (
                          <div className="font-bold text-slate-400">이 날짜의 연차/월차 신청이 없습니다.</div>
                        ) : (
                          (leaveTaskMap[selectedCalendarDate] || []).map((task) => (
                            <div
                              key={task.id}
                              className="rounded-xl border-2 border-black bg-white p-3 flex justify-between gap-4"
                            >
                              <div>
                                <div className="font-black">
                                  [{task.type}] {task.user_name}
                                </div>
                                <div className="font-bold mt-1 whitespace-pre-wrap">{task.task_content}</div>
                              </div>
                              <div className="font-black text-sm whitespace-nowrap">
                                {formatKSTDateTime(task.created_at)}
                              </div>
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

          {isOwnerView ? (
            <div className="space-y-4 px-2">
              {filteredTasks.length === 0 ? (
                <div className="bg-white p-10 rounded-2xl border-2 border-black text-center font-bold text-slate-400">
                  등록된 항목이 없습니다.
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-5 rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-black"
                  >
                    <div className="flex justify-between mb-2 gap-4">
                      <div className="flex gap-2 items-center flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black border border-black ${
                            task.type === '업무지시'
                              ? 'bg-amber-400'
                              : task.type === '연차' || task.type === '월차'
                                ? 'bg-rose-200'
                                : 'bg-slate-100'
                          }`}
                        >
                          {task.type}
                        </span>

                        {task.type === '업무지시' && task.target_name && (
                          <span className="text-xs font-black text-slate-500">
                            대상: {task.target_name}
                          </span>
                        )}

                        {task.type === '업무지시' && (
                          <span className={`text-xs font-black px-2 py-1 rounded-full border border-black ${statusColor(task.instruction_status)}`}>
                            상태: {task.instruction_status || '대기'}
                          </span>
                        )}

                        {(task.type === '연차' || task.type === '월차') && task.leave_date && (
                          <span className="text-xs font-black text-slate-500">
                            신청일: {formatKSTDateOnly(task.leave_date)}
                          </span>
                        )}
                      </div>

                      <span className="font-black text-sm text-right whitespace-nowrap">
                        {task.user_name} | {formatKSTDateTime(task.created_at)}
                      </span>
                    </div>

                    <p className="font-bold whitespace-pre-wrap">{task.task_content}</p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="bg-white p-10 rounded-2xl border-2 border-black text-center font-bold text-slate-400 mx-2">
              관리자 인증 후 실시간으로 확인 가능합니다.
            </div>
          )}
        </div>
      </div>

      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-md">
            <h2 className="text-xl font-black mb-4">📢 업무 지시</h2>

            <input
              className="w-full mb-2 p-3 border-2 border-black rounded-lg font-bold"
              placeholder="직원명 (예: 이현택 / 전체)"
              value={orderData.to}
              onChange={(e) => setOrderData({ ...orderData, to: e.target.value })}
            />

            <textarea
              className="w-full h-28 p-3 border-2 border-black rounded-lg mb-4 font-bold"
              placeholder="지시 내용"
              value={orderData.content}
              onChange={(e) => setOrderData({ ...orderData, content: e.target.value })}
            />

            <div className="flex gap-2 font-bold">
              <button
                onClick={handleOrderSubmit}
                className="flex-1 bg-teal-600 text-white py-3 rounded-lg"
              >
                전송
              </button>
              <button
                onClick={() => setShowOrderModal(false)}
                className="flex-1 bg-slate-200 py-3 rounded-lg"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-sm">
            <h2 className="text-xl font-black mb-4">📅 연차/월차 신청</h2>

            <select
              className="w-full mb-2 p-3 border-2 border-black rounded-lg font-bold"
              value={leaveData.type}
              onChange={(e) => setLeaveData({ ...leaveData, type: e.target.value })}
            >
              <option value="연차">연차</option>
              <option value="월차">월차</option>
            </select>

            <input
              type="date"
              className="w-full mb-2 p-3 border-2 border-black rounded-lg font-bold"
              value={leaveData.date}
              onChange={(e) => setLeaveData({ ...leaveData, date: e.target.value })}
            />

            <textarea
              className="w-full h-24 p-3 border-2 border-black rounded-lg mb-4 font-bold"
              placeholder="사유"
              value={leaveData.content}
              onChange={(e) => setLeaveData({ ...leaveData, content: e.target.value })}
            />

            <div className="flex gap-2 font-bold">
              <button
                onClick={handleLeaveSubmit}
                className="flex-1 bg-rose-500 text-white py-3 rounded-lg"
              >
                등록
              </button>
              <button
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 bg-slate-200 py-3 rounded-lg"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}