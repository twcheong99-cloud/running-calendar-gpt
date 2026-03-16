# Render로 링크형 웹앱 만들기 (터미널 최소화)

## 1. GitHub에 올리기
1. GitHub 로그인
2. `New repository` 클릭
3. 저장소 이름 입력 (예: `running-calendar-gpt`)
4. `Create repository`
5. `uploading an existing file` 클릭
6. 이 프로젝트 폴더 안 파일 전체를 브라우저로 드래그 앤 드롭
7. `Commit changes` 클릭

## 2. Render에 연결
1. Render 로그인
2. `New` → `Blueprint`
3. GitHub 연결
4. 방금 만든 저장소 선택
5. `render.yaml`이 보이는지 확인

## 3. 환경변수 넣기
- `OPENAI_API_KEY`: OpenAI API 키
- `OPENAI_MODEL`: 기본값 `gpt-4.1-mini` 그대로 사용 가능

## 4. 배포
1. `Deploy Blueprint` 클릭
2. 배포 완료 대기
3. 생성된 `onrender.com` 링크 클릭

## 5. 지인과 공유
- Render가 만든 링크를 그대로 공유하면 됩니다.
- 이 프로젝트는 아직 로그인/DB가 없어서 모든 사용자가 같은 배포본으로 접속하지만,
  각자 브라우저 localStorage에 체크 상태가 저장됩니다.

## 6. 주의
- 브라우저 localStorage는 기기마다 따로 저장됩니다.
- 같은 사람이 다른 폰/노트북으로 접속하면 체크 상태가 안 이어집니다.
- 여러 사람이 계정별로 저장되게 하려면 다음 단계로 DB가 필요합니다.
