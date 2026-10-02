import RFB from '/novnc/core/rfb.js';

let rfb = null;
let currentServerId = null;
let currentServer = null;
let scaleEnabled = true;

const screenEl = document.getElementById('screen');
const statusEl = document.getElementById('conn-status');
const serverSelect = document.getElementById('server-switch');
const btnCad = document.getElementById('btn-cad');
const btnScale = document.getElementById('btn-scale');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnReconnect = document.getElementById('btn-reconnect');
const modalPassword = document.getElementById('modal-password');
const formPassword = document.getElementById('form-password');
const inputVncPw = document.getElementById('input-vnc-pw');

// 상태 표시 업데이트
function setStatus(state, message) {
  statusEl.className = `status-indicator ${state}`;
  statusEl.textContent = `● ${message}`;
}

// 1. 서버 목록 로드 및 셀렉트 박스 구성
async function loadServerList() {
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      throw new Error('서버 목록 조회 실패');
    }
    const servers = await res.json();
    serverSelect.innerHTML = servers.map(s => `
      <option value="${s.id}" ${s.id === currentServerId ? 'selected' : ''}>
        ${s.name} (${s.host}:${s.port})
      </option>
    `).join('');
  } catch (err) {
    console.error('Failed to load server list:', err);
  }
}

// 2. VNC 연결 수립
async function connectToVnc(serverId) {
  if (rfb) {
    try {
      rfb.disconnect();
    } catch (_) {}
    rfb = null;
  }
  screenEl.innerHTML = '';

  currentServerId = serverId;
  setStatus('connecting', '연결 대상 정보 로드 중...');

  try {
    const res = await fetch(`/api/servers/${serverId}/connection`);
    if (!res.ok) {
      throw new Error('서버 상세 정보를 불러올 수 없습니다.');
    }
    currentServer = await res.json();
    document.title = `${currentServer.name} - noVNC Console`;
  } catch (err) {
    setStatus('disconnected', err.message);
    return;
  }

  // WebSocket URL 구성
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?serverId=${currentServerId}`;

  setStatus('connecting', `${currentServer.name} 연결 중...`);

  const options = {
    credentials: {
      password: currentServer.password || ''
    },
    shared: true
  };

  try {
    rfb = new RFB(screenEl, wsUrl, options);

    rfb.scaleViewport = scaleEnabled;
    rfb.resizeSession = false;

    // 이벤트 리스너 등록
    rfb.addEventListener('connect', () => {
      setStatus('connected', `연결됨: ${currentServer.name}`);
    });

    rfb.addEventListener('disconnect', (e) => {
      if (e.detail.clean) {
        setStatus('disconnected', '연결이 정상 종료되었습니다.');
      } else {
        setStatus('disconnected', '연결 끊김 (서버 확인 필요)');
      }
    });

    rfb.addEventListener('credentialsrequired', () => {
      setStatus('connecting', '비밀번호 입력 대기 중...');
      modalPassword.classList.add('active');
      inputVncPw.value = '';
      inputVncPw.focus();
    });

    rfb.addEventListener('securityfailure', (e) => {
      console.error('Security failure:', e.detail);
      setStatus('disconnected', '인증 실패 (비밀번호 오류)');
      modalPassword.classList.add('active');
    });

  } catch (err) {
    console.error('RFB initialization error:', err);
    setStatus('disconnected', 'VNC 초기화 실패: ' + err.message);
  }
}

// 3. 비밀번호 입력 모달 제출
formPassword.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = inputVncPw.value;
  if (!rfb) return;

  modalPassword.classList.remove('active');
  setStatus('connecting', '비밀번호 전송 중...');
  rfb.sendCredentials({ password: pw });
});

// 4. 서버 전환 드롭다운 이벤트
serverSelect.addEventListener('change', (e) => {
  const newId = e.target.value;
  if (!newId || newId === currentServerId) return;

  // URL 파라미터 갱신 및 재연결
  const newUrl = new URL(window.location);
  newUrl.searchParams.set('id', newId);
  window.history.pushState({}, '', newUrl);

  connectToVnc(newId);
});

// 5. 툴바 버튼 이벤트들
btnCad.addEventListener('click', () => {
  if (rfb) {
    rfb.sendCtrlAltDel();
  }
});

btnScale.addEventListener('click', () => {
  scaleEnabled = !scaleEnabled;
  if (rfb) {
    rfb.scaleViewport = scaleEnabled;
  }
  btnScale.textContent = scaleEnabled ? '📐 창 맞춤: ON' : '📐 창 맞춤: OFF';
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn('Fullscreen error:', err);
    });
  } else {
    document.exitFullscreen();
  }
});

btnReconnect.addEventListener('click', () => {
  if (currentServerId) {
    connectToVnc(currentServerId);
  }
});

// 초기 구동
const urlParams = new URLSearchParams(window.location.search);
const targetId = urlParams.get('id');

if (!targetId) {
  alert('접속할 서버가 지정되지 않았습니다.');
  window.location.href = '/';
} else {
  loadServerList();
  connectToVnc(targetId);
}
