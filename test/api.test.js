const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 테스트용 임시 config 경로 설정
const TEST_CONFIG_PATH = path.join(__dirname, 'test-config.json');
process.env.CONFIG_PATH = TEST_CONFIG_PATH;

const configManager = require('../src/config');
const apiRoutes = require('../src/routes/api');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

function setupTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  app.use('/api', apiRoutes);
  return app;
}

// 헬퍼: HTTP 요청 실행 (쿠키 포함 지원)
function makeRequest(server, options, body = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(cookies ? { 'Cookie': cookies } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('1. Config Manager: 단위 테스트', async (t) => {
  if (fs.existsSync(TEST_CONFIG_PATH)) {
    fs.unlinkSync(TEST_CONFIG_PATH);
  }

  // 초기화 및 기본값 확인
  const cfg = configManager.readConfig();
  assert.equal(cfg.auth.enabled, false);
  assert.equal(Array.isArray(cfg.servers), true);
  assert.equal(cfg.servers.length, 0);

  // 서버 추가
  const created = configManager.addServer({
    name: '단위테스트 서버',
    host: '192.168.0.100',
    port: 5900,
    password: 'secret_password_123',
    description: '단위 테스트 설명'
  });
  assert.ok(created.id);
  assert.equal(created.name, '단위테스트 서버');

  // getSanitizedServers는 패스워드를 마스킹해야 함
  const sanitized = configManager.getSanitizedServers();
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].hasPassword, true);
  assert.equal(sanitized[0].password, undefined);

  // 서버 수정
  const updated = configManager.updateServer(created.id, {
    name: '수정된 서버',
    description: '수정된 설명'
  });
  assert.equal(updated.name, '수정된 서버');
  assert.equal(updated.password, 'secret_password_123'); // 비밀번호 유지

  // 서버 삭제
  const deleted = configManager.deleteServer(created.id);
  assert.equal(deleted, true);
  assert.equal(configManager.getSanitizedServers().length, 0);
});

test('2. REST API & 인증 플로우: 통합 테스트', async (t) => {
  if (fs.existsSync(TEST_CONFIG_PATH)) {
    fs.unlinkSync(TEST_CONFIG_PATH);
  }

  const app = setupTestApp();
  const server = http.createServer(app);
  await new Promise(res => server.listen(0, res));

  t.after(() => {
    server.close();
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      try { fs.unlinkSync(TEST_CONFIG_PATH); } catch (_) {}
    }
  });

  // A. 기본 상태 조회
  const res1 = await makeRequest(server, { path: '/api/status' });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.authEnabled, false);
  assert.equal(res1.body.isAuthenticated, false);

  // B. 서버 추가
  const addRes = await makeRequest(server, { path: '/api/servers', method: 'POST' }, {
    name: '통합테스트 서버',
    host: '127.0.0.1',
    port: 5900,
    password: 'vnc_pass_abc'
  });
  assert.equal(addRes.status, 201);
  const serverId = addRes.body.id;
  assert.ok(serverId);

  // C. 서버 목록 조회 (비밀번호 노출 안 됨 확인)
  const listRes = await makeRequest(server, { path: '/api/servers' });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.length, 1);
  assert.equal(listRes.body[0].hasPassword, true);
  assert.equal(listRes.body[0].password, undefined);

  // D. 서버 접속 정보 조회 (VNC 패스워드 반환 확인)
  const connRes = await makeRequest(server, { path: `/api/servers/${serverId}/connection` });
  assert.equal(connRes.status, 200);
  assert.equal(connRes.body.password, 'vnc_pass_abc');

  // E. 인증 활성화 (마스터 비밀번호 설정: master1234)
  const setAuthRes = await makeRequest(server, { path: '/api/auth/settings', method: 'PUT' }, {
    enabled: true,
    newPassword: 'master1234'
  });
  assert.equal(setAuthRes.status, 200);
  assert.equal(setAuthRes.body.authEnabled, true);

  // F. 인증되지 않은 세션에서 서버 목록 요청 시 401 차단 확인
  const unauthRes = await makeRequest(server, { path: '/api/servers' });
  assert.equal(unauthRes.status, 401);

  // G. 잘못된 마스터 비밀번호로 로그인 실패 확인
  const failLogin = await makeRequest(server, { path: '/api/auth/login', method: 'POST' }, {
    password: 'wrong_password'
  });
  assert.equal(failLogin.status, 401);

  // H. 올바른 마스터 비밀번호로 로그인 성공 및 쿠키 획득
  const loginRes = await makeRequest(server, { path: '/api/auth/login', method: 'POST' }, {
    password: 'master1234'
  });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.body.success);
  const sessionCookie = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0].split(';')[0] : '';
  assert.ok(sessionCookie.includes('connect.sid'));

  // I. 로그인된 쿠키로 서버 목록 요청 성공 확인
  const authedListRes = await makeRequest(server, { path: '/api/servers' }, null, sessionCookie);
  assert.equal(authedListRes.status, 200);
  assert.equal(authedListRes.body.length, 1);

  // J. 로그아웃 확인
  const logoutRes = await makeRequest(server, { path: '/api/auth/logout', method: 'POST' }, null, sessionCookie);
  assert.equal(logoutRes.status, 200);

  // K. 로그아웃 후 다시 접근 시 401 확인
  const afterLogoutRes = await makeRequest(server, { path: '/api/servers' }, null, sessionCookie);
  assert.equal(afterLogoutRes.status, 401);
});

test('3. WebSocket 프록시 & 인증 차단: 통합 테스트', async (t) => {
  const WebSocket = require('ws');
  if (fs.existsSync(TEST_CONFIG_PATH)) {
    fs.unlinkSync(TEST_CONFIG_PATH);
  }

  // 기본 서버 1개 추가
  configManager.addServer({
    name: 'WS 테스트 서버',
    host: '127.0.0.1',
    port: 5900
  });
  const servers = configManager.getSanitizedServers();
  const serverId = servers[0].id;

  const app = express();
  const sessionParser = session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
  });
  app.use(sessionParser);
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  const wss = new WebSocket.Server({
    noServer: true,
    handleProtocols: (protocols) => protocols.has('binary') ? 'binary' : false
  });

  const { handleWsConnection } = require('../src/routes/proxy');
  wss.on('connection', (ws, req) => handleWsConnection(ws, req));

  server.on('upgrade', (request, socket, head) => {
    sessionParser(request, {}, () => {
      const config = configManager.readConfig();
      if (config.auth.enabled) {
        if (!request.session || !request.session.authenticated) {
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

  await new Promise(res => server.listen(0, res));

  t.after(() => {
    server.close();
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      try { fs.unlinkSync(TEST_CONFIG_PATH); } catch (_) {}
    }
  });

  const port = server.address().port;

  // A. 인증 비활성화 상태: WebSocket 정상 연결 (binary 서브프로토콜)
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?serverId=${serverId}`, ['binary']);
    ws.on('open', () => {
      ws.close();
      resolve();
    });
    ws.on('error', reject);
  });

  // B. 존재하지 않는 serverId로 접속 시 에러 코드(1008)로 닫힘 확인
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?serverId=invalid-id`, ['binary']);
    ws.on('close', (code) => {
      assert.equal(code, 1008);
      resolve();
    });
  });

  // C. 인증 활성화 시 미인증 클라이언트 WebSocket 핸드셰이크 거부(401) 확인
  configManager.writeConfig({
    auth: { enabled: true, passwordHash: 'dummy' },
    servers: [{ id: serverId, name: 'S', host: '127.0.0.1', port: 5900 }]
  });

  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?serverId=${serverId}`, ['binary']);
    ws.on('error', (err) => {
      assert.ok(err.message.includes('401') || err.message.includes('Unexpected server response'));
      resolve();
    });
  });
});

