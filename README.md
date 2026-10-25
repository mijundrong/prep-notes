# prep-notes

개인용 면접 준비 노트. 내용은 암호화된 `data.enc.json`에만 있고, 브라우저에서 비밀번호를 넣어야 열린다.

## 데이터 갱신 절차

1. 새 `interview_data.json`을 이 폴더에 덮어쓴다 (커밋하지 않는다 — `.gitignore`와 pre-commit 훅이 막는다)
2. `node scripts/check.mjs`
3. `node scripts/encrypt.mjs` (같은 비밀번호)
4. `git add data.enc.json && git commit -m "update data" && git push`

- 비밀번호를 바꾸려면 3번에서 새 비밀번호를 입력한다. 이미 "이 기기에서 기억하기"를 켠 기기는 다시 잠금 해제해야 한다.
- 같은 비밀번호로 다시 암호화하면 salt를 그대로 쓰므로 기억된 기기는 그대로 열린다.
- 3번은 PowerShell·명령 프롬프트·Windows Terminal에서 실행한다 (입력이 화면에 `*`로만 보인다). Git Bash에서는 `winpty node scripts/encrypt.mjs`.

## 답변은 기기마다 따로 저장된다

답변·상태·체크·메모는 각 기기의 브라우저(localStorage)에만 평문으로 저장되고 서버로는 가지 않는다.
기기 사이를 옮기는 방법은 백업뿐이다: 상단 "내보내기 → 백업 파일 다운로드" → 다른 기기에서 "가져오기"(병합 또는 덮어쓰기).
백업 파일도 평문이므로 이 저장소에 넣지 않는다.

## 새로 클론했을 때

pre-commit 훅을 설치한다. 평문 데이터와 테스트 비밀번호로 만든 암호문이 커밋되는 것을 막는다.

```
cp scripts/pre-commit .git/hooks/pre-commit
```

Node 18 이상만 있으면 된다. `npm install`은 필요 없다.

## 구성

| 경로 | 내용 |
|---|---|
| `index.html`, `assets/` | 사이트. 순수 HTML·CSS·JavaScript, 빌드 단계 없음, 외부 요청 없음 |
| `data.enc.json` | 암호화된 데이터. PBKDF2-HMAC-SHA256 600,000회 + AES-256-GCM |
| `scripts/check.mjs` | 평문 스키마·개수·개인식별정보 패턴 검증 |
| `scripts/encrypt.mjs` | 평문 → `data.enc.json` |
| `scripts/pre-commit` | git 훅 |
