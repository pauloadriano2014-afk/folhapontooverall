// legal.js — termos de uso, politica de privacidade e direitos do titular (LGPD):
// aceite no cadastro/no primeiro acesso, copia dos dados e exclusao da conta.
"use strict";

// Contato de privacidade mostrado na politica (deixe vazio para nao mostrar).
// Exemplo: "privacidade@seudominio.com.br"
var PRIVACY_CONTACT = "";

function openLegal(which){
  var id = which === "privacy" ? "privacyOverlay" : "termsOverlay";
  var contact = document.getElementById("privacyContact");
  if(contact){
    contact.style.display = PRIVACY_CONTACT ? "" : "none";
    contact.textContent = PRIVACY_CONTACT ? "Dúvidas sobre os seus dados: " + PRIVACY_CONTACT : "";
  }
  document.getElementById(id).classList.add("open");
}

// links/botoes "data-legal" em qualquer tela (cadastro, conta, aceite)
document.addEventListener("click", function(e){
  var el = e.target.closest ? e.target.closest("[data-legal]") : null;
  if(!el) return;
  e.preventDefault();
  openLegal(el.getAttribute("data-legal"));
});

// ---------- aceite obrigatorio (conta antiga ou termos novos) ----------
function checkTermsGate(){
  var gate = document.getElementById("termsGateOverlay");
  if(!gate || !currentUser) return;
  if(currentUser.termsAccepted !== false){ gate.classList.remove("open"); return; }
  document.getElementById("gateAccept").checked = false;
  document.getElementById("btnGateAccept").disabled = true;
  document.getElementById("gateError").textContent = "";
  gate.classList.add("open");
}

(function(){
  var chk = document.getElementById("gateAccept"), btn = document.getElementById("btnGateAccept");
  if(!chk || !btn) return;
  chk.addEventListener("change", function(){ btn.disabled = !chk.checked; });
  btn.addEventListener("click", function(){
    btn.disabled = true;
    authFetch("/api/me/accept-terms", { method: "POST" }).then(function(res){
      if(!res.ok) throw new Error("http");
      currentUser.termsAccepted = true;
      try{ localStorage.setItem(USER_KEY, JSON.stringify(currentUser)); }catch(e){}
      if(typeof pinSessionToTab === "function") pinSessionToTab(authToken, currentUser);
      document.getElementById("termsGateOverlay").classList.remove("open");
    }).catch(function(){
      document.getElementById("gateError").textContent = "Não consegui registrar o aceite. Confira a conexão e tente de novo.";
      btn.disabled = false;
    });
  });
})();

// ---------- baixar meus dados ----------
(function(){
  var btn = document.getElementById("btnExportMyData");
  if(!btn) return;
  btn.addEventListener("click", function(){
    btn.disabled = true;
    authFetch("/api/me/export").then(function(res){
      if(res.status === 401){ handleAuthExpired(); throw new Error("auth"); }
      if(!res.ok) throw new Error("http");
      return res.blob();
    }).then(function(blob){
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "meus-dados-ponto-overall.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
      showToast("Cópia dos seus dados baixada.");
    }).catch(function(err){
      if(err && err.message === "auth") return;
      showToast("Não consegui baixar os dados agora.");
    }).then(function(){ btn.disabled = false; });
  });
})();

// ---------- excluir minha conta ----------
(function(){
  var open = document.getElementById("btnDeleteAccount"), confirmBtn = document.getElementById("btnDeleteAccountConfirm");
  if(!open || !confirmBtn) return;
  open.addEventListener("click", function(){
    document.getElementById("deleteAccountPassword").value = "";
    document.getElementById("deleteAccountError").textContent = "";
    document.getElementById("deleteAccountOverlay").classList.add("open");
  });
  confirmBtn.addEventListener("click", function(){
    var err = document.getElementById("deleteAccountError");
    var pw = document.getElementById("deleteAccountPassword").value;
    if(!pw){ err.textContent = "Digite a sua senha."; return; }
    confirmBtn.disabled = true;
    authFetch("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) })
      .then(function(res){ return res.json().then(function(b){ return { ok: res.ok, body: b }; }); })
      .then(function(r){
        confirmBtn.disabled = false;
        if(!r.ok){ err.textContent = (r.body && r.body.message) || "Não consegui apagar a conta."; return; }
        // limpa tudo o que ficou neste aparelho e volta para a tela de entrada
        try{
          var uid = currentUser ? currentUser.id : null;
          if(uid){ localStorage.removeItem("pontoOverallData_v1_" + uid); localStorage.removeItem("pontoOverallData_v1_" + uid + "_conflictBackup"); localStorage.removeItem(NAV_VIEW_KEY + uid); }
        }catch(e){}
        logout();
        showToast("Conta apagada.");
      }).catch(function(){ confirmBtn.disabled = false; err.textContent = "Sem conexão com o servidor."; });
  });
})();
