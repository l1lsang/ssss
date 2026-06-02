import admin from 'firebase-admin'

export function getAdminApp() {
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
