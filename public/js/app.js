// 상태 저장
let serversData = [];
let appStatus = {
  authEnabled: false,
  isAuthenticated: false
};

// 헬퍼: 모달 열기/닫기
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// 1. 앱 초기 상태 확인
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    appStatus = await res.json();

    const btnLogout = document.getElementById('btn-logout');
    if (appStatus.authEnabled && appStatus.isAuthenticated) {
      btnLogout.style.display = 'inline-flex';
    } else {
      btnLogout.style.display = 'none';
    }

    if (appStatus.authEnabled && !appStatus.isAuthenticated) {
      openModal('modal-login');
      return false;
    } else {
      closeModal('modal-login');
      return true;
    }
  } catch (err) {
    console.error('Failed to check status:', err);
    return false;
  }
}

// 2. 서버 목록 로드
async function loadServers() {
  const ok = await checkStatus();
  if (!ok) return;

  try {
    const res = await fetch('/api/servers');
    if (res.status === 401) {
      openModal('modal-login');
      return;
    }
    serversData = await res.json();
    renderServers(serversData);
    checkAllServersPing();
  } catch (err) {
    console.error('Failed to load servers:', err);
  }
}

// 3. 서버 카드 렌더링
function renderServers(servers) {
  const grid = document.getElementById('servers-grid');
  if (!servers || servers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>등록된 VNC 서버가 없습니다.</h3>
        <p>상단의 "새 VNC 서버 추가" 버튼을 눌러 원격 데스크톱을 등록해 보세요.</p>
        <button class="btn btn-primary" onclick="openAddServerModal()">서버 추가하기</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = servers.map(s => `
    <div class="server-card" id="card-${s.id}">
      <div>
        <div class="card-header">
          <h3 class="card-title">${escapeHtml(s.name)}</h3>
          <span class="status-badge checking" id="badge-${s.id}">
            <span class="dot">●</span> 확인 중
          </span>
        </div>
        <div class="card-body">
          <div class="server-endpoint">${escapeHtml(s.host)}:${s.port}</div>
          <div class="server-desc">${escapeHtml(s.description || '등록된 설명이 없습니다.')}</div>
        </div>
      </div>
      <div class="card-footer">
        <a href="/viewer.html?id=${s.id}" class="btn btn-primary btn-sm">
          🖥️ 접속하기
        </a>
        <div class="card-actions-right">
          <button class="btn btn-secondary btn-sm" onclick="openEditServerModal('${s.id}')">
            수정
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteServer('${s.id}', '${escapeHtml(s.name)}')">
            삭제
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// 4. 각 서버 VNC 포트 핑 체크
async function checkServerPing(id) {
  const badge = document.getElementById(`badge-${id}`);
  if (!badge) return;

  try {
    const res = await fetch(`/api/servers/${id}/ping`);
    const data = await res.json();
    if (data.online) {
      badge.className = 'status-badge online';
      badge.innerHTML = `● 온라인 (${data.latency}ms)`;
    } else {
      badge.className = 'status-badge offline';
      badge.innerHTML = `● 오프라인`;
    }
  } catch (err) {
    badge.className = 'status-badge offline';
    badge.innerHTML = `● 확인 불가`;
  }
}

function checkAllServersPing() {
  serversData.forEach(s => checkServerPing(s.id));
}

// 5. 서버 추가 모달 열기
function openAddServerModal() {
  document.getElementById('modal-server-title').textContent = '새 VNC 서버 추가';
  document.getElementById('server-id').value = '';
  document.getElementById('server-name').value = '';
  document.getElementById('server-host').value = '';
  document.getElementById('server-port').value = '5900';
  document.getElementById('server-password').value = '';
  document.getElementById('server-desc').value = '';
  document.getElementById('server-pw-hint').style.display = 'none';
  openModal('modal-server');
}

// 6. 서버 수정 모달 열기
function openEditServerModal(id) {
  const server = serversData.find(s => s.id === id);
  if (!server) return;

  document.getElementById('modal-server-title').textContent = 'VNC 서버 정보 수정';
  document.getElementById('server-id').value = server.id;
  document.getElementById('server-name').value = server.name;
  document.getElementById('server-host').value = server.host;
  document.getElementById('server-port').value = server.port;
  document.getElementById('server-password').value = '';
  document.getElementById('server-desc').value = server.description || '';
  
  const pwHint = document.getElementById('server-pw-hint');
  if (server.hasPassword) {
    pwHint.style.display = 'block';
  } else {
    pwHint.style.display = 'none';
  }

  openModal('modal-server');
}

// 7. 서버 저장 (추가/수정)
document.getElementById('form-server').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('server-id').value;
  const name = document.getElementById('server-name').value.trim();
  const host = document.getElementById('server-host').value.trim();
  const port = parseInt(document.getElementById('server-port').value, 10);
  const password = document.getElementById('server-password').value;
  const description = document.getElementById('server-desc').value.trim();

  const payload = { name, host, port, description };
  // 비밀번호가 입력되었거나 새로 추가하는 경우 payload에 포함
  if (password || !id) {
    payload.password = password;
  }

  try {
    let res;
    if (id) {
      res = await fetch(`/api/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '저장에 실패했습니다.');
      return;
    }

    closeModal('modal-server');
    loadServers();
  } catch (err) {
    alert('요청 중 오류가 발생했습니다: ' + err.message);
  }
});

// 8. 서버 삭제
async function deleteServer(id, name) {
  if (!confirm(`정말 "${name}" 서버를 삭제하시겠습니까?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '삭제 실패');
      return;
    }
    loadServers();
  } catch (err) {
    alert('삭제 중 오류 발생: ' + err.message);
  }
}

// 9. 환경설정 모달 열기
document.getElementById('btn-open-settings').addEventListener('click', async () => {
  await checkStatus();
  const authCheckbox = document.getElementById('setting-auth-enabled');
  const authFields = document.getElementById('auth-fields');
  const groupCurrent = document.getElementById('group-current-password');

  authCheckbox.checked = appStatus.authEnabled;
  authFields.style.display = appStatus.authEnabled ? 'block' : 'none';
  groupCurrent.style.display = appStatus.authEnabled ? 'block' : 'none';

  document.getElementById('setting-current-password').value = '';
  document.getElementById('setting-new-password').value = '';
  document.getElementById('setting-confirm-password').value = '';

  openModal('modal-settings');
});

// 환경설정 체크박스 토글
document.getElementById('setting-auth-enabled').addEventListener('change', (e) => {
  const authFields = document.getElementById('auth-fields');
  authFields.style.display = e.target.checked ? 'block' : 'none';
});

// 환경설정 폼 제출
document.getElementById('form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const enabled = document.getElementById('setting-auth-enabled').checked;
  const currentPassword = document.getElementById('setting-current-password').value;
  const newPassword = document.getElementById('setting-new-password').value;
  const confirmPassword = document.getElementById('setting-confirm-password').value;

  if (enabled && newPassword && newPassword !== confirmPassword) {
    alert('새 마스터 비밀번호가 일치하지 않습니다.');
    return;
  }

  try {
    const res = await fetch('/api/auth/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '설정 저장 실패');
      return;
    }

    alert('설정이 성공적으로 저장되었습니다.');
    closeModal('modal-settings');
    loadServers();
  } catch (err) {
    alert('설정 저장 중 오류: ' + err.message);
  }
});

// 10. 로그인 폼 제출
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorBox = document.getElementById('login-error');
  errorBox.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || '로그인 실패';
      errorBox.style.display = 'block';
      return;
    }

    closeModal('modal-login');
    document.getElementById('login-password').value = '';
    loadServers();
  } catch (err) {
    errorBox.textContent = '로그인 요청 중 오류 발생: ' + err.message;
    errorBox.style.display = 'block';
  }
});

// 11. 로그아웃
document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

// 12. 검색 필터
document.getElementById('search-input').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = serversData.filter(s => 
    s.name.toLowerCase().includes(query) ||
    s.host.toLowerCase().includes(query) ||
    (s.description && s.description.toLowerCase().includes(query))
  );
  renderServers(filtered);
  filtered.forEach(s => checkServerPing(s.id));
});

// 유틸: HTML escape
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 이벤트 리스너 등록
document.getElementById('btn-open-add-server').addEventListener('click', openAddServerModal);

// 초기 실행
loadServers();
