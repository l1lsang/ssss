import admin from 'firebase-admin'
import { getAdminApp } from './firebase-admin.js'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-5.4-mini'
const FALLBACK_COMFORT = '오늘도 여기까지 와준 것만으로도 충분히 애썼어.'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')

    if (!token) {
      return response.status(401).json({ ok: false, error: 'Missing Firebase token' })
    }

    const app = getAdminApp()
    await admin.auth(app).verifyIdToken(token)

    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const entry = normalizeEntry(body?.entry)

    if (!entry || !hasEntryContent(entry)) {
      return response.status(400).json({ ok: false, error: 'Invalid journal entry' })
    }

    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      return response.status(200).json({
        ok: true,
        generated: false,
        reason: 'missing_openai_env',
        comfort: fallbackComfort(entry),
      })
    }

    const comfort = await createComfort(entry, apiKey)

    return response.status(200).json({
      ok: true,
      generated: true,
      comfort,
    })
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
}

async function createComfort(entry, apiKey) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)

  try {
    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        store: false,
        max_output_tokens: 180,
        instructions: [
          '너는 한국어 감정 일지 앱의 짧은 위로 문장을 쓰는 조용하고 다정한 도우미야.',
          '사용자가 직접 적은 내용에 기반해, 한 사람에게만 맞는 위로를 써.',
          '진단, 치료 조언, 과장된 희망, 상투적인 명언은 피하고 구체적인 표현을 한두 개만 반영해.',
          '반드시 한국어 존댓말이 아닌 편안한 반말로, 1~2문장만 출력해.',
          '사용자가 자해나 즉각적인 위험을 암시했다면 혼자 견디지 말고 가까운 사람이나 긴급 도움에 연결되라는 말을 포함해.',
        ].join('\n'),
        input: buildPrompt(entry),
      }),
    })

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text()
      throw new Error(`OpenAI request failed: ${errorText.slice(0, 240)}`)
    }

    const payload = await openAiResponse.json()
    return cleanComfort(extractResponseText(payload)) || fallbackComfort(entry)
  } finally {
    clearTimeout(timeout)
  }
}

function buildPrompt(entry) {
  const lines = [
    `날짜: ${entry.date || '비어 있음'}`,
    `마음 날씨: ${entry.weather || '비어 있음'}`,
    `감정: ${formatList(entry.emotions)}`,
    `살게 해준 것: ${formatList(entry.lifelines, entry.lifelineOther)}`,
    `가장 힘들었던 순간: ${entry.hardestMoment || '비어 있음'}`,
    `버틴 순간: ${entry.enduredMoment || '비어 있음'}`,
    `나에게 해주고 싶은 말: ${entry.selfMessage || '비어 있음'}`,
    `내일의 작은 부탁: ${entry.tomorrowRequest || '비어 있음'}`,
  ]

  return `아래 감정 일지를 읽고 오늘의 위로 문장만 써줘.\n\n${lines.join('\n')}`
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text

  const output = Array.isArray(payload?.output) ? payload.output : []

  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => {
      if (typeof content?.text === 'string') return content.text
      if (typeof content?.output_text === 'string') return content.output_text
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null

  return {
    date: cleanText(entry.date, 20),
    weather: cleanText(entry.weather, 40),
    emotions: cleanArray(entry.emotions, 12, 40),
    hardestMoment: cleanText(entry.hardestMoment, 500),
    enduredMoment: cleanText(entry.enduredMoment, 500),
    lifelines: cleanArray(entry.lifelines, 12, 40),
    lifelineOther: cleanText(entry.lifelineOther, 120),
    selfMessage: cleanText(entry.selfMessage, 300),
    tomorrowRequest: cleanText(entry.tomorrowRequest, 300),
  }
}

function hasEntryContent(entry) {
  return Boolean(
    entry.weather ||
      entry.emotions.length ||
      entry.hardestMoment ||
      entry.enduredMoment ||
      entry.lifelines.length ||
      entry.lifelineOther ||
      entry.selfMessage ||
      entry.tomorrowRequest,
  )
}

function cleanArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []

  return value
    .filter((item) => typeof item === 'string')
    .slice(0, maxItems)
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return ''

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function cleanComfort(value) {
  return cleanText(value, 220)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
}

function fallbackComfort(entry) {
  if (entry.enduredMoment) {
    return `오늘 ${entry.enduredMoment}까지 버텨낸 너를 조용히 인정해. 완벽하지 않아도, 여기까지 온 것만으로 충분히 애썼어.`
  }

  if (entry.hardestMoment) {
    return `오늘 ${entry.hardestMoment} 때문에 마음이 무거웠다면, 그 무게를 느낀 너를 탓하지 않았으면 해. 지금은 조금 내려놓아도 괜찮아.`
  }

  return FALLBACK_COMFORT
}

function formatList(value, extra = '') {
  const list = Array.isArray(value) ? value.filter(Boolean) : []
  const allItems = extra ? [...list, extra] : list

  return allItems.length ? allItems.join(', ') : '비어 있음'
}
