// icons.js — icones de traco (SVG inline) usados nas telas novas. navIcon("nome") devolve o <svg>.
"use strict";
var ICON_PATHS = {
 "cal": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"3\"/><path d=\"M3 10h18M8 2v4M16 2v4\"/>",
 "bars": "<path d=\"M5 20V10M12 20V4M19 20v-7\"/>",
 "users": "<circle cx=\"9\" cy=\"8\" r=\"3.2\"/><path d=\"M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 11a3 3 0 100-6M21 19c0-2.4-1.5-4-3.5-4.6\"/>",
 "bell": "<path d=\"M6 17V11a6 6 0 1112 0v6l1.5 2h-15zM10 21h4\"/>",
 "chev": "<path d=\"M9 6l6 6-6 6\"/>",
 "down": "<path d=\"M6 9l6 6 6-6\"/>",
 "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.5-3.5\"/>",
 "plus": "<path d=\"M12 5v14M5 12h14\"/>",
 "info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8h.01\"/>",
 "xls": "<path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13l4 4M13 13l-4 4\"/>",
 "pdf": "<path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4\"/>",
 "save": "<path d=\"M12 4v11M7 10l5 5 5-5M5 20h14\"/>",
 "up": "<path d=\"M12 20V9M7 14l5-5 5 5M5 4h14\"/>",
 "drop": "<path d=\"M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z\"/>",
 "note": "<path d=\"M5 4h14v16H5zM9 9h6M9 13h6\"/>",
 "gift": "<rect x=\"3\" y=\"8\" width=\"18\" height=\"4\" rx=\"1\"/><path d=\"M12 8v13M5 12v8h14v-8M8 8a2.5 2.5 0 110-5c2 0 4 2 4 5 0-3 2-5 4-5a2.5 2.5 0 110 5\"/>",
 "lock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"3\"/><path d=\"M8 11V8a4 4 0 118 0v3\"/>",
 "key": "<circle cx=\"8\" cy=\"15\" r=\"4\"/><path d=\"M11 12l9-9M16 7l3 3\"/>",
 "shield": "<path d=\"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z\"/>",
 "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
 "user": "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5\"/>",
 "help": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01\"/>",
 "star": "<path d=\"M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z\"/>",
 "check": "<path d=\"M5 12l5 5 9-10\"/>",
 "warn": "<path d=\"M12 3l10 18H2zM12 10v5M12 18h.01\"/>",
 "swap": "<path d=\"M7 4l-4 4 4 4M3 8h14M17 20l4-4-4-4M21 16H7\"/>",
 "out": "<path d=\"M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M15 8l4 4-4 4M19 12H9\"/>",
 "trash": "<path d=\"M4 7h16M10 3h4M6 7l1 13h10l1-13\"/>",
 "close": "<path d=\"M6 6l12 12M18 6L6 18\"/>"
};
function navIcon(name, size){
  var d = ICON_PATHS[name] || ICON_PATHS.info;
  size = size || 22;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

// preenche os <span data-icon="..."> estaticos do HTML
document.querySelectorAll("[data-icon]").forEach(function(e){ if(!e.innerHTML) e.innerHTML = navIcon(e.getAttribute("data-icon"), 20); });
