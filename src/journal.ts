export type JournalEntry = {
  date: string
  weather: string
  emotions: string[]
  hardestMoment: string
  enduredMoment: string
  lifelines: string[]
  lifelineOther: string
  selfMessage: string
  tomorrowRequest: string
  comfort: string
}

export const weatherOptions = ['맑음', '흐림', '비', '폭풍', '안개', '잘 모르겠음']

export const emotionOptions = [
  '슬픔',
  '무기력',
  '불안',
  '외로움',
  '분노',
  '공허함',
  '조금 괜찮음',
  '모르겠음',
]

export const lifelineOptions = ['음악', '음식', '사람', '잠', '산책', '게임', '아무것도 없음']

export const dayComforts = [
  '오늘을 다 쓰지 못해도, 오늘을 지나온 너는 이미 충분히 애썼어.',
  '아무것도 해내지 못한 날 같아도, 버틴 시간은 사라지지 않아.',
  '마음이 무거운 채로 있어도 괜찮아. 너를 재촉하지 않을게.',
  '답을 찾지 못한 하루도 하루야. 여기까지 온 너를 조용히 인정해.',
  '작게 숨 쉰 것, 잠깐 멈춘 것, 그것도 오늘의 너를 지킨 일이야.',
  '네 마음이 흐린 날에도 너의 존재가 흐려지는 건 아니야.',
  '내일을 완벽히 준비하지 않아도 돼. 작은 부탁 하나면 충분해.',
]

export function todayKey() {
  const now = new Date()
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)

  return localDate.toISOString().slice(0, 10)
}

export function comfortForDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  const index = Number.isNaN(parsed.getTime()) ? 0 : parsed.getDay()

  return dayComforts[index % dayComforts.length]
}

export function createEmptyEntry(date = todayKey()): JournalEntry {
  return {
    date,
    weather: '',
    emotions: [],
    hardestMoment: '',
    enduredMoment: '',
    lifelines: [],
    lifelineOther: '',
    selfMessage: '',
    tomorrowRequest: '',
    comfort: comfortForDate(date),
  }
}

export function hasEntryContent(entry: JournalEntry) {
  return Boolean(
    entry.weather ||
      entry.emotions.length ||
      entry.hardestMoment.trim() ||
      entry.enduredMoment.trim() ||
      entry.lifelines.length ||
      entry.lifelineOther.trim() ||
      entry.selfMessage.trim() ||
      entry.tomorrowRequest.trim(),
  )
}
