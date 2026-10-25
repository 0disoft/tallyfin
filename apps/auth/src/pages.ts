import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './password-policy.ts';

export const loginPage = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tallyfin 관리자 로그인</title><link rel="stylesheet" href="/login.css"></head>
<body><main><p class="brand">Tallyfin</p><h1>관리자 로그인</h1>
<p>운영자가 등록한 관리자 계정으로 로그인하세요.</p>
<form id="login"><label>이메일<input name="email" type="email" autocomplete="username" required maxlength="254"></label>
<label>비밀번호<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
<button type="submit">로그인</button></form>
<p id="error" role="alert"></p><p class="note">계정 복구는 설치 운영자에게 요청하세요. 공개 회원가입은 제공하지 않아요.</p>
</main><script src="/login.js" defer></script></body></html>`;

export const passwordPage = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>비밀번호 변경 · Tallyfin</title><link rel="stylesheet" href="/login.css"></head>
<body><main><p class="brand">Tallyfin</p><h1>비밀번호 변경</h1>
<p>새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상 ${MAX_PASSWORD_LENGTH}자 이하로 입력하세요.</p>
<form id="password">
<label>현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="${MAX_PASSWORD_LENGTH}"></label>
<label>새 비밀번호<input name="newPassword" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}"></label>
<label>새 비밀번호 확인<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}"></label>
<button type="submit">비밀번호 변경</button></form>
<p id="error" role="status" aria-live="polite"></p>
<p class="note">변경하면 다른 브라우저의 로그인 세션이 종료돼요.</p>
<a id="admin-return" href="/">관리자 화면으로 돌아가기</a>
</main><script src="/login.js" defer></script></body></html>`;

export const loginStyle = `:root{color-scheme:dark;font:16px system-ui,sans-serif;background:#10151d;color:#edf2f7}body{margin:0;padding:32px 20px}main{max-width:400px;margin:8vh auto;padding:32px;border:1px solid #344054;border-radius:16px;background:#18212e}.brand{font-weight:700;color:#9db7ff}h1{font-size:24px}p{line-height:1.6}label{display:block;margin:20px 0 12px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit}input{display:block;margin-top:8px;border:1px solid #667085;background:#10151d;color:inherit}button{margin-top:16px;border:0;background:#a9c1ff;color:#10151d;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}:focus-visible{outline:3px solid #a9c1ff;outline-offset:3px}.note{font-size:13px;color:#b4c0d1}#error{color:#ffb4b4}summary{cursor:pointer}`;

export const loginScript = `const message = document.getElementById('error');
async function submit(form, path, body) {
  const button = form.querySelector('button'); button.disabled = true; message.textContent = ''; message.style.color = '';
  try {
    const response = await fetch('/api/auth/' + path, {method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if (!response.ok) {
      if (response.status === 401 && path === 'change-password') {
        location.replace('/sign-in?returnTo=password'); return;
      }
      throw Error();
    }
    const result = await response.json();
    form.reset();
    if (result.redirect && result.url) {
      const target = new URL(result.url, location.origin);
      if (target.origin !== location.origin && target.origin !== document.documentElement.dataset.adminOrigin) throw Error();
      location.replace(target.href);
    } else if (path === 'sign-in/email' && location.search === '?returnTo=password') location.replace('/account/password');
    else { message.style.color = '#a6e3b5'; message.textContent = path === 'change-password' ? '비밀번호를 변경했어요.' : '로그인했어요. 관리자 화면에서 로그인을 다시 시작하세요.'; }
  } catch { message.textContent = '처리하지 못했어요. 입력을 확인하고 잠시 후 다시 시도하세요.'; }
  finally { button.disabled = false; }
}
document.getElementById('login')?.addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  submit(form, 'sign-in/email', {email:data.get('email'),password:data.get('password'),rememberMe:false,
    ...(location.search && location.search !== '?returnTo=password' ? {oauth_query:location.search.slice(1)} : {})});
});
const adminReturn = document.getElementById('admin-return');
if (adminReturn) adminReturn.href = document.documentElement.dataset.adminOrigin;
document.getElementById('password')?.addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  if (data.get('newPassword') !== data.get('confirmPassword')) { message.style.color = ''; message.textContent = '새 비밀번호가 서로 달라요.'; return; }
  submit(form, 'change-password', {currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword'),revokeOtherSessions:true});
});`;
