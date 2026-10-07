// push.js — notificacao no celular (Web Push). O aviso chega na tela de bloqueio,
// mesmo com o app fechado. Precisa de HTTPS, de permissao da pessoa e, no iPhone,
// do app instalado na tela inicial.
"use strict";

var pushCfg = null;

function pushIsIos(){ return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
function pushIsStandalone(){ return window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); }
function pushSupported(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

function pushB64ToUint8(b64){
  var pad = "=".repeat((4 - b64.length % 4) % 4);
  var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  var out = new Uint8Array(raw.length);
  for(var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushGetSub(){
  return navigator.serviceWorker.ready.then(function(reg){ return reg.pushManager.getSubscription(); });
}

function pushLoadConfig(){
  if(pushCfg) return Promise.resolve(pushCfg);
  return authFetch("/api/push/config").then(function(r){ return r.ok ? r.json() : { enabled: false }; })
    .then(function(c){ pushCfg = c; return c; }).catch(function(){ return { enabled: false }; });
}

function pushPost(url, body){
  return authFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}

// Liga neste aparelho (precisa vir de um toque: o navegador pergunta a permissao).
function pushEnable(){
  return pushLoadConfig().then(function(cfg){
    if(!cfg.enabled) throw new Error("disabled");
    return Notification.requestPermission().then(function(perm){
      if(perm !== "granted") throw new Error("denied");
      return navigator.serviceWorker.ready;
    }).then(function(reg){
      return reg.pushManager.getSubscription().then(function(sub){
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushB64ToUint8(cfg.publicKey) });
      });
    }).then(function(sub){
      return pushPost("/api/me/push/subscribe", { subscription: sub.toJSON() }).then(function(r){ if(!r.ok) throw new Error("server"); });
    });
  });
}

function pushDisable(){
  return pushGetSub().then(function(sub){
    if(!sub) return;
    var endpoint = sub.endpoint;
    return pushPost("/api/me/push/unsubscribe", { endpoint: endpoint }).catch(function(){}).then(function(){ return sub.unsubscribe(); });
  });
}

// Ao sair da conta: este aparelho nao recebe mais os avisos dessa pessoa.
function pushDetachDevice(){
  if(!pushSupported() || !authToken) return;
  try{
    pushGetSub().then(function(sub){
      if(sub) return pushPost("/api/me/push/unsubscribe", { endpoint: sub.endpoint });
    }).catch(function(){});
  }catch(e){}
}

// Ao abrir o app: se este aparelho ja tem permissao, garante que a inscricao esta
// ligada a conta de quem esta logado agora.
function pushSyncOnBoot(){
  if(!pushSupported() || !currentUser || !currentUser.companyId || Notification.permission !== "granted") return;
  pushLoadConfig().then(function(cfg){
    if(!cfg.enabled) return;
    return pushGetSub().then(function(sub){
      if(sub) return pushPost("/api/me/push/subscribe", { subscription: sub.toJSON() });
    });
  }).catch(function(){});
}

function renderPushBox(){
  var boxes = document.querySelectorAll(".push-box");
  if(!boxes.length) return;
  function paint(html, hint, buttons){
    boxes.forEach(function(box){
      box.innerHTML = "";
      var line = document.createElement("div"); line.className = "push-line";
      var span = document.createElement("span"); span.textContent = html; line.appendChild(span);
      (buttons || []).forEach(function(b){ line.appendChild(b); });
      box.appendChild(line);
      if(hint){ var p = document.createElement("p"); p.className = "push-hint"; p.textContent = hint; box.appendChild(p); }
    });
  }
  function btn(label, cls, fn){
    var b = document.createElement("button"); b.type = "button"; b.className = "small " + (cls || ""); b.textContent = label;
    b.addEventListener("click", function(){ b.disabled = true; fn().then(renderPushBox).catch(function(err){
      var m = err && err.message;
      showToast(m === "denied" ? "Permissão negada. Libere as notificações nas configurações do navegador." : (m === "disabled" ? "As notificações no celular ainda não estão ativas neste servidor." : "Não consegui ativar agora."));
      renderPushBox();
    }); });
    return b;
  }
  if(!currentUser || !currentUser.companyId){ boxes.forEach(function(b){ b.innerHTML = ""; }); return; }
  if(!pushSupported()){
    if(pushIsIos() && !pushIsStandalone()){
      paint("🔔 Receba os avisos na tela do celular", "No iPhone, primeiro instale o app: no Safari toque em Compartilhar e depois em \"Adicionar à Tela de Início\". Abra o app por lá e ative aqui.");
    } else {
      boxes.forEach(function(b){ b.innerHTML = ""; });
    }
    return;
  }
  pushLoadConfig().then(function(cfg){
    if(!cfg.enabled){ boxes.forEach(function(b){ b.innerHTML = ""; }); return; }
    if(Notification.permission === "denied"){
      paint("🔕 Notificações bloqueadas neste aparelho", "Para receber avisos, libere as notificações deste site nas configurações do navegador.");
      return;
    }
    return pushGetSub().then(function(sub){
      if(sub && Notification.permission === "granted"){
        paint("🔔 Avisos no celular: ligados neste aparelho", "", [
          btn("Enviar teste", "", function(){ return pushPost("/api/me/push/test").then(function(r){ showToast(r.ok ? "Teste enviado." : "Não consegui enviar o teste."); }); }),
          btn("Desligar", "", pushDisable)
        ]);
      } else {
        paint("🔔 Receba os avisos da escala na tela do celular", "Você é avisado quando a escala sai, muda, quando alguém pede troca e quando o mês é fechado.", [
          btn("Ativar neste aparelho", "primary", pushEnable)
        ]);
      }
    });
  }).catch(function(){});
}
