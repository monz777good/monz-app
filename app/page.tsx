'use client'

import { useEffect, useMemo, useState } from 'react'
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
  created_at: string
}

export default function Home() {
  const [writerName, setWriterName] = useState('')
  const [isOwnerView, setIsOwnerView] = useState(false)
  const [pin, setPin] = useState('')
  const OWNER_PIN = '1919'

  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)

  const [orderData, setOrderData] = useState({ to: '', content: '' })
  const [leaveData, setLeaveData] = useState({ type: '연차', content: '', date: '' })

  const [dailyContent, setDailyContent] = useState('')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(false)

  const today = useMemo(() => {
    const now = new Date()
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    return kst.toISOString().slice(0, 10)
  }, [])

  const formatDateTime = (value: string) => {
    if (!value) return '-'
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

  useEffect(() => {
    const savedName = localStorage.getItem('monz_name')
    if (savedName) setWriterName(savedName)
    setLeaveData((prev) => ({ ...prev, date: today }))
    fetchData()

    const channel = supabase
      .channel('monz-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'MONZ' },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [today])

  useEffect(() => {
    localStorage.setItem('monz_name', writerName)
  }, [writerName])

  const fetchData = async () => {
    const { data, error } = await supabase
      .from('MONZ')
      .select('id, user_name, task_content, type, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('fetchData error:', error)
      return
    }

    setTasks((data as TaskRow[]) || [])
  }

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

    const payload = {
      user_name: writerName.trim(),
      task_content: dailyContent.trim(),
      type: '일일업무',
      created_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('MONZ').insert([payload])

    setLoading(false)

    if (error) {
      console.error('handleFinalSubmit error:', error)
      alert(`등록 실패: ${error.message}`)
      return
    }

    alert('보고 완료!')
    setDailyContent('')
    await fetchData()
  }

  const handleOrderSubmit = async () => {
    if (!isOwnerView) {
      alert('관리자 인증부터 해주세요!')
      return
    }

    if (!orderData.to.trim() || !orderData.content.trim()) {
      alert('담당자와 내용을 입력해주세요!')
      return
    }

    setLoading(true)

    const payload = {
      user_name: `[지시] To.${orderData.to.trim()}`,
      task_content: orderData.content.trim(),
      type: '업무지시',
      created_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('MONZ').insert([payload])

    setLoading(false)

    if (error) {
      console.error('handleOrderSubmit error:', error)
      alert(`지시 등록 실패: ${error.message}`)
      return
    }

    alert('지시 완료!')
    setOrderData({ to: '', content: '' })
    setShowOrderModal(false)
    await fetchData()
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

    const payload = {
      user_name: writerName.trim(),
      task_content: `[${leaveData.type}] ${leaveData.content.trim()}`,
      type: leaveData.type,
      created_at: new Date(`${leaveData.date}T09:00:00+09:00`).toISOString(),
    }

    const { error } = await supabase.from('MONZ').insert([payload])

    setLoading(false)

    if (error) {
      console.error('handleLeaveSubmit error:', error)
      alert(`신청 실패: ${error.message}`)
      return
    }

    alert('신청 완료!')
    setLeaveData({ type: '연차', content: '', date: today })
    setShowLeaveModal(false)
    await fetchData()
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 font-sans text-slate-900">
      <div className="max-w-4xl mx-auto flex justify-between mb-4">
        <button
          onClick={() => (isOwnerView ? setShowOrderModal(true) : alert('인증부터!'))}
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

      <header className="max-w-4xl mx-auto mb-10 bg-teal-700 rounded-[2rem] p-8 text-white text-center shadow-lg">
        <h1 className="text-3xl font-bold text-white">한의N원외탕전</h1>
        <div className="mt-4 text-xl font-black text-amber-300">{today} 업무보고 시스템</div>
      </header>

      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <input
            className="w-full mb-4 p-3 border-2 border-black rounded-xl font-bold bg-white text-black"
            placeholder="성함"
            value={writerName}
            onChange={(e) => setWriterName(e.target.value)}
          />

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
          <div className="flex justify-between items-center mb-6 px-2">
            <h2 className="text-2xl font-black text-teal-800">📋 전체 업무 내역</h2>

            {!isOwnerView ? (
              <div className="flex gap-2 bg-slate-800 p-2 rounded-xl">
                <input
                  type="password"
                  placeholder="PIN"
                  className="w-16 bg-transparent text-white text-center font-bold outline-none"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <button
                  onClick={() => (pin === OWNER_PIN ? setIsOwnerView(true) : alert('틀림'))}
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

          {isOwnerView ? (
            <div className="space-y-4 px-2">
              {tasks.length === 0 ? (
                <div className="bg-white p-10 rounded-2xl border-2 border-black text-center font-bold text-slate-400">
                  등록된 업무가 없습니다.
                </div>
              ) : (
                tasks.map((t) => (
                  <div
                    key={t.id}
                    className="p-5 rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-black"
                  >
                    <div className="flex justify-between mb-2 gap-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black border border-black ${
                          t.type === '업무지시'
                            ? 'bg-amber-400'
                            : t.type === '연차' || t.type === '월차'
                              ? 'bg-rose-200'
                              : 'bg-slate-100'
                        }`}
                      >
                        {t.type}
                      </span>

                      <span className="font-black text-sm text-right">
                        {t.user_name} | {formatDateTime(t.created_at)}
                      </span>
                    </div>

                    <p className="font-bold whitespace-pre-wrap">{t.task_content}</p>
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
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-sm">
            <h2 className="text-xl font-black mb-4 font-bold">📢 업무 지시</h2>

            <input
              className="w-full mb-2 p-2 border-2 border-black rounded-lg"
              placeholder="담당자"
              value={orderData.to}
              onChange={(e) => setOrderData({ ...orderData, to: e.target.value })}
            />

            <textarea
              className="w-full h-24 p-2 border-2 border-black rounded-lg mb-4"
              placeholder="내용"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-black font-bold">
          <div className="bg-white p-6 rounded-2xl border-4 border-black w-full max-w-sm">
            <h2 className="text-xl font-black mb-4">📅 연차/월차 신청</h2>

            <select
              className="w-full mb-2 p-2 border-2 border-black rounded-lg"
              value={leaveData.type}
              onChange={(e) => setLeaveData({ ...leaveData, type: e.target.value })}
            >
              <option value="연차">연차</option>
              <option value="월차">월차</option>
            </select>

            <input
              type="date"
              className="w-full mb-2 p-2 border-2 border-black rounded-lg"
              value={leaveData.date}
              onChange={(e) => setLeaveData({ ...leaveData, date: e.target.value })}
            />

            <textarea
              className="w-full h-20 p-2 border-2 border-black rounded-lg mb-4"
              placeholder="사유"
              value={leaveData.content}
              onChange={(e) => setLeaveData({ ...leaveData, content: e.target.value })}
            />

            <div className="flex gap-2">
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