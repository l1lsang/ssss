import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
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

type ComfortResult = {
  status: 'generated' | 'skipped' | 'failed'
  comfort?: string
}

type ComfortOrigin = 'default' | 'generated' | 'fallback' | 'saved'

type EntryWithId = JournalEntry & {
  id: string
}

type ProfileDraft = {
  nickname: string
  discordId: string
  instagramId: string
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(firebaseReady)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    nickname: '',
    discordId: '',
    instagramId: '',
  })
  const [authError, setAuthError] = useState('')
  const [entries, setEntries] = useState<EntryWithId[]>([])
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [draft, setDraft] = useState<JournalEntry>(() => createEmptyEntry(selectedDate))
  const [notice, setNotice] = useState<Notice>({
    tone: 'calm',
    text: '답하지 못하는 칸은 비워두어도 괜찮아요.',
  })
  const [saving, setSaving] = useState(false)
  const [comfortLoading, setComfortLoading] = useState(false)
  const [comfortChecked, setComfortChecked] = useState(false)
  const [comfortOrigin, setComfortOrigin] = useState<ComfortOrigin>('default')

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
        setComfortOrigin('saved')
        setComfortChecked(true)
      } else {
        setDraft(createEmptyEntry(selectedDate))
        setComfortOrigin('default')
        setComfortChecked(false)
      }
    }

    loadEntry().catch(() => {
      if (!cancelled) {
        setDraft(createEmptyEntry(selectedDate))
        setComfortOrigin('default')
        setComfortChecked(false)
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
    const resetComfort = shouldResetComfort(key)

    setDraft((current) => ({
      ...current,
      [key]: value,
      comfort: resetComfort
        ? comfortForDate(key === 'date' ? (value as string) : current.date)
        : current.comfort,
    }))

    if (resetComfort) {
      setComfortOrigin('default')
      setComfortChecked(false)
    }
  }

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')

    try {
      if (authMode === 'signup') {
        const normalizedProfile = normalizeProfileDraft(profileDraft)

        if (!normalizedProfile.nickname) {
          setAuthError('닉네임을 입력해주세요.')
          return
        }

        if (!normalizedProfile.discordId && !normalizedProfile.instagramId) {
          setAuthError('디스코드 아이디나 인스타 아이디 중 하나를 입력해주세요.')
          return
        }

        const credential = await createUserWithEmailAndPassword(auth, email, password)

        await updateProfile(credential.user, {
          displayName: normalizedProfile.nickname,
        })
        await setDoc(doc(db, 'users', credential.user.uid), {
          ...normalizedProfile,
          email: credential.user.email ?? email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      setPassword('')
      setProfileDraft({ nickname: '', discordId: '', instagramId: '' })
      setNotice({ tone: 'good', text: '로그인됐어요. 오늘의 마음부터 천천히 적어볼게요.' })
    } catch (error) {
      setAuthError(authErrorMessage(error))
    }
  }

  const handleSave = async () => {
    if (!user || saving || comfortLoading) return

    const entryToSave = entryWithSelectedDate(draft, selectedDate)

    if (!hasEntryContent(entryToSave)) {
      setNotice({ tone: 'warn', text: '아무것도 쓰지 않아도 괜찮지만, 저장하려면 표시 하나만 남겨주세요.' })
      return
    }

    if (!comfortChecked) {
      setNotice({ tone: 'warn', text: '위로 문장을 작성자가 확인한 뒤 저장할 수 있어요.' })
      return
    }

    setSaving(true)
    setNotice({ tone: 'calm', text: '확인한 위로 문장과 함께 저장하고 있어요.' })

    try {
      const entryRef = doc(db, 'users', user.uid, 'entries', selectedDate)

      setDraft(entryToSave)
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
      setComfortOrigin('saved')
      setComfortChecked(true)
      setNotice(saveNotice(telegramResult))
    } catch {
      setNotice({ tone: 'warn', text: '저장하지 못했어요. Firebase 설정과 권한을 확인해주세요.' })
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateComfort = async () => {
    if (!user || comfortLoading || saving) return

    const baseEntry = entryWithSelectedDate(draft, selectedDate)

    if (!hasEntryContent(baseEntry)) {
      setNotice({ tone: 'warn', text: '위로 문장을 만들려면 표시 하나나 짧은 문장 하나를 남겨주세요.' })
      return
    }

    setComfortLoading(true)
    setComfortChecked(false)
    setNotice({ tone: 'calm', text: '작성자가 먼저 볼 수 있게 위로 문장을 쓰는 중이에요.' })

    try {
      const comfortResult = await generateComfort(user, baseEntry)
      const nextEntry = {
        ...baseEntry,
        comfort: comfortResult.comfort || baseEntry.comfort,
      }

      setDraft(nextEntry)
      setComfortOrigin(comfortResult.status === 'generated' ? 'generated' : 'fallback')
      setNotice(comfortNotice(comfortResult.status))
    } finally {
      setComfortLoading(false)
    }
  }

  const handleCheckComfort = () => {
    if (comfortOrigin === 'default') {
      setNotice({ tone: 'warn', text: '먼저 오늘 기록을 바탕으로 위로 문장을 만들어주세요.' })
      return
    }

    setComfortChecked(true)
    setNotice({ tone: 'good', text: '작성자가 확인했어요. 이제 이 문장으로 저장하고 보낼 수 있어요.' })
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

            <ComfortReview
              busy={saving}
              checked={comfortChecked}
              comfort={draft.comfort || comfortForDate(selectedDate)}
              loading={comfortLoading}
              origin={comfortOrigin}
              onCheck={handleCheckComfort}
              onGenerate={handleGenerateComfort}
            />

            <div className={`notice ${notice.tone}`} role="status" aria-live="polite">
              <span>{notice.text}</span>
              <small>{filledCount ? `${filledCount}개의 칸에 마음이 남아 있어요.` : '비어 있어도 괜찮아요.'}</small>
            </div>

            <div className="action-row">
              <button
                className="primary-button"
                type="button"
                onClick={handleSave}
                disabled={saving || comfortLoading}
              >
                {saving
                  ? '저장 중'
                  : comfortLoading
                    ? '위로 문장 작성 중'
                    : comfortChecked
                      ? '저장하고 텔레그램 보내기'
                      : '위로 문장 확인 후 저장'}
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
          profileDraft={profileDraft}
          error={authError}
          onAuthModeChange={(mode) => {
            setAuthError('')
            setAuthMode(mode)
          }}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onProfileChange={setProfileDraft}
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
  profileDraft: ProfileDraft
  error: string
  onAuthModeChange: (mode: 'login' | 'signup') => void
  onEmailChange: (email: string) => void
  onPasswordChange: (password: string) => void
  onProfileChange: (profile: ProfileDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function AuthPanel({
  authMode,
  email,
  password,
  profileDraft,
  error,
  onAuthModeChange,
  onEmailChange,
  onPasswordChange,
  onProfileChange,
  onSubmit,
}: AuthPanelProps) {
  const updateProfileDraft = (key: keyof ProfileDraft, value: string) => {
    onProfileChange({ ...profileDraft, [key]: value })
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <div>
        <p className="section-label">회원 공간</p>
        <h2 id="auth-title">{authMode === 'login' ? '로그인' : '회원가입'}</h2>
        <p className="auth-help">
          기록은 계정별로 따로 저장돼요. 가입할 때 닉네임과 연락 아이디를 함께 남겨요.
        </p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        {authMode === 'signup' ? (
          <div className="profile-fields">
            <label>
              <span>닉네임</span>
              <input
                type="text"
                value={profileDraft.nickname}
                onChange={(event) => updateProfileDraft('nickname', event.target.value)}
                placeholder="불리고 싶은 이름"
                maxLength={32}
                required
              />
            </label>
            <label>
              <span>디스코드 아이디</span>
              <input
                type="text"
                value={profileDraft.discordId}
                onChange={(event) => updateProfileDraft('discordId', event.target.value)}
                placeholder="예: friend#1234 또는 friend"
                maxLength={80}
              />
            </label>
            <label>
              <span>인스타 아이디</span>
              <input
                type="text"
                value={profileDraft.instagramId}
                onChange={(event) => updateProfileDraft('instagramId', event.target.value)}
                placeholder="예: my_account"
                maxLength={80}
              />
            </label>
            <p className="field-help">디스코드나 인스타 중 하나만 적어도 괜찮아요.</p>
          </div>
        ) : null}

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

type ComfortReviewProps = {
  busy: boolean
  checked: boolean
  comfort: string
  loading: boolean
  origin: ComfortOrigin
  onCheck: () => void
  onGenerate: () => void
}

function ComfortReview({
  busy,
  checked,
  comfort,
  loading,
  origin,
  onCheck,
  onGenerate,
}: ComfortReviewProps) {
  const canCheck = origin !== 'default' && !checked && !loading

  return (
    <section className={checked ? 'comfort-review checked' : 'comfort-review'} aria-labelledby="comfort-title">
      <header className="comfort-review-header">
        <div>
          <p className="section-label">작성자 확인</p>
          <h3 id="comfort-title">오늘의 위로 문장</h3>
        </div>
        <span className={checked ? 'comfort-status checked' : 'comfort-status'}>
          {comfortStatusText(origin, checked, loading)}
        </span>
      </header>
      <p className="comfort-preview">{loading ? '문장을 쓰는 중이에요.' : comfort}</p>
      <div className="comfort-actions">
        <button className="ghost-button" type="button" onClick={onGenerate} disabled={loading || busy}>
          {origin === 'default' ? '위로 문장 만들기' : '다시 만들기'}
        </button>
        <button className="primary-button" type="button" onClick={onCheck} disabled={!canCheck || busy}>
          {checked ? '확인 완료' : '확인했어요'}
        </button>
      </div>
    </section>
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

function normalizeProfileDraft(profile: ProfileDraft) {
  return {
    nickname: profile.nickname.trim(),
    discordId: profile.discordId.trim(),
    instagramId: profile.instagramId.trim().replace(/^@/, ''),
  }
}

function authErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''

  if (code.includes('auth/email-already-in-use')) return '이미 가입된 이메일이에요.'
  if (code.includes('auth/invalid-credential')) return '이메일이나 비밀번호를 다시 확인해주세요.'
  if (code.includes('auth/weak-password')) return '비밀번호는 6자 이상으로 만들어주세요.'
  if (code.includes('auth/configuration-not-found')) return 'Firebase Authentication 설정을 확인해주세요.'

  return '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.'
}

function shouldResetComfort(key: keyof JournalEntry) {
  return key !== 'comfort'
}

function entryWithSelectedDate(entry: JournalEntry, selectedDate: string): JournalEntry {
  return {
    ...entry,
    date: selectedDate,
    comfort: entry.comfort || comfortForDate(selectedDate),
  }
}

function comfortStatusText(origin: ComfortOrigin, checked: boolean, loading: boolean) {
  if (loading) return '작성 중'
  if (checked) return '확인 완료'
  if (origin === 'generated') return '확인 필요'
  if (origin === 'fallback') return '기본 문장 확인'
  if (origin === 'saved') return '저장된 문장'
  return '작성 전'
}

function comfortNotice(status: ComfortResult['status']): Notice {
  if (status === 'generated') {
    return { tone: 'good', text: '위로 문장을 준비했어요. 작성자가 확인하면 저장할 수 있어요.' }
  }

  if (status === 'skipped') {
    return { tone: 'warn', text: 'OpenAI 환경 변수가 비어 있어 기본 문장을 준비했어요. 작성자 확인이 필요해요.' }
  }

  return { tone: 'warn', text: 'GPT 문장 생성은 실패해서 기본 문장을 준비했어요. 작성자 확인이 필요해요.' }
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

async function generateComfort(user: User, entry: JournalEntry): Promise<ComfortResult> {
  try {
    const token = await user.getIdToken()
    const response = await fetch('/api/generate-comfort', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entry }),
    })
    const payload = (await response.json().catch(() => null)) as {
      generated?: boolean
      comfort?: string
    } | null

    if (!response.ok) return { status: 'failed' }

    return {
      status: payload?.generated ? 'generated' : 'skipped',
      comfort: payload?.comfort,
    }
  } catch {
    return { status: 'failed' }
  }
}

function saveNotice(telegramStatus: Awaited<ReturnType<typeof sendTelegramNotice>>): Notice {
  if (telegramStatus === 'sent') {
    return { tone: 'good', text: '확인한 위로 문장까지 저장됐고, 텔레그램으로도 보냈어요.' }
  }

  if (telegramStatus === 'skipped') {
    return { tone: 'good', text: '확인한 위로 문장까지 저장됐어요.' }
  }

  return { tone: 'warn', text: '일지는 저장됐어요. 텔레그램 전송은 Vercel API 설정을 확인해주세요.' }
}

export default App
