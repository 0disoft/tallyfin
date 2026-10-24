export const loginPage = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tallyfin 관리자 로그인</title><link rel="stylesheet" href="/login.css"></head>
<body><main><p class="brand">Tallyfin</p><h1>관리자 로그인</h1>
<p>운영자가 등록한 관리자 계정으로 로그인하세요.</p>
<form id="login"><label>이메일<input name="email" type="email" autocomplete="username" required maxlength="254"></label>
<label>비밀번호<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
<button type="submit">로그인</button></form>
<p id="error" role="alert"></p><p class="note">계정 복구는 설치 운영자에게 요청하세요. 공개 회원가입은 제공하지 않아요.</p>
<details><summary>비밀번호 변경</summary><form id="password">
<label>현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>
<label>새 비밀번호<input name="newPassword" type="password" autocomplete="new-password" required minlength="14" maxlength="128"></label>
<button type="submit">비밀번호 변경</button></form><p class="note">먼저 이 브라우저에서 로그인한 뒤 변경할 수 있어요.</p></details>
</main><script src="/login.js" defer></script></body></html>`;

export const loginStyle = `:root{color-scheme:dark;font:16px system-ui,sans-serif;background:#10151d;color:#edf2f7}body{margin:0;padding:32px 20px}main{max-width:400px;margin:8vh auto;padding:32px;border:1px solid #344054;border-radius:16px;background:#18212e}.brand{font-weight:700;color:#9db7ff}h1{font-size:24px}p{line-height:1.6}label{display:block;margin:20px 0 12px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit}input{display:block;margin-top:8px;border:1px solid #667085;background:#10151d;color:inherit}button{margin-top:16px;border:0;background:#a9c1ff;color:#10151d;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}:focus-visible{outline:3px solid #a9c1ff;outline-offset:3px}.note{font-size:13px;color:#b4c0d1}#error{color:#ffb4b4}summary{cursor:pointer}`;

export const loginScript = `const message = document.getElementById('error');
async function submit(form, path, body) {
  const button = form.querySelector('button'); button.disabled = true; message.textContent = '';
  try {
    const response = await fetch('/api/auth/' + path, {method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error();
    const result = await response.json();
    form.reset();
    if (result.redirect && result.url) {
      const target = new URL(result.url, location.origin);
      if (target.origin !== location.origin && target.origin !== document.documentElement.dataset.adminOrigin) throw Error();
      location.replace(target.href);
    } else message.textContent = path === 'change-password' ? '비밀번호를 변경했어요.' : '로그인했어요. 관리자 화면에서 로그인을 다시 시작하세요.';
  } catch { message.textContent = '처리하지 못했어요. 입력을 확인하고 잠시 후 다시 시도하세요.'; }
  finally { button.disabled = false; }
}
document.getElementById('login').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  submit(form, 'sign-in/email', {email:data.get('email'),password:data.get('password'),rememberMe:false,
    ...(location.search ? {oauth_query:location.search.slice(1)} : {})});
});
document.getElementById('password').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  submit(form, 'change-password', {currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword'),revokeOtherSessions:true});
});`;
