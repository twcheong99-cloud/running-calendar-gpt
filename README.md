# 러닝 플래너 캘린더 · GPT + 로그인 저장 버전

캘린더/투두 리스트 형태로 러닝 훈련표를 관리하는 웹앱입니다.
이번 버전은 **Supabase 이메일 로그인**과 **계정별 자동 저장**이 들어 있습니다.

## 포함 기능
- OpenAI 기반 러닝 훈련 계획 생성
- 5K / 10K / 하프 / 풀 PB 기록 + 기록 날짜 입력
- 가장 최근 러닝 입력
  - 날짜
  - 거리
  - 평균 페이스
  - 평균 심박수
  - RPE
- 목표 대회 날짜 / 목표 시간 / 종목 / 주당 가능 일수 반영
- 월간 캘린더 보기
- 날짜별 완료 / 건너뜀 / 대기 체크
- 날짜별 메모 저장
- Supabase 이메일 회원가입 / 로그인 / 로그아웃
- 계정별 클라우드 저장
- OpenAI API 키가 없을 때 로컬 규칙 기반 플랜 자동 대체

## 프로젝트 구조
```text
running-calendar-gpt-auth/
├─ public/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ planner.js
├─ server.js
├─ package.json
├─ .env.example
├─ render.yaml
├─ supabase-schema.sql
└─ README.md
```

## 로컬 실행
### 1) 폴더로 이동
```bash
cd running-calendar-gpt-auth
```

### 2) 의존성 설치
```bash
npm install
```

### 3) 환경 변수 넣기
macOS / Linux:
```bash
export OPENAI_API_KEY="YOUR_KEY"
export OPENAI_MODEL="gpt-4.1-mini"
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="YOUR_KEY"
```

Windows PowerShell:
```powershell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_MODEL="gpt-4.1-mini"
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY="YOUR_KEY"
```

### 4) 실행
```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속.

## Supabase 설정
### 1) Supabase 프로젝트 생성
Supabase에서 새 프로젝트를 만듭니다.

### 2) 이메일 로그인 사용
Auth > Providers에서 Email을 켭니다.
작게 지인끼리 쓸 거면 초기에 **Confirm email**을 끄면 편합니다.
(켜두면 회원가입 뒤 메일 확인이 필요합니다.)

### 3) SQL 실행
Supabase SQL Editor에서 `supabase-schema.sql` 내용을 실행하세요.

### 4) 키 확인
Project Settings / Connect 쪽에서 아래 두 값을 확인합니다.
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
  - publishable key가 없으면 legacy `anon` key도 사용 가능

## Render 배포
`DEPLOY-RENDER.md`를 보세요.

## Render 환경 변수
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (선택, 기본 `gpt-4.1-mini`)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

## 참고
- 로그인 기능은 Supabase가 켜져 있을 때만 동작합니다.
- Supabase가 설정되지 않으면 앱은 **로컬 저장만** 사용합니다.
- OpenAI API 키는 반드시 서버 환경변수에만 넣으세요.
- PB가 오래된 기록이어도 최근 러닝 정보를 같이 넣으면 플랜이 더 보수적으로 조정됩니다.
