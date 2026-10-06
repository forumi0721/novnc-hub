const fs = require('fs');
const path = require('path');

// Docker 기본 경로는 /conf.d/novnc-hub/config.json
// 환경 변수 CONFIG_PATH가 주어지면 우선 사용
const DEFAULT_PATH = process.env.CONFIG_PATH || '/conf.d/novnc-hub/config.json';

function getConfigPath() {
  return DEFAULT_PATH;
}

const DEFAULT_CONFIG = {
  auth: {
    enabled: false,
    passwordHash: ''
  },
  servers: []
};

// 디렉터리 및 초기 파일 자동 생성
function ensureConfigExists() {
  const filePath = getConfigPath();
  const dirPath = path.dirname(filePath);

  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
      console.log(`[Config] Created default config at: ${filePath}`);
    }
  } catch (err) {
    console.error(`[Config] Error ensuring config file at ${filePath}:`, err.message);
    throw err;
  }
}

// 설정 읽기
function readConfig() {
  ensureConfigExists();
  const filePath = getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      auth: { ...DEFAULT_CONFIG.auth, ...(parsed.auth || {}) },
      servers: Array.isArray(parsed.servers) ? parsed.servers : []
    };
  } catch (err) {
    console.error(`[Config] Failed to read config from ${filePath}:`, err.message);
    return DEFAULT_CONFIG;
  }
}

// 설정 원자적(atomic) 저장
function writeConfig(config) {
  const filePath = getConfigPath();
  const dirPath = path.dirname(filePath);
  const tmpPath = path.join(dirPath, `.config.${Date.now()}.tmp`);

  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    console.error(`[Config] Failed to save config to ${filePath}:`, err.message);
    throw err;
  }
}

// 서버 조회 (단일)
function getServer(id) {
  const config = readConfig();
  return config.servers.find(s => s.id === id);
}

// 서버 목록 (UI 반환용 - 비밀번호 마스킹 및 평문 노출 방지)
function getSanitizedServers() {
  const config = readConfig();
  return config.servers.map(s => ({
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    hasPassword: Boolean(s.password && s.password.length > 0),
    description: s.description || '',
    createdAt: s.createdAt
  }));
}

// 서버 추가
function addServer(serverData) {
  const config = readConfig();
  const newServer = {
    id: 'srv-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
    name: serverData.name.trim(),
    host: serverData.host.trim(),
    port: parseInt(serverData.port, 10) || 5900,
    password: serverData.password || '',
    description: serverData.description ? serverData.description.trim() : '',
    createdAt: new Date().toISOString()
  };

  config.servers.push(newServer);
  writeConfig(config);
  return newServer;
}

// 서버 수정
function updateServer(id, serverData) {
  const config = readConfig();
  const index = config.servers.findIndex(s => s.id === id);
  if (index === -1) {
    return null;
  }

  const existing = config.servers[index];
  const updated = {
    ...existing,
    name: serverData.name !== undefined ? serverData.name.trim() : existing.name,
    host: serverData.host !== undefined ? serverData.host.trim() : existing.host,
    port: serverData.port !== undefined ? parseInt(serverData.port, 10) || 5900 : existing.port,
    description: serverData.description !== undefined ? serverData.description.trim() : existing.description,
    updatedAt: new Date().toISOString()
  };

  // 패스워드가 빈 문자열이 아닌 새 값으로 전달된 경우만 갱신 (유지하고 싶을 때 undefined 처리)
  if (serverData.password !== undefined) {
    updated.password = serverData.password;
  }

  config.servers[index] = updated;
  writeConfig(config);
  return updated;
}

// 서버 삭제
function deleteServer(id) {
  const config = readConfig();
  const prevLen = config.servers.length;
  config.servers = config.servers.filter(s => s.id !== id);
  if (config.servers.length !== prevLen) {
    writeConfig(config);
    return true;
  }
  return false;
}

module.exports = {
  getConfigPath,
  readConfig,
  writeConfig,
  getServer,
  getSanitizedServers,
  addServer,
  updateServer,
  deleteServer
};
