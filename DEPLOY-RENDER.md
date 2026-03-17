# Render 배포 순서

## 1) GitHub에 올릴 파일
저장소 루트에 아래 파일이 바로 보이게 올리세요.

```text
package.json
server.js
planner.js
render.yaml
supabase-schema.sql
README.md
public/
```

올리면 안 되는 것:
- `node_modules`
- `.env`
- `.env.local`

## 2) Render에서 배포
1. Render 로그인
2. `New` → `Blueprint`
3. GitHub 저장소 선택
4. `running-calendar-gpt-auth` 서비스 생성

## 3) 환경 변수 입력
Render 서비스에서 아래 환경 변수를 넣습니다.

- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-4.1-mini`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

## 4) Supabase SQL 실행
배포 전에 Supabase SQL Editor에서 `supabase-schema.sql`을 실행하세요.

## 5) 재배포
환경 변수를 넣은 뒤 `Manual Deploy` → `Clear build cache & deploy`

## 6) 사용
배포가 끝나면 `https://...onrender.com` 링크로 접속합니다.
각 사용자는 회원가입/로그인 후 자기 캘린더를 따로 저장합니다.
