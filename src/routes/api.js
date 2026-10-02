const express = require('express');
const router = express.Router();
const net = require('net');
const bcrypt = require('bcryptjs');
const configManager = require('../config');

// 인증 확인 미들웨어
function requireAuth(req, res, next) {
  const config = configManager.readConfig();
  if (!config.auth.enabled) {
    return next();
  }
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: '인증이 필요합니다. 먼저 로그인해 주세요.' });
}

// 1. 서비스 상태 및 인증 요구 여부
router.get('/status', (req, res) => {
  const config = configManager.readConfig();
  res.json({
    authEnabled: Boolean(config.auth.enabled),
    isAuthenticated: Boolean(req.session && req.session.authenticated),
    configPath: configManager.getConfigPath()
  });
});

// 2. 로그인
router.post('/auth/login', (req, res) => {
  const { password } = req.body;
  const config = configManager.readConfig();

  if (!config.auth.enabled) {
    req.session.authenticated = true;
    return res.json({ success: true, message: '로그인 기능이 비활성화되어 있습니다.' });
  }

  if (!password || !config.auth.passwordHash) {
    return res.status(400).json({ error: '비밀번호를 입력해 주세요.' });
  }

  const isValid = bcrypt.compareSync(password, config.auth.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  req.session.authenticated = true;
  res.json({ success: true, message: '로그인되었습니다.' });
});

// 3. 로그아웃
router.post('/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: '로그아웃 실패' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// 4. 인증 설정 변경 (보호 활성화/비활성화 및 마스터 비밀번호 설정)
router.put('/auth/settings', (req, res) => {
  const { enabled, currentPassword, newPassword } = req.body;
  const config = configManager.readConfig();

  // 기존에 로그인이 켜져 있었고 현재 세션이 인증되지 않은 경우
  if (config.auth.enabled && (!req.session || !req.session.authenticated)) {
    return res.status(401).json({ error: '설정 변경을 위해 먼저 로그인해야 합니다.' });
  }

  // 기존 비밀번호가 설정되어 있는 상태에서 변경하려는 경우 현재 비밀번호 확인
  if (config.auth.enabled && config.auth.passwordHash && currentPassword !== undefined) {
    if (!bcrypt.compareSync(currentPassword, config.auth.passwordHash)) {
      return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }
  }

  if (enabled === true) {
    if (newPassword) {
      const salt = bcrypt.genSaltSync(10);
      config.auth.passwordHash = bcrypt.hashSync(newPassword, salt);
    } else if (!config.auth.passwordHash) {
      return res.status(400).json({ error: '로그인을 활성화하려면 새 마스터 비밀번호를 입력해야 합니다.' });
    }
    config.auth.enabled = true;
    req.session.authenticated = true; // 현재 세션 유지
  } else if (enabled === false) {
    config.auth.enabled = false;
  }

  configManager.writeConfig(config);
  res.json({
    success: true,
    authEnabled: config.auth.enabled,
    message: '인증 설정이 저장되었습니다.'
  });
});

// 5. 서버 목록 조회
router.get('/servers', requireAuth, (req, res) => {
  const servers = configManager.getSanitizedServers();
  res.json(servers);
});

// 6. 서버 상세 및 접속 정보 조회 (패스워드 포함)
router.get('/servers/:id/connection', requireAuth, (req, res) => {
  const server = configManager.getServer(req.params.id);
  if (!server) {
    return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
  }
  res.json({
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    hasPassword: Boolean(server.password && server.password.length > 0),
    password: server.password || '',
    description: server.description
  });
});

// 7. 신규 서버 등록
router.post('/servers', requireAuth, (req, res) => {
  const { name, host, port, password, description } = req.body;
  if (!name || !host) {
    return res.status(400).json({ error: '서버 이름과 호스트 주소(IP 또는 도메인)는 필수입니다.' });
  }

  try {
    const created = configManager.addServer({
      name,
      host,
      port: port || 5900,
      password: password || '',
      description: description || ''
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: '서버 추가 실패: ' + err.message });
  }
});

// 8. 서버 수정
router.put('/servers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, host, port, password, description } = req.body;

  const updated = configManager.updateServer(id, {
    name,
    host,
    port,
    password,
    description
  });

  if (!updated) {
    return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
  }

  res.json(updated);
});

// 9. 서버 삭제
router.delete('/servers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const deleted = configManager.deleteServer(id);
  if (!deleted) {
    return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
  }
  res.json({ success: true, message: '서버가 삭제되었습니다.' });
});

// 10. 대상 VNC 포트 TCP 핑 테스트 (헬스 체크)
router.get('/servers/:id/ping', requireAuth, (req, res) => {
  const server = configManager.getServer(req.params.id);
  if (!server) {
    return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
  }

  const startTime = Date.now();
  const socket = new net.Socket();
  socket.setTimeout(2000); // 2초 타임아웃

  let responded = false;
  const finish = (online, error = null) => {
    if (responded) return;
    responded = true;
    socket.destroy();
    res.json({
      serverId: server.id,
      online,
      latency: online ? Date.now() - startTime : null,
      error
    });
  };

  socket.connect(server.port, server.host, () => {
    finish(true);
  });

  socket.on('error', (err) => {
    finish(false, err.message);
  });

  socket.on('timeout', () => {
    finish(false, 'Connection timed out (2000ms)');
  });
});

module.exports = router;
