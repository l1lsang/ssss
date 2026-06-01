import admin from 'firebase-admin'

function getAdminApp() {
  if (admin.apps.length) return admin.apps[0]

  const base64Account = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  const jsonAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (base64Account) {
    const serviceAccount = JSON.parse(Buffer.from(base64Account, 'base64').toString('utf8'))
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
  }

  if (jsonAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(jsonAccount)),
    })
  }

  if (projectId && clientEmail && privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    })
  }

  throw new Error('Missing Firebase Admin credentials')
}

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
    const decodedToken = await admin.auth(app).verifyIdToken(token)
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const entry = body?.entry

    if (!entry || typeof entry.date !== 'string') {
      return response.status(400).json({ ok: false, error: 'Invalid journal entry' })
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (!botToken || !chatId) {
      return response.status(200).json({ ok: true, sent: false, reason: 'missing_telegram_env' })
    }

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramMessage(decodedToken, entry),
        disable_web_page_preview: true,
      }),
    })

    if (!telegramResponse.ok) {
      const errorText = await telegramResponse.text()
      return response.status(502).json({
        ok: false,
        error: 'Telegram request failed',
        detail: errorText.slice(0, 240),
      })
    }

    return response.status(200).json({ ok: true, sent: true })
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
}

function formatTelegramMessage(user, entry) {
  const lines = [
    '새 감정 일지가 저장됐어요.',
    '',
    `사용자: ${user.email || user.uid}`,
    `날짜: ${entry.date}`,
    `마음 날씨: ${entry.weather || '비어 있음'}`,
    `감정: ${formatList(entry.emotions)}`,
    `살게 해준 것: ${formatList(entry.lifelines, entry.lifelineOther)}`,
    '',
    `가장 힘들었던 순간: ${entry.hardestMoment || '비어 있음'}`,
    `버틴 순간: ${entry.enduredMoment || '비어 있음'}`,
    `나에게 해주고 싶은 말: ${entry.selfMessage || '비어 있음'}`,
    `내일의 작은 부탁: ${entry.tomorrowRequest || '비어 있음'}`,
    '',
    `위로 문장: ${entry.comfort || '오늘도 여기 있어줘서 고마워.'}`,
  ]

  return lines.join('\n')
}

function formatList(value, extra = '') {
  const list = Array.isArray(value) ? value.filter(Boolean) : []
  const allItems = extra ? [...list, extra] : list

  return allItems.length ? allItems.join(', ') : '비어 있음'
}
