// state.js — modelo de dados do Ponto Overall: constantes compartilhadas,
// feriados, carregar/salvar/normalizar os dados da conta, e sincronizacao
// com o servidor. Todo o resto do app le/escreve a variavel `data` definida
// aqui (sem modulos ES — os arquivos js/ carregam em ordem no index.html e
// compartilham o mesmo escopo global, de proposito, pra nao precisar de
// build step nenhum pra publicar).
"use strict";

  var DEFAULT_TIME_SLOTS = ["17:00–18:00","18:00–19:00","19:00–20:00","20:00–21:00","21:00–22:00","22:00–23:00"];
  function getTimeSlots(){
    var s = data && data.settings && data.settings.timeSlots;
    return (Array.isArray(s) && s.length) ? s : DEFAULT_TIME_SLOTS;
  }
  var DOW_NAMES = ["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
  // Horario de fim de semana alternativo (opcional, por conta): em vez da grade
  // fixa de 6 horarios da semana, sabado/domingo viram um unico turno de "sala"
  // de 5 horas, cujo horario exato (manha ou tarde) muda de fim de semana pra
  // fim de semana — por isso e escolhido manualmente dia a dia, nao fixo.
  var SHIFT_LABELS = { manha: "08:00–13:00", tarde: "13:00–18:00" };
  var SHIFT_SHORT = { manha: "08–13", tarde: "13–18" };
  function isWeekendDow(dow){ return dow === 0 || dow === 6; }
  function isSingleShiftDay(dateKey){
    return !!data.settings.weekendShiftEnabled && isWeekendDow(dowOfDateKey(dateKey));
  }
  var VIP_COLS = [
    {key:"seg", label:"SEG"},
    {key:"ter", label:"TER"},
    {key:"qua", label:"QUA"},
    {key:"qui", label:"QUI"},
    {key:"sex", label:"SEX"}
  ];

  // ---------- feriados nacionais + Curitiba/PR ----------
  // Calculados na hora (sem precisar baixar nada), pra marcar automaticamente os
  // dias de feriado quando um mes novo e criado, ou quando a pessoa clica em
  // "Feriados" pra aplicar num mes ja existente. So marca dias que ainda estao
  // 100% vazios — nunca sobrescreve um dia que a pessoa ja preencheu.
  function easterDate(year){
    // Algoritmo de Meeus/Jones/Butcher, usado so pra derivar Carnaval,
    // Sexta-feira Santa e Corpus Christi de cada ano a partir da Pascoa.
    var a = year % 19;
    var b = Math.floor(year / 100);
    var c = year % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marco, 4=abril
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function addDays(date, days){
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function dateKeyOf(date){
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function getHolidaysForYear(year){
    var easter = easterDate(year);
    var map = {};
    function add(date, name){ map[dateKeyOf(date)] = name; }

    add(new Date(year, 0, 1), "Confraternização Universal");
    add(new Date(year, 3, 21), "Tiradentes");
    add(new Date(year, 4, 1), "Dia do Trabalho");
    add(new Date(year, 8, 7), "Independência do Brasil");
    add(new Date(year, 8, 8), "Nossa Senhora da Luz dos Pinhais (Curitiba)");
    add(new Date(year, 9, 12), "Nossa Senhora Aparecida");
    add(new Date(year, 10, 2), "Finados");
    add(new Date(year, 10, 15), "Proclamação da República");
    add(new Date(year, 10, 20), "Dia da Consciência Negra");
    add(new Date(year, 11, 25), "Natal");
    add(new Date(year, 2, 29), "Aniversário de Curitiba");
    add(new Date(year, 11, 19), "Emancipação Política do Paraná");

    add(addDays(easter, -48), "Carnaval (segunda)");
    add(addDays(easter, -47), "Carnaval (terça)");
    add(addDays(easter, -2), "Sexta-feira Santa");
    add(addDays(easter, 60), "Corpus Christi");

    return map;
  }

  var HOLIDAY_CACHE = {};
  function holidaysForDateKey(dateKey){
    var year = parseInt(dateKey.split("-")[0], 10);
    if(!HOLIDAY_CACHE[year]) HOLIDAY_CACHE[year] = getHolidaysForYear(year);
    return HOLIDAY_CACHE[year][dateKey] || null;
  }

  // ---------- data layer ----------
  // Cada conta comeca do zero (sem horas/alunos pre-preenchidos) — os dados de
  // setembro/2026 da Paulo, que existiam antes de ter login, foram migrados
  // manualmente pra conta dele depois que ele se cadastrou.
  function blankVipSlots(count){
    var arr = [];
    for(var i = 0; i < count; i++){
      arr.push({ seg:"", ter:"", qua:"", qui:"", sex:"" });
    }
    return arr;
  }

  function defaultData(){
    var defaultSlots = DEFAULT_TIME_SLOTS.slice();
    return {
      version: 1,
      updatedAt: null,
      settings: { defaultAuxilio: 0, quickValues: [10, 15], reminderEnabled: false, reminderTime: "21:00", weekendShiftEnabled: false, timeSlots: defaultSlots },
      months: {},
      vip: { slots: blankVipSlots(defaultSlots.length), attendance: {} },
      clients: []
    };
  }

  // Garante que dias/meses vindos de um backup mais antigo (de antes dessas
  // funcoes existirem) tenham os campos novos com um valor padrao, em vez de
  // ficar undefined.
  function normalizeDay(dayObj){
    if(typeof dayObj.note !== "string") dayObj.note = "";
    if(typeof dayObj.shift === "undefined") dayObj.shift = null;
    return dayObj;
  }

  function normalizeMonth(monthObj){
    if(typeof monthObj.paid !== "boolean") monthObj.paid = false;
    Object.keys(monthObj.days).forEach(function(k){ normalizeDay(monthObj.days[k]); });
    return monthObj;
  }

  var data = defaultData();

  function loadData(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultData();
      var parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== "object") return defaultData();
      var d = defaultData();
      d.settings = Object.assign(d.settings, parsed.settings || {});
      if(!Array.isArray(d.settings.timeSlots) || d.settings.timeSlots.length === 0){
        d.settings.timeSlots = DEFAULT_TIME_SLOTS.slice();
      }
      d.months = parsed.months || {};
      Object.keys(d.months).forEach(function(k){ normalizeMonth(d.months[k]); });
      d.updatedAt = parsed.updatedAt || null;
      if(parsed.vip && Array.isArray(parsed.vip.slots)){
        d.vip = parsed.vip;
        if(!d.vip.attendance) d.vip.attendance = {};
      }
      d.clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      d.clients.forEach(function(c){
        if(!c.days) c.days = blankClientDays();
        if(!c.adjustments) c.adjustments = {};
        delete c.attendance; // mecanismo de falta/extra removido a pedido do Paulo
        if(c.billingType !== "monthly") c.billingType = "session";
        if(typeof c.flatMonthlyValue === "undefined" || c.flatMonthlyValue === null) c.flatMonthlyValue = 0;
        if(!c.id) c.id = newClientId();
      });
      return d;
    }catch(e){
      console.warn("Falha ao carregar dados, iniciando vazio.", e);
      return defaultData();
    }
  }

  function saveData(){
    // Enquanto o primeiro contato com o servidor nao aconteceu, um aparelho
    // "virgem" (sem updatedAt) NAO se carimba como "agora": do contrario o
    // mes em branco criado no boot pareceria mais novo que os dados reais do
    // servidor e os apagaria (ver resolveInitialSync).
    if(initialSyncDone || data.updatedAt) data.updatedAt = new Date().toISOString();
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }catch(e){
      showToast("Não consegui salvar (armazenamento cheio?)");
      console.error(e);
    }
    scheduleSync();
  }


  // ---------- sincronizacao com o servidor (Neon), pra usar o mesmo ponto no celular e no PC ----------
  // Regras (todas existem pra NUNCA perder horas lancadas):
  //  1. Nada e enviado antes do 1o contato com o servidor dar certo
  //     (initialSyncDone). Se esse contato falhar (rede, Render "dormindo"),
  //     o app segue funcionando so local e tenta de novo sozinho.
  //  2. Todo envio diz qual versao do servidor este aparelho conhece
  //     (serverVersion). Se outro aparelho — ou a gerencia, mudando o horario —
  //     salvou antes, o servidor recusa (409) e o app MESCLA em vez de
  //     sobrescrever (ver mergeData). Se der conflito de verdade no mesmo mes,
  //     vale o do servidor e o seu fica guardado em backup neste aparelho.
  //  3. Ao voltar pro app (ou a cada ~90s com ele aberto) busca mudancas do
  //     servidor, pra um aparelho nao ficar com a versao velha.
  var syncTimer = null;
  var syncInFlight = false;
  var pendingPush = false;       // ha alteracao local ainda nao enviada
  var syncStatusEl = null;
  var syncIconEl = null;
  var syncLabelEl = null;
  var syncStatusMsg = "";
  var initialSyncDone = false;
  var serverVersion = null;      // updated_at do servidor visto por ultimo (null = servidor sem nada)
  var syncedSnapshot = null;     // JSON dos dados na ultima sincronizacao (base da mesclagem)
  var initialRetryTimer = null;
  var initialRetryDelay = 4000;
  var refreshTimer = null;

  function resetSyncState(){
    clearTimeout(syncTimer);
    clearTimeout(initialRetryTimer);
    clearInterval(refreshTimer);
    syncInFlight = false; pendingPush = false;
    initialSyncDone = false; serverVersion = null; syncedSnapshot = null;
    initialRetryDelay = 4000;
  }

  function setSyncStatus(state, title){
    syncStatusMsg = title || "";
    if(!syncStatusEl) return;
    var icon = state === "ok" ? "🟢" : state === "syncing" ? "🔄" : "🟡";
    var label = state === "ok" ? "Sincronizado" : state === "syncing" ? "Sincronizando" : "Sem conexão";
    if(syncIconEl) syncIconEl.textContent = icon;
    if(syncLabelEl) syncLabelEl.textContent = label;
    syncStatusEl.title = title || "";
  }

  function scheduleSync(){
    pendingPush = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushRemoteState, 900);
  }

  // Dados sem nada digitado pela pessoa (conta nova / aparelho novo).
  function isPristineData(d){
    if(!d) return true;
    if((d.clients && d.clients.length) || (d.vip && d.vip.slots && d.vip.slots.some(function(r){
      return VIP_COLS.some(function(c){ return r[c.key]; });
    }))) return false;
    return !Object.keys(d.months || {}).some(function(k){
      var m = d.months[k];
      if(m.obs || m.consumo || m.paid) return true;
      return Object.keys(m.days || {}).some(function(dk){
        var day = m.days[dk];
        return (day.note && day.note.trim()) || (day.slots || []).some(function(v){ return typeof v === "number" || v === "SEM_ESCALA"; });
      });
    });
  }

  // Guarda neste aparelho uma copia do que foi deixado de lado numa mesclagem.
  function backupLocalData(){
    if(!STORAGE_KEY || isPristineData(data)) return;
    try{
      localStorage.setItem(STORAGE_KEY + "_conflictBackup", JSON.stringify({ savedAt: new Date().toISOString(), data: data }));
    }catch(e){}
  }

  function adoptServerData(remoteData, version){
    data = remoteData;
    serverVersion = version || null;
    syncedSnapshot = JSON.stringify(data);
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){}
  }

  // Redesenha a tela com `data` atual (depois de trazer dados do servidor com o app ja aberto).
  function refreshUIFromData(){
    if(!STORAGE_KEY) return;
    if(typeof setAccountLabel === "function") setAccountLabel();
    applyRoleVisibility();
    if(!data.months[currentMonthKey]) initMonthState();
    renderMonthSelect();
    renderGrid();
    renderVip();
    renderQuickValuesUI();
    if(typeof renderClients === "function") renderClients();
  }

  // Mescla "o que eu mudei aqui" com "o que mudou la no servidor", desde a
  // ultima vez que estavam iguais (base). Granularidade: cada mes, o VIP, a
  // lista de alunos e cada configuracao. Se os dois lados mexeram na MESMA
  // coisa, o servidor vence (e quem chama guarda backup do local).
  function mergeData(base, local, remote){
    var out = JSON.parse(JSON.stringify(remote));
    var conflict = false;
    function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
    function mergeMap(getMap, keys){
      keys.forEach(function(k){
        var b = getMap(base)[k], l = getMap(local)[k], r = getMap(remote)[k];
        var lc = !same(b, l), rc = !same(b, r);
        if(lc && !rc){
          if(typeof l === "undefined") delete getMap(out)[k]; else getMap(out)[k] = l;
        } else if(lc && rc && !same(l, r)){
          conflict = true;
        }
      });
    }
    function union(getMap){
      var seen = {};
      [base, local, remote].forEach(function(o){ Object.keys(getMap(o)).forEach(function(k){ seen[k] = 1; }); });
      return Object.keys(seen);
    }
    var months = function(o){ o.months = o.months || {}; return o.months; };
    var settings = function(o){ o.settings = o.settings || {}; return o.settings; };
    mergeMap(months, union(months));
    mergeMap(settings, union(settings));
    ["vip", "clients"].forEach(function(k){
      var b = base[k], l = local[k], r = remote[k];
      var lc = !same(b, l), rc = !same(b, r);
      if(lc && !rc) out[k] = l;
      else if(lc && rc && !same(l, r)) conflict = true;
    });
    out.updatedAt = new Date().toISOString();
    return { data: out, conflict: conflict };
  }

  // Servidor recusou o envio (409): outro aparelho/gerencia salvou antes.
  function handleVersionConflict(body){
    var remoteData = body && body.data;
    if(!remoteData || typeof remoteData !== "object"){
      serverVersion = null; scheduleSync(); return;
    }
    var merged = null;
    if(syncedSnapshot){
      try{ merged = mergeData(JSON.parse(syncedSnapshot), data, remoteData); }catch(e){ merged = null; }
    }
    if(!merged || merged.conflict) backupLocalData();
    var result = merged ? merged.data : remoteData;
    adoptServerData(result, body.updated_at);
    syncedSnapshot = JSON.stringify(remoteData); // base = o que o servidor tem de fato
    if(merged && !merged.conflict) scheduleSync(); // reenvia ja com tudo junto
    refreshUIFromData();
    showToast(merged && !merged.conflict
      ? "Dados atualizados com mudanças de outro aparelho."
      : "Dados atualizados em outro aparelho. Suas últimas alterações ficaram guardadas em backup neste aparelho.");
  }

  function pushRemoteState(){
    if(!authToken) return;
    if(!initialSyncDone){ scheduleSync(); return; }
    if(syncInFlight){ scheduleSync(); return; }
    syncInFlight = true;
    pendingPush = false;
    setSyncStatus("syncing", "Sincronizando...");
    var sentSnapshot = JSON.stringify(data);
    authFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Base-Version": serverVersion || "none" },
      body: sentSnapshot
    }).then(function(res){
      if(res.status === 401){ syncInFlight = false; handleAuthExpired(); return; }
      if(res.status === 409){
        return res.json().then(function(body){
          syncInFlight = false;
          handleVersionConflict(body);
          setSyncStatus("ok", "Sincronizado com o servidor");
        });
      }
      if(!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then(function(body){
        syncInFlight = false;
        serverVersion = body.updated_at || serverVersion;
        syncedSnapshot = sentSnapshot;
        setSyncStatus("ok", "Sincronizado com o servidor");
      });
    }).catch(function(err){
      syncInFlight = false;
      pendingPush = true;
      setSyncStatus("offline", "Sem conexão com o servidor — salvando só neste aparelho");
      console.warn("Falha ao sincronizar:", err);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(pushRemoteState, 15000); // tenta de novo sozinho
    });
  }

  function fetchRemoteState(){
    return authFetch("/api/state").then(function(res){
      if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
      if(!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // Decide, uma unica vez, quem manda: dados locais ou do servidor. Devolve
  // true se trocou os dados locais pelos do servidor.
  function reconcileWithRemote(remote){
    var remoteData = remote && remote.data;
    serverVersion = (remote && remote.updated_at) || null;
    var localTime = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
    if(remoteData && typeof remoteData === "object"){
      var remoteTime = remoteData.updatedAt ? new Date(remoteData.updatedAt).getTime() : 0;
      if(remoteTime > localTime || (remoteTime === localTime && isPristineData(data))){
        backupLocalData(); // so guarda se havia algo digitado aqui
        adoptServerData(remoteData, serverVersion);
        return true;
      }
      syncedSnapshot = JSON.stringify(remoteData);
      if(localTime > remoteTime) scheduleSync(); // mudanca feita offline: envia
      return false;
    }
    // Servidor sem nada: conta nova de verdade, envia o que temos.
    syncedSnapshot = null;
    scheduleSync();
    return false;
  }

  function attemptInitialSync(isRetry){
    return fetchRemoteState().then(function(remote){
      initialSyncDone = true;
      var replaced = reconcileWithRemote(remote);
      setSyncStatus("ok", "Sincronizado com o servidor");
      if(isRetry && replaced){
        refreshUIFromData();
        showToast("Dados do servidor carregados.");
      }
      startBackgroundRefresh();
    }).catch(function(err){
      if(err && err.message === "auth_expired") return;
      // NAO libera o envio: sem saber o que o servidor tem, enviar poderia
      // apagar dados reais. Segue so local e tenta de novo.
      setSyncStatus("offline", "Sem conexão com o servidor — usando dados salvos neste aparelho");
      console.warn("Falha ao buscar dados do servidor:", err);
      clearTimeout(initialRetryTimer);
      initialRetryTimer = setTimeout(function(){ attemptInitialSync(true); }, initialRetryDelay);
      initialRetryDelay = Math.min(initialRetryDelay * 2, 60000);
    });
  }

  // Chamada logo apos loadData(), ANTES de qualquer coisa no boot que possa
  // mudar `data` (ver bootApp em app.js).
  function resolveInitialSync(){
    resetSyncState();
    syncStatusEl = document.getElementById("syncStatus");
    syncIconEl = document.getElementById("syncIcon");
    syncLabelEl = document.getElementById("syncLabel");
    if(syncStatusEl && !syncStatusEl.dataset.bound){
      syncStatusEl.dataset.bound = "1";
      syncStatusEl.addEventListener("click", function(){
        showToast(syncStatusMsg || "Sincronizando com o servidor...");
      });
    }
    setSyncStatus("syncing", "Verificando dados do servidor...");
    return attemptInitialSync(false);
  }

  // Busca mudancas feitas em outro aparelho (ou pela gerencia) e aplica,
  // desde que nao haja nada pendente aqui nem uma janela aberta.
  function refreshFromServer(){
    if(!authToken || !STORAGE_KEY || !initialSyncDone || syncInFlight || pendingPush) return;
    if(document.querySelector(".overlay.open")) return;
    fetchRemoteState().then(function(remote){
      if(syncInFlight || pendingPush || !remote || !remote.data || !remote.updated_at) return;
      if(remote.updated_at === serverVersion) return;
      adoptServerData(remote.data, remote.updated_at);
      refreshUIFromData();
      showToast("Dados atualizados.");
    }).catch(function(){});
  }

  function startBackgroundRefresh(){
    clearInterval(refreshTimer);
    refreshTimer = setInterval(function(){ if(!document.hidden) refreshFromServer(); }, 90000);
  }
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) refreshFromServer(); });
  window.addEventListener("online", function(){
    if(!authToken || !STORAGE_KEY) return;
    if(initialSyncDone) pushRemoteState(); else attemptInitialSync(true);
  });

  // Mantida por compatibilidade de nome: o trabalho real e feito em resolveInitialSync().
  function initSync(){}

  function pad2(n){ return (n < 10 ? "0" : "") + n; }

  function monthKeyOf(year, monthIndex){ return year + "-" + pad2(monthIndex + 1); }

  function daysInMonth(year, monthIndex){ return new Date(year, monthIndex + 1, 0).getDate(); }

  function ensureMonth(key){
    if(data.months[key]) return normalizeMonth(data.months[key]);
    var parts = key.split("-");
    var year = parseInt(parts[0], 10);
    var monthIndex = parseInt(parts[1], 10) - 1;
    var nDays = daysInMonth(year, monthIndex);
    var slotCount = getTimeSlots().length;
    var days = {};
    for(var d = 1; d <= nDays; d++){
      var dateKey = key + "-" + pad2(d);
      var isHoliday = !!holidaysForDateKey(dateKey);
      var slots = [];
      for(var i = 0; i < slotCount; i++) slots.push(isHoliday ? "FERIADO" : null);
      days[dateKey] = { note: "", shift: null, slots: slots };
    }
    data.months[key] = {
      auxilio: data.settings.defaultAuxilio || 0,
      consumo: 0,
      obs: "",
      paid: false,
      days: days
    };
    saveData();
    return data.months[key];
  }

  // Marca como feriado (sem apagar nada que ja tenha sido preenchido) os dias
  // deste mes que caem em feriado nacional ou de Curitiba/PR. Usado tanto pelo
  // botao "Feriados" (aplicar num mes ja existente) quanto internamente.
  function applyHolidaysToMonth(monthKey){
    var monthObj = ensureMonth(monthKey);
    var keys = dayKeysOf(monthKey);
    var count = 0;
    keys.forEach(function(dateKey){
      var name = holidaysForDateKey(dateKey);
      if(!name) return;
      var dayObj = monthObj.days[dateKey];
      var single = isSingleShiftDay(dateKey);
      var untouched = single
        ? (dayObj.slots[0] === null || dayObj.slots[0] === undefined)
        : dayObj.slots.every(function(v){ return v === null || v === undefined; });
      if(untouched){
        if(single){
          dayObj.slots[0] = "FERIADO";
        } else {
          dayObj.slots = dayObj.slots.map(function(){ return "FERIADO"; });
        }
        count++;
      }
    });
    if(count > 0) saveData();
    return count;
  }

  function sortedMonthKeys(){
    return Object.keys(data.months).sort();
  }

