# 러닝 플래너 캘린더 · GPT 버전

캘린더/투두 리스트 형태로 러닝 훈련표를 관리할 수 있는 웹앱입니다.

## 이번 버전에서 달라진 점
- 5K / 10K / 하프 / 풀 **PB 기록 + 기록 날짜** 입력
- **가장 최근 러닝** 입력
  - 러닝 날짜
  - 거리(km)
  - 평균 페이스
  - 평균 심박수
  - 자각 강도(RPE, 선택)
- 오래된 PB보다 **최근 러닝 상태를 더 크게 반영**하도록 개선
- Render 배포용 `render.yaml` 추가

## 포함 기능
- GPT 기반 러닝 훈련 계획 생성 API 연동
- 목표 대회 날짜 / 목표 시간 / 종목 / 주당 가능 일수 반영
- 월간 캘린더 보기
- 날짜별 완료 / 건너뜀 / 대기 체크
- 날짜별 메모 저장
- localStorage 저장
- JSON 내보내기 / 불러오기
- OpenAI API 키가 없을 때 로컬 규칙 기반 플랜 자동 대체

## 프로젝트 구조
```text
running-calendar-gpt/
├─ public/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ planner.js
├─ server.js
├─ package.json
├─ package-lock.json
├─ .env.example
├─ render.yaml
└─ README.md
```

## 로컬 실행 방법
### 1) 의존성 설치
```bash
npm install
```

### 2) 환경 변수 설정
macOS / Linux 예시:
```bash
export OPENAI_API_KEY="YOUR_KEY"
export OPENAI_MODEL="gpt-4.1-mini"
```

Windows PowerShell 예시:
```powershell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_MODEL="gpt-4.1-mini"
```

### 3) 실행
```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속.

## Render 배포 요약
### 준비
1. GitHub 계정 생성
2. 이 프로젝트를 GitHub 새 저장소에 업로드
3. Render 계정 생성
4. Render에서 GitHub 연결

### 배포
1. Render 대시보드에서 **New > Blueprint** 선택
2. 이 저장소 연결
3. `render.yaml` 인식 확인
4. `OPENAI_API_KEY` 값 입력
5. Deploy Blueprint 클릭
6. 배포 완료 후 `https://...onrender.com` 링크 접속

## GitHub 업로드를 터미널 없이 하는 방법
1. GitHub에서 **New repository** 생성
2. `running-calendar-gpt` 폴더 안 파일들을 브라우저로 드래그 앤 드롭 업로드
3. 업로드 완료 후 Commit changes 클릭
4. Render에서 그 저장소를 연결

## 참고
- API 키는 브라우저에 넣지 않고, 서버에서만 OpenAI를 호출합니다.
- 브라우저에는 훈련 체크 상태와 메모가 저장됩니다.
- 여러 사람이 같이 쓰려면 다음 단계로 사용자 로그인 + DB 저장을 추가하는 것이 좋습니다.

## 다음 단계 추천
- 로그인 추가
- 사용자별 플랜 저장용 DB(Supabase/Postgres)
- GPT 재조정 채팅(예: 이번 주 2일만 가능)
- Strava/Garmin 연동
- 공유용 읽기 링크
