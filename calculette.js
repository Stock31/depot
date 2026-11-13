/*
 * Calculette flottante du site (Sanji, 13/11/2026 : « une petite calculette affichée en plus, en pop-up, avec un truc à
 * activer de la même manière que Hors stock » ; « pas dans une nouvelle fenêtre : dans la même, comme la pastille de scan »).
 * Même calcul que l'appli (Calcul.kt) : × et ÷ avant + et −, parenthèses ; indulgente pendant la frappe.
 * Elle flotte au-dessus de la page, se déplace en la tenant par son titre, et « Mettre dans la case » met le résultat dans la
 * case de nombre en cours (la case reste ouverte : les touches de la calculette ne lui volent pas la main).
 * Chargée avant app.js (la barre du Stock lit CALCULETTE) ; elle se sert de el(), nombreJoli(), lireStockage() et
 * ecrireStockage() d'app.js, seulement quand on l'ouvre (tout est chargé à ce moment-là).
 */

/** Le résultat d'un calcul, ou null (vide, mal écrit, division par zéro) ; arrondi à 2 chiffres après la virgule. */
function resultatCalcul(texte) {
  let s = String(texte || '').replace(/\s/g, '').replace(/[×xX]/g, '*').replace(/[÷:]/g, '/').replace(/−/g, '-').replace(/,/g, '.');
  while (s && '+-*/('.includes(s.slice(-1))) s = s.slice(0, -1);   // pendant la frappe : signe ou « ( » final ignoré
  if (!s) return null;
  let ouvertes = 0;
  for (const c of s) { if (c === '(') ouvertes++; if (c === ')' && --ouvertes < 0) return null; }
  s += ')'.repeat(ouvertes);                                          // parenthèses restées ouvertes : fermées
  let i = 0;
  const somme = () => {
    let v = produit();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const w = produit(); v = op === '+' ? v + w : v - w; }
    return v;
  };
  const produit = () => {
    let v = facteur();
    for (;;) {
      if (s[i] === '*') { i++; v *= facteur(); }
      else if (s[i] === '/') { i++; const w = facteur(); if (w === 0) throw new Error('division par zéro'); v /= w; }
      else if (s[i] === '(') v *= facteur();                          // 3(24) = 3 × 24
      else return v;
    }
  };
  const facteur = () => {
    if (i >= s.length) throw new Error('fin');
    if (s[i] === '-') { i++; return -facteur(); }
    if (s[i] === '+') { i++; return facteur(); }
    if (s[i] === '(') { i++; const v = somme(); if (s[i] !== ')') throw new Error(') attendue'); i++; return v; }
    const m = /^\d*\.?\d*/.exec(s.slice(i))[0];
    if (!m || m === '.' || (m.match(/\./g) || []).length > 1) throw new Error('nombre attendu');
    i += m.length;
    return Number(m);
  };
  try {
    const v = somme();
    if (i !== s.length || !isFinite(v)) return null;
    const r = Math.round(v * 100) / 100;
    return Math.abs(r) < 1e-9 ? 0 : r;
  } catch (e) { return null; }
}

function estUnCalcul(texte) { return /[+\-−×÷*/()]/.test(String(texte || '').replace(/^[-−]/, '')); }
function affichageCalcul(texte) { return String(texte || '').replace(/([+−×÷])/g, ' $1 ').replace(/\s+/g, ' ').trim(); }

/** Une touche : chiffres, virgule, C, ⌫, + − × ÷ ( ) = (mêmes règles que le pavé de l'appli). */
function toucheCalcul(s, k) {
  const dernier = s.slice(-1);
  const apresNombre = /[0-9),]/.test(dernier);
  const ouvertes = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  const nombreEnCours = (/[0-9,]*$/.exec(s) || [''])[0];
  switch (k) {
    case 'C': return '';
    case '⌫': return s.slice(0, -1);
    case '=': { const r = resultatCalcul(s); return estUnCalcul(s) && r !== null ? nombreJoli(r) : s; }
    case '+': case '−': case '×': case '÷':
      if (!dernier || dernier === '(') return s;                      // rien avant : le signe n'a pas de sens
      if ('+−×÷'.includes(dernier)) return s.slice(0, -1) + k;        // on change d'avis sur le signe
      return s + k;
    case '(': return apresNombre ? s + '×(' : s + '(';
    case ')': return ouvertes > 0 && apresNombre ? s + ')' : s;
    case ',':
      if (nombreEnCours.includes(',')) return s;
      return (/[0-9]$/.test(s) ? s : s + (dernier === ')' ? '×0' : '0')) + ',';
    default:                                                         // un chiffre
      if (s.length >= 40 || nombreEnCours.replace(',', '').length >= 9) return s;
      if (dernier === ')') return s + '×' + k;
      if (nombreEnCours === '0') return s.slice(0, -1) + k;
      return s + k;
  }
}

const CALCULETTE = { vue: null, saisie: '' };

/** La case de nombre en cours (tableau, barre « Sélection multiple », fenêtres), s'il y en a une. */
function caseNombreActive() {
  const a = document.activeElement;
  return a && a.tagName === 'INPUT' && a.getAttribute('inputmode') === 'decimal' && !(CALCULETTE.vue && CALCULETTE.vue.contains(a)) ? a : null;
}

function majBoutonsCalculette() {
  const ouverte = !!CALCULETTE.vue;
  document.querySelectorAll('[data-calculette]').forEach(b => { b.classList.toggle('actif', ouverte); b.setAttribute('aria-pressed', ouverte ? 'true' : 'false'); });
}

function basculerCalculette() { if (CALCULETTE.vue) fermerCalculette(); else ouvrirCalculette(); }

function fermerCalculette() {
  if (CALCULETTE.vue) CALCULETTE.vue.remove();
  CALCULETTE.vue = null;
  document.removeEventListener('focusin', majDansLaCase); document.removeEventListener('focusout', majDansLaCase);
  window.removeEventListener('resize', garderDansLEcran);
  majBoutonsCalculette();
}

let majDansLaCase = () => {};
function garderDansLEcran() {
  const v = CALCULETTE.vue; if (!v) return;
  const l = Math.min(Math.max(4, v.offsetLeft), window.innerWidth - v.offsetWidth - 4);
  const h = Math.min(Math.max(4, v.offsetTop), window.innerHeight - v.offsetHeight - 4);
  v.style.left = l + 'px'; v.style.top = h + 'px';
}

function ouvrirCalculette() {
  if (CALCULETTE.vue) return;
  const calculVue = el('div', { class: 'calc-calcul' });
  const resultatVue = el('div', { class: 'calc-resultat' });
  const dansLaCase = el('button', { class: 'calc-case', tabindex: '-1', disabled: true, title: 'Clique d\'abord dans une case de nombre' }, 'Mettre dans la case');
  const maj = () => {
    const s = CALCULETTE.saisie, calcul = estUnCalcul(s), r = s ? resultatCalcul(s) : null;
    calculVue.textContent = calcul ? `${affichageCalcul(s)} =` : ' ';
    resultatVue.textContent = !s ? '0' : calcul ? (r === null ? '?' : nombreJoli(r)) : s;
    resultatVue.classList.toggle('vide', !s);
    resultatVue.title = calcul && r === null ? 'Calcul impossible' : '';
  };
  const appuyer = k => { CALCULETTE.saisie = toucheCalcul(CALCULETTE.saisie, k); maj(); };
  const touche = k => el('button', { class: 'calc-touche' + ('÷×−+()=,'.includes(k) ? ' signe' : '') + (k === '=' ? ' egal' : ''), tabindex: '-1',
    onclick: () => appuyer(k) }, k);
  const pave = el('div', { class: 'calc-pave' },
    ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '0', '⌫', '+', '(', ')', ',', '='].map(touche));
  dansLaCase.addEventListener('click', () => {
    const c = caseNombreActive(), r = resultatCalcul(CALCULETTE.saisie);
    if (!c || r === null) return;
    // Un morceau sélectionné : il est remplacé ; une liste qui finit par « + » (les bobines : 80 + 42,5 + …) : le résultat
    // s'ajoute au bout ; sinon la case prend le résultat
    const t = nombreJoli(r), a = c.selectionStart, b = c.selectionEnd;
    if (a !== null && b !== null && b > a) c.setRangeText(t, a, b, 'end');
    else if (/\+\s*$/.test(c.value)) c.value = c.value.replace(/\s*$/, ' ') + t;
    else c.value = t;
    c.dispatchEvent(new Event('input', { bubbles: true }));
    c.focus();
  });
  const titre = el('div', { class: 'calc-titre', title: 'Tiens-moi pour me déplacer' }, el('span', {}, '⠿ Calculette'),
    el('button', { class: 'calc-fermer', tabindex: '-1', title: 'Fermer', 'aria-label': 'Fermer la calculette', onclick: fermerCalculette }, '✕'));
  const vue = el('div', { class: 'calculette', tabindex: '0', role: 'dialog', 'aria-label': 'Calculette' },
    titre, el('div', { class: 'calc-ecran' }, calculVue, resultatVue), pave, dansLaCase);

  // Toucher la calculette ne ferme pas la case en cours (une case du tableau s'enregistre quand on la quitte) ;
  // sans case en cours, la calculette prend le clavier (chiffres, + - * / ( ) , Entrée, ⌫, Suppr).
  vue.addEventListener('mousedown', ev => {
    ev.preventDefault();
    if (!caseNombreActive()) vue.focus({ preventScroll: true });
  });
  vue.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = { '*': '×', 'x': '×', 'X': '×', '/': '÷', ':': '÷', '-': '−', '+': '+', '.': ',', ',': ',', '(': '(', ')': ')',
      'Enter': '=', '=': '=', 'Backspace': '⌫', 'Delete': 'C', 'c': 'C', 'C': 'C' }[ev.key] || (/^\d$/.test(ev.key) ? ev.key : null);
    if (!k && ev.key !== ' ') return;
    ev.preventDefault(); ev.stopPropagation();
    if (k) appuyer(k);
  });

  // Déplacer : tenir le titre (souris ou doigt), comme la pastille SCAN de l'appli ; la place est retenue sur cet appareil
  titre.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.calc-fermer')) return;
    const dx = ev.clientX - vue.offsetLeft, dy = ev.clientY - vue.offsetTop;
    titre.setPointerCapture(ev.pointerId);
    const bouger = e => { vue.style.left = (e.clientX - dx) + 'px'; vue.style.top = (e.clientY - dy) + 'px'; garderDansLEcran(); };
    const lacher = () => {
      titre.removeEventListener('pointermove', bouger); titre.removeEventListener('pointerup', lacher); titre.removeEventListener('pointercancel', lacher);
      ecrireStockage('sd_calculette_place', JSON.stringify({ x: vue.offsetLeft, y: vue.offsetTop }));
    };
    titre.addEventListener('pointermove', bouger); titre.addEventListener('pointerup', lacher); titre.addEventListener('pointercancel', lacher);
  });

  majDansLaCase = () => setTimeout(() => {
    const ok = !!caseNombreActive();
    dansLaCase.disabled = !ok;
    dansLaCase.title = ok ? 'Met le résultat dans la case en cours' : 'Clique d\'abord dans une case de nombre';
  }, 0);
  document.addEventListener('focusin', majDansLaCase); document.addEventListener('focusout', majDansLaCase);
  window.addEventListener('resize', garderDansLEcran);

  CALCULETTE.vue = vue;
  document.body.append(vue);
  maj();                                  // l'écran rempli d'abord : la hauteur est la bonne pour la placer
  let place = null;
  try { place = JSON.parse(lireStockage('sd_calculette_place') || 'null'); } catch (e) { place = null; }
  vue.style.left = (place ? place.x : window.innerWidth - vue.offsetWidth - 16) + 'px';
  vue.style.top = (place ? place.y : window.innerHeight - vue.offsetHeight - 16) + 'px';
  garderDansLEcran();
  majDansLaCase(); majBoutonsCalculette();
  if (!caseNombreActive()) vue.focus({ preventScroll: true });
}
