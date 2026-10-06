# noVNC Hub - 원격 VNC 서버 통합 관리 포털

웹 브라우저를 통해 다수의 VNC 서버를 등록 및 관리하고, 원클릭으로 noVNC 원격 데스크톱에 접속할 수 있는 초경량 웹 포털 솔루션입니다.

---

## 🌟 주요 특징

- **UI 기반 서버 관리**: 복잡한 설정 파일 수정 없이 웹 UI에서 VNC 서버를 손쉽게 추가, 수정, 삭제(CRUD)할 수 있습니다.
- **초경량 단일 컨테이너**: Node.js 기반 단일 프로세스로 [웹 UI + REST API + WebSocket ↔ VNC TCP 프록시]를 올인원으로 처리합니다 (포트 `8080` 하나만 노출).
- **간편한 설정 영속화**: 외부 DB 없이 `/conf.d/novnc-hub/config.json` 단일 파일로 모든 설정이 저장되어 백업 및 복구가 매우 간편합니다.
- **실시간 상태 체크 (Healthcheck)**: 서버 목록에서 각 VNC 서버의 포트 활성화 여부(온라인/오프라인) 및 레이턴시를 자동으로 표시합니다.
- **noVNC 임베디드 뷰어**:
  - 상단 드롭다운으로 다른 서버 즉시 전환
  - `Ctrl+Alt+Del` 키 전송
  - 창 크기 맞춤 (Scale Viewport) ON/OFF
  - 전체화면 (Fullscreen) 지원
  - VNC 비밀번호 자동 전달 및 모달 입력 지원
- **선택적 보안 로그인**: 웹 UI 접근을 보호하고 싶다면 설정 화면에서 마스터 비밀번호 로그인을 활성화(ON/OFF)할 수 있습니다.

---

## 🚀 빠른 시작 (Docker Compose)

### 1. `docker-compose.yml` 실행
```bash
docker compose up -d --build
```

실행 후 브라우저에서 `http://localhost:8080`에 접속합니다.

---

## 🐳 Docker CLI 직접 실행

```bash
# 로컬의 config 디렉터리를 /conf.d/novnc-hub로 마운트
docker run -d \
  --name novnc-hub \
  -p 8080:8080 \
  -v $(pwd)/config:/conf.d/novnc-hub \
  --restart unless-stopped \
  novnc-hub
```

---

## 💻 로컬 개발 환경 실행

```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행 (기본 config 경로는 ./config/config.json)
CONFIG_PATH="./config/config.json" npm start
```

---

## ⚙️ 설정 파일 (`/conf.d/novnc-hub/config.json`)

컨테이너 최초 실행 시 자동으로 기본 설정 파일이 생성됩니다. UI를 통해 수정할 수 있으며, 필요한 경우 텍스트 에디터로 직접 수정할 수도 있습니다.

```json
{
  "auth": {
    "enabled": false,
    "passwordHash": ""
  },
  "servers": [
    {
      "id": "srv-1",
      "name": "Ubuntu 데스크톱 (개발용)",
      "host": "192.168.1.10",
      "port": 5900,
      "password": "선택사항(비워두면접속시입력요청)",
      "description": "GPU 개발 머신",
      "createdAt": "2026-10-02T07:00:00.000Z"
    }
  ]
}
```

---

## 📁 프로젝트 구조

```text
novnc/
├── Dockerfile                   # Node 20 Alpine 기반 초경량 도커파일
├── docker-compose.yml           # 원클릭 실행 컴포즈 설정
├── package.json                 # Node.js 프로젝트 명세 및 의존성
├── DESIGN.md                    # 아키텍처 및 상세 설계서
├── README.md                    # 사용자 가이드
├── src/
│   ├── server.js                # Express 및 WebSocket 서버 통합 진입점
│   ├── config.js                # /conf.d/novnc-hub/config.json 파일 I/O 및 CRUD 모듈
│   └── routes/
│       ├── api.js               # 서버 CRUD, 인증, TCP 핑 헬스체크 API
│       └── proxy.js             # WebSocket <-> VNC TCP 양방향 스트리밍 프록시
└── public/
    ├── index.html               # 메인 대시보드 (서버 카드, 모달 등)
    ├── viewer.html              # noVNC 임베디드 콘솔 뷰어
    ├── css/
    │   └── style.css            # 다크 테마 모던 UI 스타일
    └── js/
        ├── app.js               # 대시보드 클라이언트 로직
        └── viewer.js            # noVNC RFB 제어 로직
```
