import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { auth, db, firebaseReady, missingFirebaseKeys } from './firebase'
import {
  comfortForDate,
  createEmptyEntry,
  emotionOptions,
  hasEntryContent,
  lifelineOptions,
  type JournalEntry,
  todayKey,
  weatherOptions,
} from './journal'
import './App.css'

type Notice = {
  tone: 'calm' | 'good' | 'warn'
  text: string
}

type EntryWithId = JournalEntry & {
  id: string
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(firebaseReady)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [entries, setEntries] = useState<EntryWithId[]>([])
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [draft, setDraft] = useState<JournalEntry>(() => createEmptyEntry(selectedDate))
  const [notice, setNotice] = useState<Notice>({
    tone: 'calm',
    text: '답하지 못하는 칸은 비워두어도 괜찮아요.',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!firebaseReady) return undefined

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) setEntries([])
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!user) return undefined

    const entriesQuery = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('date', 'desc'),
    )

    return onSnapshot(entriesQuery, (snapshot) => {
      setEntries(snapshot.docs.map((entryDoc) => normalizeEntry(entryDoc.id, entryDoc.data())))
    })
  }, [user])

  useEffect(() => {
    if (!user) return undefined

    let cancelled = false

    async function loadEntry() {
      const entryRef = doc(db, 'users', user!.uid, 'entries', selectedDate)
      const entrySnap = await getDoc(entryRef)

      if (cancelled) return

      if (entrySnap.exists()) {
        setDraft(normalizeEntry(entrySnap.id, entrySnap.data()))
      } else {
        setDraft(createEmptyEntry(selectedDate))
      }
    }

    loadEntry().catch(() => {
      if (!cancelled) {
        setDraft(createEmptyEntry(selectedDate))
      }
    })

    return () => {
      cancelled = true
    }
  }, [selectedDate, user])

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.date === selectedDate),
    [entries, selectedDate],
  )

  const filledCount = useMemo(() => {
    return [
      draft.weather,
      draft.emotions.length,
      draft.hardestMoment,
      draft.enduredMoment,
      draft.lifelines.length,
      draft.lifelineOther,
      draft.selfMessage,
      draft.tomorrowRequest,
    ].filter(Boolean).length
  }, [draft])

  const updateDraft = <Key extends keyof JournalEntry>(key: Key, value: JournalEntry[Key]) => {
    setDraft((current) => ({
      ...current,
      [key]: value,
      comfort: key === 'date' ? comfortForDate(value as string) : current.comfort,
    }))
  }

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')

    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      setPassword('')
      setNotice({ tone: 'good', text: '로그인됐어요. 오늘의 마음부터 천천히 적어볼게요.' })
    } catch (error) {
      setAuthError(authErrorMessage(error))
    }
  }

  const handleSave = async () => {
    if (!user || saving) return

    const entryToSave = {
      ...draft,
      date: selectedDate,
      comfort: comfortForDate(selectedDate),
    }

    if (!hasEntryContent(entryToSave)) {
      setNotice({ tone: 'warn', text: '아무것도 쓰지 않아도 괜찮지만, 저장하려면 표시 하나만 남겨주세요.' })
      return
    }

    setSaving(true)
    setNotice({ tone: 'calm', text: '조용히 저장하고 있어요.' })

    try {
      const entryRef = doc(db, 'users', user.uid, 'entries', selectedDate)
      await setDoc(
        entryRef,
        {
          ...entryToSave,
          updatedAt: serverTimestamp(),
          userEmail: user.email ?? '',
        },
        { merge: true },
      )

      const telegramResult = await sendTelegramNotice(user, entryToSave)

      if (telegramResult === 'sent') {
        setNotice({ tone: 'good', text: '저장됐고, 텔레그램으로도 보냈어요.' })
      } else if (telegramResult === 'skipped') {
        setNotice({ tone: 'good', text: '저장됐어요. 텔레그램 환경 변수는 아직 비어 있어요.' })
      } else {
        setNotice({ tone: 'warn', text: '일지는 저장됐어요. 텔레그램 전송은 Vercel API 설정을 확인해주세요.' })
      }
    } catch {
      setNotice({ tone: 'warn', text: '저장하지 못했어요. Firebase 설정과 권한을 확인해주세요.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDateChange = (date: string) => {
    const nextDate = date || todayKey()

    setSelectedDate(nextDate)
    updateDraft('date', nextDate)
  }

  return (
    <main className="journal">
      <section className="intro-section">
        <div className="intro-copy">
          <p className="kicker">데일리 감정 일지</p>
          <h1>오늘도 여기 있어줘서 고마워</h1>
          <p className="intro-text">
            로그인해서 하루에 한 번, 짧게 마음을 남겨요. 저장된 기록은 Firebase에
            보관되고, 저장 알림은 Vercel 서버를 통해 텔레그램으로 전송됩니다.
          </p>
        </div>

        <aside className="quiet-note" aria-label="작은 안내">
          <p>답하지 못하는 칸은 비워두어도 괜찮아요.</p>
          <p>단어 하나, 표시 하나, 공백도 오늘의 기록입니다.</p>
        </aside>
      </section>

      <section className="guide-section" aria-labelledby="guide-title">
        <div>
          <p className="section-label">사용 방법</p>
          <h2 id="guide-title">하루 5분이면 충분해요</h2>
        </div>
        <ol className="guide-list">
          <li>회원가입하거나 로그인해요.</li>
          <li>오늘 날짜의 마음을 짧게 적고 저장해요.</li>
          <li>지난 기록에서 다시 꺼내볼 수 있어요.</li>
        </ol>
        {user ? (
          <button className="ghost-button" type="button" onClick={() => signOut(auth)}>
            로그아웃
          </button>
        ) : null}
      </section>

      {!firebaseReady ? (
        <SetupPanel />
      ) : authLoading ? (
        <section className="state-panel">천천히 불러오는 중이에요.</section>
      ) : user ? (
        <section className="workspace" aria-label="감정 일지 작성 공간">
          <aside className="history-panel">
            <div>
              <p className="section-label">지난 기록</p>
              <h2>내가 지나온 날들</h2>
            </div>
            <p className="history-help">
              저장한 날짜를 누르면 그날의 기록을 다시 볼 수 있어요.
            </p>
            <div className="history-list">
              {entries.length ? (
                entries.map((entry) => (
                  <button
                    className={entry.date === selectedDate ? 'history-item active' : 'history-item'}
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedDate(entry.date)}
                  >
                    <span>{entry.date}</span>
                    <small>{entry.weather || entry.emotions[0] || '기록 있음'}</small>
                  </button>
                ))
              ) : (
                <p className="empty-history">아직 저장된 기록이 없어요.</p>
              )}
            </div>
          </aside>

          <section className="editor-panel">
            <header className="editor-header">
              <div>
                <p className="day-label">{selectedEntry ? '다시 열어본 기록' : '오늘의 기록'}</p>
                <h2>{selectedDate} 마음 기록</h2>
              </div>
              <label className="date-field">
                <span>오늘의 날짜</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => handleDateChange(event.target.value)}
                />
              </label>
            </header>

            <JournalField title="오늘 내 마음 날씨">
              <ChoiceGroup
                name="weather"
                options={weatherOptions}
                selected={draft.weather}
                onSelect={(option) => updateDraft('weather', option)}
              />
            </JournalField>

            <JournalField title="오늘의 감정 체크">
              <MultiChoiceGroup
                name="emotions"
                options={emotionOptions}
                selected={draft.emotions}
                onChange={(next) => updateDraft('emotions', next)}
              />
            </JournalField>

            <div className="writing-grid">
              <TextAreaField
                label="오늘 가장 힘들었던 순간"
                value={draft.hardestMoment}
                onChange={(value) => updateDraft('hardestMoment', value)}
                placeholder="짧게 적어도 괜찮아요."
              />
              <TextAreaField
                label="오늘 내가 버틴 순간"
                value={draft.enduredMoment}
                onChange={(value) => updateDraft('enduredMoment', value)}
                placeholder="사소해 보여도 괜찮아요."
              />
            </div>

            <JournalField title="오늘 나를 조금이라도 살게 해준 것">
              <MultiChoiceGroup
                name="lifelines"
                options={lifelineOptions}
                selected={draft.lifelines}
                onChange={(next) => updateDraft('lifelines', next)}
              />
              <label className="soft-input">
                <span>다른 것이 있다면</span>
                <input
                  type="text"
                  value={draft.lifelineOther}
                  onChange={(event) => updateDraft('lifelineOther', event.target.value)}
                  placeholder="떠오르는 만큼만"
                />
              </label>
            </JournalField>

            <div className="writing-grid">
              <TextAreaField
                label="지금 나에게 해주고 싶은 말 한 문장"
                value={draft.selfMessage}
                onChange={(value) => updateDraft('selfMessage', value)}
                placeholder="나에게 너무 엄격하지 않게."
              />
              <TextAreaField
                label="내일의 나에게 남기는 아주 작은 부탁"
                value={draft.tomorrowRequest}
                onChange={(value) => updateDraft('tomorrowRequest', value)}
                placeholder="작을수록 좋아요."
              />
            </div>

            <footer className="comfort-line">
              <span>오늘의 위로 문장</span>
              <p>{comfortForDate(selectedDate)}</p>
            </footer>

            <div className={`notice ${notice.tone}`} role="status" aria-live="polite">
              <span>{notice.text}</span>
              <small>{filledCount ? `${filledCount}개의 칸에 마음이 남아 있어요.` : '비어 있어도 괜찮아요.'}</small>
            </div>

            <div className="action-row">
              <button className="primary-button" type="button" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중' : '저장하고 텔레그램 보내기'}
              </button>
              <button className="ghost-button" type="button" onClick={() => window.print()}>
                인쇄하기
              </button>
            </div>
          </section>
        </section>
      ) : (
        <AuthPanel
          authMode={authMode}
          email={email}
          password={password}
          error={authError}
          onAuthModeChange={setAuthMode}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={handleAuth}
        />
      )}

      <section className="letter-section" aria-labelledby="letter-title">
        <p className="section-label">마지막 페이지</p>
        <h2 id="letter-title">친구에게 전하는 편지</h2>
        <div className="letter-body">
          <p>친구야,</p>
          <p>
            오늘도 여기까지 와줘서 고마워. 밝은 말을 하지 못해도, 괜찮은 척하지
            못해도, 너는 있는 그대로 이 자리에 있어도 돼.
          </p>
          <p>
            이 일지는 너를 고치려고 만든 것이 아니야. 네 마음을 밀어붙이지 않고, 오늘
            네가 어디쯤 있었는지 조용히 놓아두기 위한 자리야.
          </p>
          <p>
            내일이 너무 멀게 느껴지면, 아주 작은 것 하나만 부탁해도 돼. 물 한 모금,
            좋아하는 노래 한 곡, 잠깐의 숨 고르기. 그 정도면 충분해.
          </p>
          <p>오늘도 여기 있어줘서 고마워. 나는 네 편에 조용히 앉아 있을게.</p>
        </div>
      </section>
    </main>
  )
}

type AuthPanelProps = {
  authMode: 'login' | 'signup'
  email: string
  password: string
  error: string
  onAuthModeChange: (mode: 'login' | 'signup') => void
  onEmailChange: (email: string) => void
  onPasswordChange: (password: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function AuthPanel({
  authMode,
  email,
  password,
  error,
  onAuthModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: AuthPanelProps) {
  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <div>
        <p className="section-label">회원 공간</p>
        <h2 id="auth-title">{authMode === 'login' ? '로그인' : '회원가입'}</h2>
        <p className="auth-help">
          기록은 계정별로 따로 저장돼요. 비밀번호는 6자 이상으로 만들어주세요.
        </p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          <span>이메일</span>
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="friend@example.com"
            required
          />
        </label>
        <label>
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="6자 이상"
            minLength={6}
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit">
          {authMode === 'login' ? '로그인하기' : '가입하고 시작하기'}
        </button>
      </form>

      <button
        className="text-button"
        type="button"
        onClick={() => onAuthModeChange(authMode === 'login' ? 'signup' : 'login')}
      >
        {authMode === 'login' ? '처음이라면 회원가입하기' : '이미 계정이 있다면 로그인하기'}
      </button>
    </section>
  )
}

function SetupPanel() {
  return (
    <section className="setup-panel">
      <p className="section-label">설정 필요</p>
      <h2>Firebase 환경 변수가 아직 비어 있어요</h2>
      <p>
        `.env.local` 또는 Vercel 환경 변수에 아래 값을 넣으면 회원가입과 저장이
        작동합니다.
      </p>
      <code>{missingFirebaseKeys.join('\n')}</code>
    </section>
  )
}

type JournalFieldProps = {
  title: string
  children: React.ReactNode
}

function JournalField({ title, children }: JournalFieldProps) {
  return (
    <fieldset className="journal-field">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

type ChoiceGroupProps = {
  name: string
  options: string[]
  selected: string
  onSelect: (option: string) => void
}

function ChoiceGroup({ name, options, selected, onSelect }: ChoiceGroupProps) {
  return (
    <div className="choice-group">
      {options.map((option) => (
        <label className="choice-pill" key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={selected === option}
            onChange={() => onSelect(option)}
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  )
}

type MultiChoiceGroupProps = {
  name: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}

function MultiChoiceGroup({ name, options, selected, onChange }: MultiChoiceGroupProps) {
  const toggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((item) => item !== option))
    } else {
      onChange([...selected, option])
    }
  }

  return (
    <div className="choice-group">
      {options.map((option) => (
        <label className="choice-pill" key={option}>
          <input
            type="checkbox"
            name={name}
            value={option}
            checked={selected.includes(option)}
            onChange={() => toggle(option)}
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  )
}

type TextAreaFieldProps = {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}

function TextAreaField({ label, value, placeholder, onChange }: TextAreaFieldProps) {
  return (
    <label className="text-area-field">
      <span>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function normalizeEntry(id: string, data: Record<string, unknown>): EntryWithId {
  const date = getString(data.date) || id

  return {
    id,
    date,
    weather: getString(data.weather),
    emotions: getStringArray(data.emotions),
    hardestMoment: getString(data.hardestMoment),
    enduredMoment: getString(data.enduredMoment),
    lifelines: getStringArray(data.lifelines),
    lifelineOther: getString(data.lifelineOther),
    selfMessage: getString(data.selfMessage),
    tomorrowRequest: getString(data.tomorrowRequest),
    comfort: getString(data.comfort) || comfortForDate(date),
  }
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function authErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''

  if (code.includes('auth/email-already-in-use')) return '이미 가입된 이메일이에요.'
  if (code.includes('auth/invalid-credential')) return '이메일이나 비밀번호를 다시 확인해주세요.'
  if (code.includes('auth/weak-password')) return '비밀번호는 6자 이상으로 만들어주세요.'
  if (code.includes('auth/configuration-not-found')) return 'Firebase Authentication 설정을 확인해주세요.'

  return '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.'
}

async function sendTelegramNotice(user: User, entry: JournalEntry) {
  try {
    const token = await user.getIdToken()
    const response = await fetch('/api/send-telegram', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entry }),
    })
    const payload = (await response.json().catch(() => null)) as { sent?: boolean } | null

    if (!response.ok) return 'failed'
    return payload?.sent ? 'sent' : 'skipped'
  } catch {
    return 'failed'
  }
}

export default App
