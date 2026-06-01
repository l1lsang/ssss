# 오늘도 여기 있어줘서 고마워

Firebase Auth/Firestore와 Vercel 서버리스 함수를 쓰는 데일리 감정 일지입니다.
사용자는 이메일로 회원가입/로그인하고, 날짜별 기록을 저장하고, 지난 기록을 다시 볼 수 있습니다.
저장 후에는 Vercel API 함수가 Firebase ID 토큰을 확인한 뒤 텔레그램으로 기록을 보냅니다.

## 로컬 설정

1. `.env.example`을 참고해 `.env.local`을 만듭니다.
2. Firebase 콘솔에서 Authentication 이메일/비밀번호 로그인을 켭니다.
3. Firestore 데이터베이스를 만들고 `firestore.rules`를 배포합니다.
4. 텔레그램 BotFather에서 봇 토큰을 만들고 받을 채팅 ID를 넣습니다.

```bash
npm install
npm run dev
```

Vercel API까지 로컬에서 같이 확인하려면 Vercel CLI의 `vercel dev`로 실행하세요.
일반 `npm run dev`는 Vite 프론트만 실행하므로 저장은 되지만 텔레그램 API 호출은 로컬에서 실패할 수 있습니다.

## Vercel 환경 변수

브라우저에 공개되어도 되는 Firebase Web App 값:

```txt
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

서버에서만 써야 하는 값:

```txt
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Firebase Admin 키는 위 세 값 대신 `FIREBASE_SERVICE_ACCOUNT_BASE64` 또는
`FIREBASE_SERVICE_ACCOUNT_JSON` 하나로 넣어도 됩니다.

## 데이터 구조

기록은 Firestore의 아래 경로에 저장됩니다.

```txt
users/{uid}/entries/{yyyy-mm-dd}
```

보안 규칙은 로그인한 사용자가 자기 기록만 읽고 쓸 수 있게 제한합니다.
