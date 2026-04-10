var mfaPendingToken = null;

async function login(){
  var u=document.getElementById('username').value,p=document.getElementById('password').value;
  if(!u||!p)return;
  var r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
  var d=await r.json();
  if(d.success){
    if(d.mfaRequired){
      // Show MFA step
      mfaPendingToken = d.mfaPendingToken;
      document.getElementById('username').parentElement.style.display='none';
      document.getElementById('password').parentElement.style.display='none';
      document.getElementById('loginBtn').style.display='none';
      document.getElementById('error').style.display='none';
      document.getElementById('mfaStep').style.display='block';
      document.getElementById('totpCode').focus();
      return;
    }
    window.location.href='/admin.html';
  }
  else{document.getElementById('error').style.display='block';}
}

async function verifyMfa(){
  var code=document.getElementById('totpCode').value;
  if(!code||code.length!==6)return;
  var r=await fetch('/api/auth/mfa/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mfaPendingToken:mfaPendingToken,totpCode:code})});
  var d=await r.json();
  if(d.success){
    window.location.href='/admin.html';
  } else {
    document.getElementById('error').textContent=d.error||'認証コードが正しくありません';
    document.getElementById('error').style.display='block';
    document.getElementById('totpCode').value='';
    document.getElementById('totpCode').focus();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') login();
  });
  document.getElementById('loginBtn').addEventListener('click', function() {
    login();
  });
  document.getElementById('totpCode').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') verifyMfa();
  });
  document.getElementById('mfaBtn').addEventListener('click', function() {
    verifyMfa();
  });
});
