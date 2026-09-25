// clients.js — alunos particulares (personal/avulso): cadastro, calculo do
// valor mensal (por sessao ou mensal fixo) e a grade de horarios clicavel.
"use strict";

  // ---------- alunos particulares (personal/avulso) ----------
  // Separado da grade de horas de propósito: um professor/estagiário usa a grade
  // (aulas em horário fixo, valor por slot), mas um personal trainer costuma
  // atender aluno por aluno, cada um com seu próprio valor por sessão e seus
  // próprios dias da semana — daqui sai um total próprio, que NÃO entra na conta
  // do "Salário mensal" da grade (fica separado de propósito).
  var CLIENT_DOW_KEYS = ["dom","seg","ter","qua","qui","sex","sab"];
  var CLIENT_DOW_LABELS = ["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
  var activeClientId = null;

  function newClientId(){
    return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function blankClientDays(){
    var o = {};
    CLIENT_DOW_KEYS.forEach(function(k){ o[k] = false; });
    return o;
  }

  function countWeekdayOccurrences(year, monthIndex){
    var nDays = daysInMonth(year, monthIndex);
    var counts = [0,0,0,0,0,0,0];
    for(var d = 1; d <= nDays; d++){
      counts[new Date(year, monthIndex, d).getDay()]++;
    }
    return counts;
  }

  // Quantas sessoes esse aluno deve ter tido nesse mes: ocorrencias dos dias da
  // semana marcados + o ajuste manual daquele mes (se houver), nunca negativo.
  // So importa pra cobranca "por sessao" — cobranca "mensal fixa" ignora isso
  // (ver clientMonthlyValue). Sem controle de presenca/falta de proposito — o
  // personal so quer aluno, horario e valor, o ajuste manual cobre exceções.
  function clientMonthlySessions(client, monthKey){
    var parts = monthKey.split("-");
    var year = parseInt(parts[0], 10), monthIndex = parseInt(parts[1], 10) - 1;
    var counts = countWeekdayOccurrences(year, monthIndex);
    var total = 0;
    CLIENT_DOW_KEYS.forEach(function(k, idx){
      if(client.days && client.days[k]) total += counts[idx];
    });
    var adj = (client.adjustments && client.adjustments[monthKey]) ? (Number(client.adjustments[monthKey].count) || 0) : 0;
    total += adj;
    if(total < 0) total = 0;
    return total;
  }

  // Personal trainer recebe por aula (valor x numero de sessoes) ou mensal
  // fixo (sempre o mesmo valor, presenca/falta nao muda nada) — ele mesmo
  // pediu essa segunda opcao, ja que muitos alunos particulares pagam fixo.
  function clientMonthlyValue(client, monthKey){
    if(client.billingType === "monthly"){
      return Number(client.flatMonthlyValue) || 0;
    }
    return clientMonthlySessions(client, monthKey) * (Number(client.rate) || 0);
  }

  function clientDaysLabel(client){
    var parts = [];
    CLIENT_DOW_KEYS.forEach(function(k, idx){
      if(client.days && client.days[k]) parts.push(CLIENT_DOW_LABELS[idx]);
    });
    return parts.length ? parts.join(", ") : "sem dia fixo";
  }

  function clientRateLabel(client){
    return client.billingType === "monthly"
      ? fmtMoney(Number(client.flatMonthlyValue) || 0) + "/mês (fixo)"
      : fmtMoney(Number(client.rate) || 0) + "/sessão";
  }

  function renderClients(){
    var listEl = document.getElementById("clientsList");
    var totalEl = document.getElementById("clientsMonthTotal");
    if(!listEl || !totalEl) return;
    var clients = data.clients || [];
    listEl.innerHTML = "";
    if(clients.length === 0){
      listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Nenhum aluno particular cadastrado ainda.</p>";
    }
    var monthTotal = 0;
    clients.forEach(function(client){
      var value = clientMonthlyValue(client, currentMonthKey);
      monthTotal += value;
      var row = document.createElement("div");
      row.className = "client-row";

      var info = document.createElement("div");
      info.className = "client-info";
      var name = document.createElement("strong");
      name.textContent = client.name;
      var meta = document.createElement("span");
      meta.className = "client-meta";
      meta.textContent = clientDaysLabel(client) + (client.time ? " · " + client.time : "") + " · " + clientRateLabel(client);
      info.appendChild(name);
      info.appendChild(meta);

      var valueEl = document.createElement("div");
      valueEl.className = "client-value";
      valueEl.textContent = fmtMoney(value);

      var editBtn = document.createElement("button");
      editBtn.className = "small ghost";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", function(){ openClientModal(client.id); });

      row.appendChild(info);
      row.appendChild(valueEl);
      row.appendChild(editBtn);
      listEl.appendChild(row);
    });
    totalEl.textContent = fmtMoney(monthTotal);
    renderClientSchedule();
  }

  // ---------- grade de horários dos alunos particulares (so personal) ----------
  // Em vez de so uma lista, o personal ve um calendario semanal (horario x dia)
  // igual o antigo mapa de escala, mas ligado direto aos alunos particulares:
  // cada horario usado por algum aluno vira uma linha; cada celula mostra quem
  // esta naquele dia+horario (ou "+" se vazio). Clicar numa celula abre o aluno
  // (editar/excluir) ou cria um novo ja com aquele dia e horario preenchidos.
  function timeStrToMinutes(t){
    if(!t) return 999999;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
    if(!m) return 999999;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function personalScheduleRows(){
    var set = {};
    (data.clients || []).forEach(function(c){
      if(c.time && c.time.trim()) set[c.time.trim()] = true;
    });
    (data.settings.personalScheduleTimes || []).forEach(function(t){
      if(t && t.trim()) set[t.trim()] = true;
    });
    var rows = Object.keys(set);
    rows.sort(function(a, b){ return timeStrToMinutes(a) - timeStrToMinutes(b); });
    return rows;
  }

  function clientsAtSlot(time, dayKey){
    return (data.clients || []).filter(function(c){
      return c.time && c.time.trim() === time && c.days && c.days[dayKey];
    });
  }

  function renderClientSchedule(){
    var head = document.getElementById("clientScheduleHead");
    var body = document.getElementById("clientScheduleBody");
    var emptyMsg = document.getElementById("clientScheduleEmpty");
    if(!head || !body) return;
    var rows = personalScheduleRows();

    head.innerHTML = "<th class='timecol'>Horário</th>";
    CLIENT_DOW_KEYS.forEach(function(k, idx){
      var th = document.createElement("th");
      th.textContent = CLIENT_DOW_LABELS[idx];
      head.appendChild(th);
    });

    body.innerHTML = "";
    if(emptyMsg) emptyMsg.style.display = rows.length ? "none" : "";

    rows.forEach(function(time){
      var tr = document.createElement("tr");

      var tdTime = document.createElement("td");
      tdTime.className = "timecol schedule-timecell";
      var timeText = document.createElement("span");
      timeText.textContent = time;
      tdTime.appendChild(timeText);
      var anyClient = (data.clients || []).some(function(c){ return c.time && c.time.trim() === time; });
      if(!anyClient){
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "schedule-row-remove";
        rm.title = "Remover horário";
        rm.textContent = "×";
        rm.addEventListener("click", function(e){
          e.stopPropagation();
          data.settings.personalScheduleTimes = (data.settings.personalScheduleTimes || []).filter(function(t){ return t.trim() !== time; });
          saveData();
          renderClientSchedule();
        });
        tdTime.appendChild(rm);
      }
      tr.appendChild(tdTime);

      CLIENT_DOW_KEYS.forEach(function(k){
        var td = document.createElement("td");
        td.className = "daycell schedule-cell";
        var matches = clientsAtSlot(time, k);
        var span = document.createElement("span");
        if(matches.length){
          span.className = "slot filled";
          span.textContent = matches.map(function(c){ return c.name; }).join(", ");
          td.title = matches.map(function(c){ return c.name + " · " + clientRateLabel(c); }).join(" / ");
        } else {
          span.className = "slot sem";
          span.textContent = "+";
        }
        td.appendChild(span);
        td.addEventListener("click", function(){
          if(matches.length){
            openClientModal(matches[0].id);
          } else {
            openClientModal(null, { time: time, dayKey: k });
          }
        });
        tr.appendChild(td);
      });

      body.appendChild(tr);
    });
  }

  document.getElementById("btnAddScheduleTime").addEventListener("click", function(){
    var input = document.getElementById("newScheduleTimeInput");
    var val = input.value;
    if(!val){ showToast("Escolha um horário"); return; }
    if(!data.settings.personalScheduleTimes) data.settings.personalScheduleTimes = [];
    if(personalScheduleRows().indexOf(val) === -1){
      data.settings.personalScheduleTimes.push(val);
      saveData();
    }
    renderClientSchedule();
    input.value = "";
  });

  // Mostra so os campos que fazem sentido pro tipo de cobranca escolhido: valor
  // por sessao (some com o ajuste manual, ja que presenca importa) ou valor
  // mensal fixo (esconde o ajuste manual, ja que presenca nao muda o valor).
  function applyClientBillingTypeUI(type){
    var isMonthly = type === "monthly";
    document.getElementById("clientRateWrap").style.display = isMonthly ? "none" : "";
    document.getElementById("clientRate").required = !isMonthly;
    document.getElementById("clientMonthlyValueWrap").style.display = isMonthly ? "" : "none";
    document.getElementById("clientMonthlyValueInput").required = isMonthly;
    document.getElementById("clientAdjustWrap").style.display = isMonthly ? "none" : "";
  }

  document.querySelectorAll('input[name="clientBillingType"]').forEach(function(radio){
    radio.addEventListener("change", function(){
      document.querySelectorAll('input[name="clientBillingType"]').forEach(function(r){
        r.closest(".client-day-chip").classList.toggle("checked", r.checked);
      });
      applyClientBillingTypeUI(radio.value);
    });
  });

  // prefill (opcional, so usado criando um aluno novo a partir de um clique na
  // grade de horarios): { time, dayKey } — ja abre o formulario com aquele
  // horario e dia marcados, pra nao precisar preencher tudo de novo.
  function openClientModal(clientId, prefill){
    activeClientId = clientId || null;
    var client = activeClientId ? (data.clients || []).find(function(c){ return c.id === activeClientId; }) : null;
    document.getElementById("clientTitle").textContent = client ? "Editar aluno particular" : "Novo aluno particular";
    document.getElementById("clientAdjustTitle").textContent = "Ajuste manual em " + monthLabel(currentMonthKey);
    document.getElementById("clientError").textContent = "";
    document.getElementById("clientName").value = client ? client.name : "";
    document.getElementById("clientRate").value = client ? client.rate : "";
    document.getElementById("clientMonthlyValueInput").value = client ? (client.flatMonthlyValue || "") : "";
    document.getElementById("clientTime").value = client ? (client.time || "") : (prefill && prefill.time ? prefill.time : "");

    var billingType = client ? (client.billingType || "session") : "session";
    document.querySelectorAll('input[name="clientBillingType"]').forEach(function(radio){
      radio.checked = (radio.value === billingType);
      radio.closest(".client-day-chip").classList.toggle("checked", radio.checked);
    });
    applyClientBillingTypeUI(billingType);

    var daysGrid = document.getElementById("clientDaysGrid");
    daysGrid.innerHTML = "";
    var days = client ? client.days : (function(){
      var d = blankClientDays();
      if(prefill && prefill.dayKey) d[prefill.dayKey] = true;
      return d;
    })();
    CLIENT_DOW_KEYS.forEach(function(k, idx){
      var label = document.createElement("label");
      label.className = "client-day-chip" + (days[k] ? " checked" : "");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!days[k];
      input.dataset.dowKey = k;
      input.addEventListener("change", function(){
        label.classList.toggle("checked", input.checked);
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(CLIENT_DOW_LABELS[idx]));
      daysGrid.appendChild(label);
    });

    var adjust = client && client.adjustments ? client.adjustments[currentMonthKey] : null;
    document.getElementById("clientAdjustCount").value = adjust ? adjust.count : "";
    document.getElementById("clientAdjustNote").value = adjust ? (adjust.note || "") : "";
    document.getElementById("btnDeleteClient").style.display = client ? "inline-block" : "none";
    document.getElementById("clientOverlay").classList.add("open");
  }

  document.getElementById("btnAddClient").addEventListener("click", function(){ openClientModal(null); });

  document.getElementById("clientForm").addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("clientError");
    errEl.textContent = "";
    var name = document.getElementById("clientName").value.trim();
    var billingTypeInput = document.querySelector('input[name="clientBillingType"]:checked');
    var billingType = billingTypeInput ? billingTypeInput.value : "session";
    var rate = parseFloat(document.getElementById("clientRate").value.replace(",", "."));
    var monthlyValue = parseFloat(document.getElementById("clientMonthlyValueInput").value.replace(",", "."));
    var time = document.getElementById("clientTime").value.trim();
    if(!name){ errEl.textContent = "Informe o nome do aluno."; return; }
    if(billingType === "monthly"){
      if(isNaN(monthlyValue) || monthlyValue < 0){ errEl.textContent = "Informe um valor mensal fixo válido."; return; }
    } else {
      if(isNaN(rate) || rate < 0){ errEl.textContent = "Informe um valor por sessão válido."; return; }
    }

    var days = {};
    document.querySelectorAll("#clientDaysGrid input[type=checkbox]").forEach(function(cb){
      days[cb.dataset.dowKey] = cb.checked;
    });

    if(!data.clients) data.clients = [];
    var client = activeClientId ? data.clients.find(function(c){ return c.id === activeClientId; }) : null;
    if(!client){
      client = { id: newClientId(), adjustments: {} };
      data.clients.push(client);
    }
    client.name = name;
    client.billingType = billingType;
    client.rate = isNaN(rate) ? 0 : rate;
    client.flatMonthlyValue = isNaN(monthlyValue) ? 0 : monthlyValue;
    client.time = time;
    client.days = days;
    if(!client.adjustments) client.adjustments = {};

    var adjCountRaw = document.getElementById("clientAdjustCount").value;
    var adjNote = document.getElementById("clientAdjustNote").value.trim();
    var adjCount = adjCountRaw !== "" ? parseInt(adjCountRaw, 10) : 0;
    if(!isNaN(adjCount) && adjCount !== 0){
      client.adjustments[currentMonthKey] = { count: adjCount, note: adjNote };
    } else {
      delete client.adjustments[currentMonthKey];
    }

    saveData();
    renderClients();
    closeOverlays();
    showToast("Aluno particular salvo");
  });

  document.getElementById("btnDeleteClient").addEventListener("click", function(){
    if(!activeClientId) return;
    if(!confirm("Excluir este aluno particular? Essa ação não pode ser desfeita.")) return;
    data.clients = (data.clients || []).filter(function(c){ return c.id !== activeClientId; });
    saveData();
    renderClients();
    closeOverlays();
    showToast("Aluno excluído");
  });

