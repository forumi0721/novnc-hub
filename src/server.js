const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');

const configManager = require('./config');
const apiRoutes = require('./routes/api');
const { handleWsConnection } = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 8080;

// 세션 미들웨어 설정
const sessionParser = session({
  secret: process.env.SESSION_SECRET || 'novnc-hub-secret-key-salt',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    httpOnly: true
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionParser);

// 1. noVNC 라이브러리 정적 파일 서빙
app.use('/novnc', express.static(path.join(__dirname, '../node_modules/@novnc/novnc')));

// 2. 프론트엔드 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../public')));

// 3. API 라우트 등록
app.use('/api', apiRoutes);

// HTTP 서버 생성
const server = http.createServer(app);

// WebSocket 서버 인스턴스 생성 (noServer 모드)
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => {
    // noVNC는 기본적으로 'binary' 서브프로토콜을 요청함
    if (protocols.has('binary')) {
      return 'binary';
    }
    return false;
  }
});

wss.on('connection', (ws, request) => {
  handleWsConnection(ws, request);
});

// HTTP Upgrade 이벤트 가로채기 (WebSocket 핸드셰이크)
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  // 세션 파싱 후 인증 여부 확인
  sessionParser(request, {}, () => {
    const config = configManager.readConfig();
    if (config.auth.enabled) {
      if (!request.session || !request.session.authenticated) {
        console.warn('[Proxy] WebSocket rejected: unauthenticated session');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

// 서버 실행
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`  noVNC Hub Server is running!`);
  console.log(`  Listening on: http://0.0.0.0:${PORT}`);
  console.log(`  Config Path:  ${configManager.getConfigPath()}`);
  console.log(`=========================================`);
});
